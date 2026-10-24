/**
 * GestureVerse - two-hand scale / rotate controller.
 *
 * Uses the separation and orientation of the two palms to drive uniform scale
 * and rotation of a held object. Everything is expressed as deltas relative to
 * the pose at the moment the second hand joined, so the object never jumps.
 *
 * Kept pure (no renderer references) so it can be unit-tested directly.
 */

import { angleDelta, clamp, dist2, lerp } from '../core/math.js';

export const TWO_HAND_EVENT = {
  START: 'twohand_start',
  END: 'twohand_end',
};

export class TwoHandController {
  constructor(config) {
    this.config = config;
    this.active = false;
    this.baselineSeparation = 0;
    this.baselineAngle = 0;
    this.lastAngle = 0;
    this.totalRotation = 0;
    this.separation = 0;
    this.angle = 0;
    this.scale = 1;
    this.rotation = 0;
    this.smoothedScale = 1;
    this.smoothedRotation = 0;
    this.confirmCount = 0;
    this.center = { x: 0.5, y: 0.5 };
  }

  reset() {
    this.active = false;
    this.baselineSeparation = 0;
    this.baselineAngle = 0;
    this.lastAngle = 0;
    this.totalRotation = 0;
    this.scale = 1;
    this.rotation = 0;
    this.smoothedScale = 1;
    this.smoothedRotation = 0;
    this.confirmCount = 0;
  }

  /**
   * @param {{x:number,y:number}|null} palmA mirrored/raw palm center, normalized
   * @param {{x:number,y:number}|null} palmB
   * @param {number} dt seconds
   */
  update(palmA, palmB, dt) {
    const events = [];
    const cfg = this.config.twoHand;

    if (!palmA || !palmB) {
      if (this.active) events.push({ type: TWO_HAND_EVENT.END });
      this.active = false;
      this.confirmCount = 0;
      return this._result(events, 0, 0);
    }

    const separation = dist2(palmA.x, palmA.y, palmB.x, palmB.y);
    const angle = (Math.atan2(palmB.y - palmA.y, palmB.x - palmA.x) * 180) / Math.PI;
    const center = { x: (palmA.x + palmB.x) / 2, y: (palmA.y + palmB.y) / 2 };

    if (separation < cfg.minSeparation) {
      if (this.active) events.push({ type: TWO_HAND_EVENT.END });
      this.active = false;
      this.confirmCount = 0;
      return this._result(events, 0, 0);
    }

    if (!this.active) {
      this.confirmCount++;
      if (this.confirmCount >= cfg.confirmFrames) {
        this.active = true;
        this.baselineSeparation = separation;
        this.baselineAngle = angle;
        this.lastAngle = angle;
        this.totalRotation = 0;
        this.smoothedScale = 1;
        this.smoothedRotation = 0;
        events.push({ type: TWO_HAND_EVENT.START, center });
      }
    } else {
      const rawScale = clamp(separation / Math.max(this.baselineSeparation, 1e-4), 0.2, 5);
      const targetScale = 1 + (rawScale - 1) * cfg.scaleGain;
      this.smoothedScale = lerp(this.smoothedScale, targetScale, cfg.smoothing);

      const dAngle = angleDelta(this.lastAngle, angle) * cfg.rotateGain;
      this.lastAngle = angle;
      this.totalRotation += dAngle;
      this.smoothedRotation = lerp(this.smoothedRotation, this.totalRotation, cfg.smoothing);
    }

    this.separation = separation;
    this.angle = angle;
    this.center = center;
    this.scale = this.smoothedScale;
    this.rotation = this.smoothedRotation;

    return this._result(events, this.smoothedScale, this.smoothedRotation);
  }

  _result(events, scale, rotation) {
    return {
      active: this.active,
      events,
      scale,
      rotation,
      separation: this.separation,
      angle: this.angle,
      center: this.center,
    };
  }
}
