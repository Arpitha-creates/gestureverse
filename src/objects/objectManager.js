/**
 * GestureVerse - object model and manipulation.
 *
 * Owns every manipulable object and implements the signature interaction:
 * hover -> grab -> lift -> move -> release/place -> throw. Deliberately free
 * of renderer references (the renderer keeps its own map from object id to
 * mesh) so the whole thing can be exercised in Node tests.
 */

import { clamp, dist3 } from '../core/math.js';
import { followAlpha, stepPhysics } from './physics.js';

export const OBJ_STATE = {
  IDLE: 'idle',
  HOVERED: 'hovered',
  HELD: 'held',
  FLYING: 'flying',
};

let objectCounter = 0;

export function nextObjectId() {
  objectCounter += 1;
  return `o${objectCounter}`;
}

export class ObjectManager {
  constructor(config) {
    this.config = config;
    this.objects = new Map();
    this.heldId = null;
    this.lastHandPos = null;
    this.handVelocity = { x: 0, y: 0, z: 0, speed: 0 };
    // Short history of hand velocity, stamped with simulated time. A throw is
    // judged on the PEAK speed in the last ~140 ms, not the instantaneous
    // speed: the hand naturally stalls for a frame or two while the pinch
    // release is confirmed, and using the instantaneous value silently
    // swallowed most throws.
    this.velocityHistory = [];
    this.simTime = 0;
    this.events = [];
  }

  all() {
    return Array.from(this.objects.values());
  }

  get(id) {
    return this.objects.get(id) || null;
  }

  get held() {
    return this.heldId ? this.objects.get(this.heldId) : null;
  }

  /**
   * @param {object} spec
   * @param {string} [spec.kind]      logical type, e.g. 'sphere' | 'box' | 'star'
   * @param {{x:number,y:number,z:number}} spec.position
   * @param {number} [spec.size=1]
   * @param {string} [spec.color]
   * @param {string} [spec.sourceStrokeId]
   */
  add(spec) {
    const world = this.config.world;
    const id = spec.id || nextObjectId();
    const obj = {
      id,
      kind: spec.kind || 'sphere',
      geometry: spec.geometry || spec.kind || 'sphere',
      color: spec.color || this.config.drawing.defaultColor,
      position: { ...spec.position },
      velocity: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      size: spec.size ?? 1,
      scale: spec.scale ?? 1,
      state: OBJ_STATE.IDLE,
      selectable: false,
      grabOffset: { x: 0, y: 0, z: 0 },
      sourceStrokeId: spec.sourceStrokeId || null,
      bornAt: Date.now(),
      points: spec.points || null,
      params: spec.params || null,
    };
    // Keep it inside the volume.
    obj.position.x = clamp(obj.position.x, -world.width / 2, world.width / 2);
    obj.position.y = clamp(obj.position.y, world.floorY, world.height / 2);
    obj.position.z = clamp(obj.position.z, -world.depth / 2, world.depth / 2);
    this.objects.set(id, obj);
    return obj;
  }

  remove(id) {
    const obj = this.objects.get(id);
    if (!obj) return false;
    if (this.heldId === id) this.heldId = null;
    this.objects.delete(id);
    return true;
  }

  clear() {
    this.objects.clear();
    this.heldId = null;
  }

  /** Nearest object to a world point within `radius`. */
  nearest(worldPoint, radius) {
    let best = null;
    let bestDist = Infinity;
    for (const obj of this.objects.values()) {
      // A held or in-flight object is not a selection candidate.
      if (obj.state === OBJ_STATE.HELD || obj.state === OBJ_STATE.FLYING) continue;
      const d = dist3(obj.position, worldPoint);
      if (d < radius && d < bestDist) {
        bestDist = d;
        best = obj;
      }
    }
    return best ? { object: best, distance: bestDist } : null;
  }

  /** Drop every hover highlight (used when the hand leaves the frame). */
  clearHover() {
    for (const obj of this.objects.values()) {
      if (obj.state === OBJ_STATE.HOVERED) obj.state = OBJ_STATE.IDLE;
      obj.selectable = false;
    }
  }

  /** Number of objects currently in flight (used by tests and the HUD). */
  flyingCount() {
    let n = 0;
    for (const obj of this.objects.values()) if (obj.state === OBJ_STATE.FLYING) n++;
    return n;
  }

  /** Update hover highlight. Called every frame with the cursor position. */
  updateHover(worldPoint) {
    const cfg = this.config.objects;
    if (this.heldId) {
      for (const obj of this.objects.values()) obj.selectable = obj.id === this.heldId;
      return this.held;
    }
    const hit = this.nearest(worldPoint, cfg.hoverRadius);
    for (const obj of this.objects.values()) {
      // Never clobber a flying object's state - doing so would cancel the
      // throw the moment the cursor happened to be near the release point.
      if (obj.state === OBJ_STATE.FLYING || obj.state === OBJ_STATE.HELD) {
        obj.selectable = false;
        continue;
      }
      obj.selectable = hit ? obj.id === hit.object.id : false;
      if (obj.state === OBJ_STATE.HOVERED && (!hit || hit.object.id !== obj.id)) {
        obj.state = OBJ_STATE.IDLE;
      }
    }
    if (hit) {
      hit.object.state = OBJ_STATE.HOVERED;
      return hit.object;
    }
    return null;
  }

  /**
   * Try to grab the nearest object to the hand.
   * @returns {object|null} the grabbed object
   */
  grab(worldPoint) {
    if (this.heldId) return this.held;
    const cfg = this.config.objects;
    const hit = this.nearest(worldPoint, cfg.grabRadius);
    if (!hit) return null;
    const obj = hit.object;
    obj.state = OBJ_STATE.HELD;
    obj.velocity = { x: 0, y: 0, z: 0 };
    // Preserve the offset so the object does not jump into the palm.
    obj.grabOffset = {
      x: obj.position.x - worldPoint.x,
      y: obj.position.y - worldPoint.y,
      z: obj.position.z - worldPoint.z,
    };
    this.heldId = obj.id;
    this.lastHandPos = { ...worldPoint };
    this.handVelocity = { x: 0, y: 0, z: 0, speed: 0 };
    this.velocityHistory.length = 0;
    this.events.push({ type: 'grab', id: obj.id, position: { ...obj.position } });
    return obj;
  }

  /**
   * Move the held object toward the hand. Call once per frame while held.
   * @param {{x:number,y:number,z:number}} handPos world position of the hand
   * @param {number} dt seconds
   */
  drag(handPos, dt) {
    const obj = this.held;
    if (!obj) return null;

    this.simTime += dt;
    if (this.lastHandPos && dt > 0) {
      this.handVelocity = {
        x: (handPos.x - this.lastHandPos.x) / dt,
        y: (handPos.y - this.lastHandPos.y) / dt,
        z: (handPos.z - this.lastHandPos.z) / dt,
        speed: 0,
      };
      this.handVelocity.speed = Math.hypot(
        this.handVelocity.x,
        this.handVelocity.y,
        this.handVelocity.z,
      );
      this.velocityHistory.push({ ...this.handVelocity, at: this.simTime });
      while (this.velocityHistory.length > 16) this.velocityHistory.shift();
    }
    this.lastHandPos = { ...handPos };

    const cfg = this.config.objects;
    const target = {
      x: handPos.x + obj.grabOffset.x,
      y: handPos.y + obj.grabOffset.y,
      z: handPos.z + obj.grabOffset.z,
    };
    const a = followAlpha(cfg.followStiffness, dt);
    obj.position.x += (target.x - obj.position.x) * a;
    obj.position.y += (target.y - obj.position.y) * a;
    obj.position.z += (target.z - obj.position.z) * a;
    obj.velocity = { x: 0, y: 0, z: 0 };
    obj.state = OBJ_STATE.HELD;
    return obj;
  }

  /**
   * Release the held object, applying a throw impulse when the hand was moving
   * fast enough and throwing is enabled.
   * @returns {object|null} the released object
   */
  release() {
    return this._release(true);
  }

  /**
   * Release the held object WITHOUT any throw impulse. Used when the hand is
   * lost from the frame or interaction is paused: the brief requires that a
   * tracking dropout must never fling an object across the room.
   */
  drop() {
    return this._release(false);
  }

  _release(allowThrow) {
    const obj = this.held;
    this.heldId = null;
    this.lastHandPos = null;
    if (!obj) return null;

    const cfg = this.config.objects;
    const v = this._peakVelocity();
    if (allowThrow && this.config.throwEnabled && v.speed > cfg.throwMinSpeed) {
      obj.velocity = {
        x: v.x * cfg.throwGain,
        y: v.y * cfg.throwGain,
        z: v.z * cfg.throwGain,
      };
      obj.state = OBJ_STATE.FLYING;
      this.events.push({ type: 'throw', id: obj.id, speed: v.speed });
    } else {
      obj.velocity = { x: 0, y: 0, z: 0 };
      obj.state = OBJ_STATE.IDLE;
      this.events.push({ type: 'place', id: obj.id, position: { ...obj.position } });
    }
    obj.selectable = false;
    this.handVelocity = { x: 0, y: 0, z: 0, speed: 0 };
    return obj;
  }

  /**
   * Fastest hand velocity within the recent throw window. Falls back to the
   * instantaneous velocity when the window is empty.
   */
  _peakVelocity() {
    const cutoff = this.simTime - 0.14;
    let best = this.handVelocity;
    for (const s of this.velocityHistory) {
      if (s.at >= cutoff && s.speed > best.speed) best = s;
    }
    return best;
  }

  /** Apply uniform scale + rotation from the two-hand controller. */
  applyTransform(scale, rotationDeg) {
    const obj = this.held;
    if (!obj) return null;
    const cfg = this.config.objects;
    const base = obj.baseScale ?? obj.scale;
    obj.scale = clamp(base * scale, cfg.minScale, cfg.maxScale);
    obj.rotation.z = (rotationDeg * Math.PI) / 180;
    return obj;
  }

  /** Remember the scale at the moment a two-hand transform began. */
  beginTransform() {
    const obj = this.held;
    if (obj) obj.baseScale = obj.scale;
    return obj;
  }

  /** Physics + housekeeping for all objects. Returns notable events. */
  update(dt) {
    const out = [];
    for (const obj of this.objects.values()) {
      if (obj.state === OBJ_STATE.FLYING) {
        const evs = stepPhysics(obj, dt, this.config);
        for (const e of evs) out.push({ type: e, id: obj.id });
      }
    }
    out.push(...this.events);
    this.events.length = 0;
    return out;
  }

  toJSON() {
    return {
      version: 1,
      objects: this.all().map((o) => ({
        id: o.id,
        kind: o.kind,
        geometry: o.geometry,
        color: o.color,
        position: { ...o.position },
        rotation: { ...o.rotation },
        size: o.size,
        scale: o.scale,
        points: o.points,
        params: o.params,
      })),
    };
  }

  loadJSON(data) {
    if (!data || !Array.isArray(data.objects)) return false;
    this.clear();
    for (const spec of data.objects) this.add(spec);
    return true;
  }
}
