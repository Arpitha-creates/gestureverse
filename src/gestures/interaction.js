/**
 * The interaction brain.
 *
 * HandState says what each hand is doing. This module decides what that means
 * for the scene: draw, grab, carry, resize, rotate, delete - and it is the only
 * place that mutates the world in response to gestures.
 *
 * Reliability rules baked in, because a gesture UI that hangs is worse than one
 * that does nothing:
 *   - every carried object is released the moment its hand stops pinching;
 *   - a hand that vanishes releases after `lostGraceMs`;
 *   - a two-hand grab that loses either hand releases after `exitGraceMs`;
 *   - no grab can outlive `maxHoldMs`, ever;
 *   - positions are clamped to a sane box so a bad projection cannot fling an
 *     object out of the world.
 */

import { AppStateName, HandStateName } from './states.js';
import { StrokeBuilder } from '../drawing/strokeBuilder.js';
import { Drawing } from '../objects/world.js';
import { clamp, clamp01, shortestAngle } from '../core/util.js';

const { IDLE, DRAW, HOVER, GRAB, MOVE, TWO_HAND, RESIZE, ROTATE, DELETE } = AppStateName;
const { PINCH, POINT, FIST, LOST } = HandStateName;

const POSITION_LIMITS = { x: 9, y: 6, z: 3.5 };

export class Interaction {
  constructor(config, world) {
    this.config = config;
    this.world = world;
    this.stroke = new StrokeBuilder(config);
    this.strokeOwner = null;

    this.appState = IDLE;
    this.cursor = null;
    this.hover = null;

    this.carried = null;
    this.carriedBy = null;
    this.grabOffset = { x: 0, y: 0 };
    this.depth0 = 0;
    this.z0 = 0;

    this.twoHand = null;
    this.twoGrace = 0;

    this.deleteTarget = null;
    this.deleteHold = 0;
    this.fistConsumed = false;

    this.palmHold = 0;
    this.palmConsumed = false;
    this.eraserCooldown = 0;
    this.indicators = {};
    this.project = null;
    this.viewport = { width: 1, height: 1 };
  }

  /* ------------------------------------------------------------ helpers */

  toPx(point) {
    return { x: point.x * this.viewport.width, y: point.y * this.viewport.height };
  }

  /**
   * Screen-space picking. Working in pixels rather than world units means depth
   * never makes a target unpickable, which is the usual failure of raycasting
   * against objects floating at different z.
   */
  pickAt(cursorPx) {
    if (!cursorPx || !this.project) return null;
    let best = null;
    let bestScore = Infinity;
    for (const d of this.world.drawings) {
      const centre = this.project({ x: d.position.x, y: d.position.y, z: d.position.z });
      if (!centre) continue;
      const edge = this.project({
        x: d.position.x + d.radius * d.scale,
        y: d.position.y,
        z: d.position.z,
      });
      const radiusPx = edge ? Math.hypot(edge.x - centre.x, edge.y - centre.y) : 0;
      const reach = radiusPx + this.config.grab.radiusPx * 0.4;
      const dist = Math.hypot(cursorPx.x - centre.x, cursorPx.y - centre.y);
      if (dist <= reach) {
        const score = dist / Math.max(reach, 1);
        if (score < bestScore) {
          bestScore = score;
          best = d;
        }
      }
    }
    return best;
  }

  clampPosition(p) {
    return {
      x: clamp(p.x, -POSITION_LIMITS.x, POSITION_LIMITS.x),
      y: clamp(p.y, -POSITION_LIMITS.y, POSITION_LIMITS.y),
      z: clamp(p.z, -POSITION_LIMITS.z, POSITION_LIMITS.z),
    };
  }

  /* --------------------------------------------------------------- frame */

  /**
   * @param {object} ctx
   * @param {Array} ctx.hands slots: [{index, result, pose}]
   * @param {number} ctx.now ms
   * @param {number} ctx.dt seconds
   * @param {'draw'|'play'} ctx.mode
   * @param {{color:string,width:number}} ctx.brush
   * @param {boolean} ctx.eraser
   * @param {(p:object,z?:number)=>object} ctx.toWorld
   * @param {(v:object)=>object} ctx.project
   * @param {{width:number,height:number}} ctx.viewport
   */
  update(ctx) {
    this.project = ctx.project;
    this.viewport = ctx.viewport || this.viewport;

    const live = ctx.hands.filter((h) => h.pose && h.result.state !== LOST);
    const pinching = live.filter((h) => h.result.state === PINCH);
    const pointing = live.filter((h) => h.result.state === POINT);
    const fisting = live.filter((h) => h.result.state === FIST);

    const primary = pinching[0] || pointing[0] || fisting[0] || live[0] || null;
    this.cursor = primary ? primary.pose.tip : null;
    this.indicators = {};

    let state;

    if (this.twoHand) {
      state = this.stepTwoHand(ctx, pinching);
    } else if (this.carried) {
      state = pinching.length >= 2 ? this.beginTwoHand(ctx, pinching) : this.stepCarry(ctx, pinching, fisting);
    } else if (pinching.length >= 2) {
      state = this.beginTwoHand(ctx, pinching);
    } else if (pinching.length === 1) {
      state = this.beginCarry(ctx, pinching[0]);
    } else {
      state = this.stepIdle(ctx, pointing, fisting);
    }

    this.updatePalmUndo(ctx, live);
    if (this.eraserCooldown > 0) this.eraserCooldown = Math.max(0, this.eraserCooldown - ctx.dt);

    this.appState = state;
    return this.report();
  }

  /* ---------------------------------------------------------- one hand */

  beginCarry(ctx, hand) {
    const target = this.pickAt(this.toPx(hand.pose.pinch));
    if (!target) {
      this.hint = 'Nothing here to grab';
      return HOVER;
    }
    this.world.mark();
    this.carried = target;
    this.carriedBy = hand.index;
    target.selected = true;

    // The offset is the whole reason an object does not snap to the fingertip
    // when grabbed: we keep the relative position it was picked up at.
    const world = ctx.toWorld(hand.pose.pinch, target.position.z);
    this.grabOffset = { x: target.position.x - world.x, y: target.position.y - world.y };
    this.depth0 = hand.pose.depth;
    this.z0 = target.position.z;
    return GRAB;
  }

  stepCarry(ctx, pinching, fisting) {
    const hand = ctx.hands.find((h) => h.index === this.carriedBy);
    const holding = hand && hand.pose && hand.result.state === PINCH;

    if (!holding) {
      this.release();
      return IDLE;
    }

    // Deliberate delete: the free hand makes a fist while the other holds.
    const deleter = fisting.find((h) => h.index !== this.carriedBy);
    if (deleter) {
      this.deleteTarget = this.carried;
      this.deleteHold += ctx.dt * 1000; // milliseconds, like the threshold
      if (this.deleteHold >= this.config.gesture.deleteHoldMs) {
        this.deleteCarried();
        return IDLE;
      }
      return DELETE;
    }
    this.deleteTarget = null;
    this.deleteHold = 0;

    const obj = this.carried;
    // x/y come from the grab plane, not the object's current plane, so that
    // changing depth does not also drag the object sideways.
    const p = ctx.toWorld(hand.pose.pinch, this.z0);
    const depthDelta = (hand.pose.depth - this.depth0) * this.config.twoHand.depthRange;

    const target = this.clampPosition({
      x: p.x + this.grabOffset.x,
      y: p.y + this.grabOffset.y,
      z: this.z0 + depthDelta,
    });

    const k = 1 - Math.exp(-ctx.dt * 22);
    const kz = 1 - Math.exp(-ctx.dt * 10);
    obj.position.x += (target.x - obj.position.x) * k;
    obj.position.y += (target.y - obj.position.y) * k;
    obj.position.z += (target.z - obj.position.z) * kz;

    return MOVE;
  }

  /* ---------------------------------------------------------- two hands */

  beginTwoHand(ctx, pinching) {
    const [a, b] = pinching;
    const midPx = {
      x: (this.toPx(a.pose.pinch).x + this.toPx(b.pose.pinch).x) / 2,
      y: (this.toPx(a.pose.pinch).y + this.toPx(b.pose.pinch).y) / 2,
    };
    const target = this.carried || this.pickAt(midPx);
    if (!target) {
      this.hint = 'Bring both pinches onto a drawing';
      return HOVER;
    }
    if (!this.carried) this.world.mark();

    this.carried = target;
    this.carriedBy = a.index;
    target.selected = true;

    const midNorm = {
      x: (a.pose.pinch.x + b.pose.pinch.x) / 2,
      y: (a.pose.pinch.y + b.pose.pinch.y) / 2,
    };
    const midWorld = ctx.toWorld(midNorm, target.position.z);
    this.grabOffset = { x: target.position.x - midWorld.x, y: target.position.y - midWorld.y };

    const wa = ctx.toWorld(a.pose.pinch, target.position.z);
    const wb = ctx.toWorld(b.pose.pinch, target.position.z);

    this.twoHand = {
      aIndex: a.index,
      bIndex: b.index,
      span0: Math.max(1e-3, Math.hypot(wa.x - wb.x, wa.y - wb.y)),
      scale0: target.scale,
      angle0: Math.atan2(wb.y - wa.y, wb.x - wa.x),
      rot0: target.rotation.z,
      depth0: (a.pose.depth + b.pose.depth) / 2,
      z0: target.position.z,
      startedAt: ctx.now,
    };
    this.twoGrace = 0;
    return TWO_HAND;
  }

  stepTwoHand(ctx, pinching) {
    const t = this.twoHand;
    const obj = this.carried;
    if (!obj) {
      this.endTwoHand();
      return IDLE;
    }

    const a = ctx.hands.find((h) => h.index === t.aIndex);
    const b = ctx.hands.find((h) => h.index === t.bIndex);
    const okA = a && a.pose && a.result.state === PINCH;
    const okB = b && b.pose && b.result.state === PINCH;

    // Hard safety: never let a grab live forever.
    if (ctx.now - t.startedAt > this.config.twoHand.maxHoldMs) {
      this.endTwoHand();
      return IDLE;
    }

    if (!okA || !okB) {
      this.twoGrace += ctx.dt * 1000;
      if (this.twoGrace > this.config.twoHand.exitGraceMs) {
        this.endTwoHand();
        return IDLE;
      }
      return TWO_HAND;
    }
    this.twoGrace = 0;

    const wa = ctx.toWorld(a.pose.pinch, t.z0);
    const wb = ctx.toWorld(b.pose.pinch, t.z0);
    const span = Math.max(1e-3, Math.hypot(wa.x - wb.x, wa.y - wb.y));
    const angle = Math.atan2(wb.y - wa.y, wb.x - wa.x);

    const targetScale = clamp(
      t.scale0 * (span / t.span0),
      this.config.twoHand.minScale,
      this.config.twoHand.maxScale,
    );
    const targetRot = t.rot0 + shortestAngle(angle - t.angle0);
    const depthDelta = ((a.pose.depth + b.pose.depth) / 2 - t.depth0) * this.config.twoHand.depthRange;

    const target = this.clampPosition({
      x: (wa.x + wb.x) / 2 + this.grabOffset.x,
      y: (wa.y + wb.y) / 2 + this.grabOffset.y,
      z: t.z0 + depthDelta,
    });

    const k = 1 - Math.exp(-ctx.dt * 18);
    const kr = 1 - Math.exp(-ctx.dt * 16);
    obj.position.x += (target.x - obj.position.x) * k;
    obj.position.y += (target.y - obj.position.y) * k;
    obj.position.z += (target.z - obj.position.z) * (1 - Math.exp(-ctx.dt * 9));
    obj.scale += (targetScale - obj.scale) * kr;
    obj.rotation.z += shortestAngle(targetRot - obj.rotation.z) * kr;

    const spanRatio = span / t.span0;
    const rotDelta = Math.abs(shortestAngle(angle - t.angle0));
    const resizing = Math.abs(spanRatio - 1) > 0.05;
    const rotating = rotDelta > 0.09;
    this.indicators = { spanRatio, rotDelta, resizing, rotating };

    if (resizing && rotating) return TWO_HAND;
    if (resizing) return RESIZE;
    if (rotating) return ROTATE;
    return MOVE;
  }

  endTwoHand() {
    this.twoHand = null;
    this.twoGrace = 0;
    this.release();
  }

  /* -------------------------------------------------------------- idle */

  stepIdle(ctx, pointing, fisting) {
    if (fisting.length) return this.stepFist(ctx, fisting);

    this.fistConsumed = false;
    this.deleteTarget = null;
    this.deleteHold = 0;

    if (pointing.length && ctx.eraser) return this.stepEraser(ctx, pointing[0]);
    if (ctx.mode === 'draw' && pointing.length) return this.stepDraw(ctx, pointing);
    if (this.stroke.active) this.finishStroke(ctx);

    if (this.cursor) {
      const target = this.pickAt(this.toPx(this.cursor));
      if (target) {
        this.hover = target;
        return HOVER;
      }
    }
    this.hover = null;
    return IDLE;
  }

  stepDraw(ctx, pointing) {
    const hand = pointing[0];
    const p = ctx.toWorld(hand.pose.tip, 0);

    if (!this.stroke.active || hand.index !== this.strokeOwner) {
      // A hand swap mid-stroke ends the old stroke cleanly instead of joining
      // two unrelated paths with a straight line.
      if (this.stroke.active) this.finishStroke(ctx);
      this.stroke.begin(p, { color: ctx.brush.color, width: ctx.brush.width });
      this.strokeOwner = hand.index;
    } else {
      this.stroke.add(p);
    }
    this.hover = null;
    return DRAW;
  }

  stepEraser(ctx, hand) {
    if (this.stroke.active) this.finishStroke(ctx);
    if (this.eraserCooldown > 0) return IDLE;
    const target = this.pickAt(this.toPx(hand.pose.tip));
    if (target) {
      this.world.mark();
      this.world.removeById(target.id);
      this.eraserCooldown = 0.28;
      this.hover = null;
      return DELETE;
    }
    return IDLE;
  }

  stepFist(ctx, fisting) {
    if (this.stroke.active) this.finishStroke(ctx);

    const target = this.pickAt(this.toPx(fisting[0].pose.tip));
    if (!target || this.fistConsumed) {
      this.deleteTarget = null;
      this.deleteHold = 0;
      this.hover = null;
      return IDLE;
    }
    if (this.deleteTarget !== target) {
      this.deleteTarget = target;
      this.deleteHold = 0;
    }
    this.deleteHold += ctx.dt * 1000; // milliseconds, like the threshold
    if (this.deleteHold >= this.config.gesture.deleteHoldMs) {
      this.world.mark();
      this.world.removeById(target.id);
      this.deleteTarget = null;
      this.deleteHold = 0;
      this.fistConsumed = true; // one delete per fist, never a chain
      this.hover = null;
      return DELETE;
    }
    this.hover = target;
    return DELETE;
  }

  finishStroke(ctx) {
    const stroke = this.stroke.end();
    this.strokeOwner = null;
    if (!stroke) return;
    this.world.mark();
    const drawing = Drawing.fromStroke(stroke, ctx.now);
    this.world.add(drawing);
    // Recycle the oldest artwork rather than letting the scene grow unbounded.
    const cap = this.config.draw.maxDrawings;
    while (this.world.count > cap) {
      this.world.removeById(this.world.drawings[0].id);
    }
    this.hover = null;
  }

  updatePalmUndo(ctx, live) {
    const palms = live.filter((h) => h.result.state === HandStateName.PALM);
    if (!palms.length) {
      this.palmHold = 0;
      this.palmConsumed = false;
      return;
    }
    if (this.carried) return;
    this.palmHold = Math.max(...palms.map((h) => h.result.holdMs));
    if (this.palmHold >= this.config.gesture.palmHoldMs && !this.palmConsumed) {
      this.world.undo();
      this.palmConsumed = true;
    }
  }

  /* ------------------------------------------------------------ release */

  release() {
    if (this.carried) this.carried.selected = false;
    this.carried = null;
    this.carriedBy = null;
    this.deleteTarget = null;
    this.deleteHold = 0;
    this.twoHand = null;
    this.twoGrace = 0;
    this.indicators = {};
  }

  deleteCarried() {
    if (!this.carried) return;
    const id = this.carried.id;
    this.carried.selected = false;
    this.carried = null;
    this.carriedBy = null;
    this.twoHand = null;
    this.deleteTarget = null;
    this.deleteHold = 0;
    this.world.removeById(id);
  }

  /** Called when the user hits Esc or tracking is switched off. */
  forceRelease() {
    if (this.stroke.active) this.stroke.cancel();
    this.strokeOwner = null;
    this.release();
    this.appState = IDLE;
  }

  report() {
    return {
      appState: this.appState,
      cursor: this.cursor,
      hover: this.hover,
      carried: this.carried,
      twoHand: this.twoHand,
      deleteTarget: this.deleteTarget,
      deleteProgress: clamp01(this.deleteHold / this.config.gesture.deleteHoldMs),
      palmProgress: clamp01(this.palmHold / this.config.gesture.palmHoldMs),
      stroke: this.stroke.active ? this.stroke.points : null,
      indicators: this.indicators,
      hint: this.hint,
    };
  }
}
