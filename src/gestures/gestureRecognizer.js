/**
 * GestureVerse - gesture recognition state machine.
 *
 * One instance tracks one hand. Feed it a hand (or null) each frame and it
 * returns a committed state plus discrete transition events.
 *
 * Design goals, straight from the brief:
 *  - activation threshold != release threshold (no flicker)
 *  - temporal confirmation frames for deliberate gestures
 *  - per-gesture cooldowns (a fist must never silently wipe the scene)
 *  - a neutral 'none' state between conflicting gestures
 *  - graceful recovery when the hand leaves the frame
 */

import { OneEuroFilter, OneEuroPoint, VelocityTracker } from '../core/oneEuroFilter.js';
import { clamp01, remap } from '../core/math.js';
import { handMetrics } from './landmarks.js';

export const STATE = {
  NONE: 'none',
  POINT: 'point',
  PINCH: 'pinch',
  PALM: 'palm',
  FIST: 'fist',
  LOST: 'lost',
};

export const EVENT = {
  POINT_START: 'point_start',
  POINT_END: 'point_end',
  PINCH_START: 'pinch_start',
  PINCH_END: 'pinch_end',
  PALM: 'palm',
  FIST: 'fist',
  HAND_LOST: 'hand_lost',
  HAND_FOUND: 'hand_found',
  TWO_HAND: 'two_hand',
};

/** Raw classification before temporal confirmation. */
function classify(m, cfg, pinchActive) {
  if (pinchActive) return STATE.PINCH;

  const e = m.extensions;
  const idxOnly = e.index > 0.6 && e.middle < 0.45 && e.ring < 0.45 && e.pinky < 0.45;
  const allOpen = e.index > 0.6 && e.middle > 0.6 && e.ring > 0.6 && e.pinky > 0.6;
  const allClosed = e.index < 0.4 && e.middle < 0.4 && e.ring < 0.4 && e.pinky < 0.4;

  if (idxOnly) return STATE.POINT;
  if (allClosed) return STATE.FIST;
  if (allOpen) return STATE.PALM;
  return STATE.NONE;
}

export class GestureRecognizer {
  constructor(config) {
    this.config = config;
    this.state = STATE.LOST;
    this.pendingState = null;
    this.pendingFrames = 0;
    this.pinchActive = false;
    this.pinchPending = null;
    this.pinchFrames = 0;
    this.lastFire = {}; // state -> timestamp ms
    this.cursorFilter = new OneEuroPoint(config.tracking.smoothing);
    // The pinch ratio gets a deliberately fast filter: a pinch is a quick,
    // intentional gesture and must not feel laggy.
    this.pinchFilter = new OneEuroFilter({ minCutoff: 4.0, beta: 0.05 });
    this.velocity = new VelocityTracker(6);
    this.lastCursor = null;
    this.lastRaw = null;
    this.consecutiveRejects = 0;
    this.lastSeen = null;
    this.metrics = null;
    this.side = null;
    this.jumpRejects = 0;
    this.handPresent = false;
  }

  reset() {
    this.state = STATE.LOST;
    this.pendingState = null;
    this.pendingFrames = 0;
    this.pinchActive = false;
    this.pinchPending = null;
    this.pinchFrames = 0;
    this.cursorFilter.reset();
    this.pinchFilter.reset();
    this.velocity.clear();
    this.lastCursor = null;
    this.lastRaw = null;
    this.consecutiveRejects = 0;
    this.lastSeen = null;
    this.metrics = null;
    this.jumpRejects = 0;
    this.handPresent = false;
  }

  /** Frames required before a raw state is allowed to commit. */
  requiredFrames(raw, t) {
    const g = this.config.gestures;
    // Pinch hysteresis already required pinchConfirmFrames, so commit at once.
    if (raw === STATE.PINCH) return 1;
    if (raw === STATE.POINT) return g.extensionConfirmFrames;
    if (raw === STATE.PALM) return g.palmConfirmFrames;
    if (raw === STATE.FIST) return g.fistConfirmFrames;
    return 1;
  }

  cooldownFor(state) {
    const g = this.config.gestures;
    return state === STATE.FIST ? g.fistCooldownMs : g.cooldownMs;
  }

  isCoolingDown(state, t) {
    const last = this.lastFire[state];
    if (last === undefined) return false;
    return t - last < this.cooldownFor(state);
  }

  /**
   * @param {{landmarks:Array, handedness?:string}|null} hand
   * @param {number} tMs monotonic timestamp in milliseconds
   */
  update(hand, tMs) {
    const events = [];

    if (!hand || !hand.landmarks || hand.landmarks.length < 21) {
      if (this.handPresent) {
        // Emit the end event for whatever we were doing so the app can
        // release any held object safely instead of leaving it stuck.
        this._emitEnd(this.state, events, { reason: 'lost' });
        events.push({ type: EVENT.HAND_LOST });
        this.handPresent = false;
      }
      this.state = STATE.LOST;
      this.pendingState = null;
      this.pendingFrames = 0;
      this.pinchActive = false;
      this.velocity.clear();
      return this._result(events, null);
    }

    if (!this.handPresent) {
      this.handPresent = true;
      events.push({ type: EVENT.HAND_FOUND, handedness: hand.handedness || null });
    }

    const m = handMetrics(hand.landmarks, this.config);
    this.metrics = m;
    this.side = hand.handedness || this.side;

    // --- smooth the cursor and reject teleport-sized landmark jumps -----
    // A single teleport is treated as a tracking glitch and the previous
    // cursor is held. But the guard must never latch: if the jump persists
    // for a few frames the hand really did move (or tracking re-acquired
    // somewhere else), so we reset the filter and snap to the new position.
    const rawCursor = m.cursor;
    const jump = this.lastRaw
      ? Math.hypot(rawCursor.x - this.lastRaw.x, rawCursor.y - this.lastRaw.y)
      : 0;
    let smoothed;
    if (jump > this.config.tracking.maxJump && this.consecutiveRejects < 4 && this.lastCursor) {
      this.jumpRejects++;
      this.consecutiveRejects++;
      smoothed = { ...this.lastCursor };
    } else {
      if (jump > this.config.tracking.maxJump) this.cursorFilter.reset();
      this.consecutiveRejects = 0;
      smoothed = this.cursorFilter.filter(rawCursor, tMs / 1000);
    }
    this.lastRaw = { x: rawCursor.x, y: rawCursor.y, z: rawCursor.z || 0 };
    this.lastCursor = { x: smoothed.x, y: smoothed.y, z: smoothed.z };
    this.velocity.push(smoothed.x, smoothed.y, smoothed.z, tMs / 1000);

    // --- pinch hysteresis ------------------------------------------------
    const pinchRatio = this.pinchFilter.filter(m.pinchRatio, tMs / 1000);
    const g = this.config.gestures;
    if (!this.pinchActive) {
      if (pinchRatio < g.pinchOn) {
        this.pinchPending = true;
        this.pinchFrames++;
        if (this.pinchFrames >= g.pinchConfirmFrames) {
          this.pinchActive = true;
          this.pinchPending = null;
          this.pinchFrames = 0;
        }
      } else {
        this.pinchPending = null;
        this.pinchFrames = 0;
      }
    } else {
      if (pinchRatio > g.pinchOff) {
        this.pinchPending = false;
        this.pinchFrames++;
        if (this.pinchFrames >= g.pinchReleaseFrames) {
          this.pinchActive = false;
          this.pinchPending = null;
          this.pinchFrames = 0;
        }
      } else {
        this.pinchPending = null;
        this.pinchFrames = 0;
      }
    }

    const raw = classify(m, this.config, this.pinchActive);

    // --- temporal confirmation ------------------------------------------
    if (raw === this.state) {
      this.pendingState = null;
      this.pendingFrames = 0;
    } else {
      if (raw === this.pendingState) {
        this.pendingFrames++;
      } else {
        this.pendingState = raw;
        this.pendingFrames = 1;
      }
      const need = this.requiredFrames(raw, tMs);
      const releaseTransition = raw === STATE.NONE || this.state === STATE.PINCH;
      const cooled = this.isCoolingDown(raw, tMs);

      if (this.pendingFrames >= need && (releaseTransition || !cooled)) {
        this._commit(raw, tMs, events);
      }
    }

    return this._result(events, m);
  }

  _commit(next, t, events) {
    const prev = this.state;
    this._emitEnd(prev, events, {});
    this.state = next;
    this.pendingState = null;
    this.pendingFrames = 0;

    switch (next) {
      case STATE.POINT:
        events.push({ type: EVENT.POINT_START, cursor: this._cursor() });
        break;
      case STATE.PINCH:
        this.lastFire[STATE.PINCH] = t;
        events.push({ type: EVENT.PINCH_START, cursor: this._cursor() });
        break;
      case STATE.PALM:
        this.lastFire[STATE.PALM] = t;
        events.push({ type: EVENT.PALM, cursor: this._cursor() });
        break;
      case STATE.FIST:
        this.lastFire[STATE.FIST] = t;
        events.push({ type: EVENT.FIST, cursor: this._cursor() });
        break;
      default:
        break;
    }
  }

  _emitEnd(state, events, extra) {
    switch (state) {
      case STATE.POINT:
        events.push({ type: EVENT.POINT_END, cursor: this._cursor(), ...extra });
        break;
      case STATE.PINCH:
        events.push({
          type: EVENT.PINCH_END,
          cursor: this._cursor(),
          velocity: this.velocity.velocity(),
          ...extra,
        });
        break;
      default:
        break;
    }
  }

  _cursor() {
    return this.lastCursor ? { ...this.lastCursor } : { x: 0.5, y: 0.5, z: 0 };
  }

  _result(events, m) {
    const v = this.velocity.velocity();
    const g = this.config.gestures;
    // Continuous pinch strength for visual feedback (0 open .. 1 pinched).
    const pinchStrength = m ? clamp01(remap(m.pinchRatio, g.pinchOff, g.pinchOn, 0, 1)) : 0;

    return {
      state: this.state,
      events,
      cursor: this._cursor(),
      velocity: v,
      metrics: m,
      pinchActive: this.pinchActive,
      pinchStrength,
      side: this.side,
      raw: m ? classify(m, this.config, this.pinchActive) : STATE.NONE,
    };
  }
}
