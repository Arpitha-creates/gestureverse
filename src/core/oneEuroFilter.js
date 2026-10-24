/**
 * GestureVerse - One Euro filter.
 *
 * Adaptive low-pass filter (Casiez et al. 2012). It removes the high
 * frequency jitter from MediaPipe landmarks while keeping fast hand motion
 * responsive: the cutoff frequency rises with the estimated speed, so slow
 * hands get heavy smoothing and fast hands get almost none.
 */

import { EPS } from './math.js';

class LowPass {
  constructor() {
    this.y = null;
    this.s = null;
  }

  filter(x, alpha) {
    this.s = this.y === null ? x : alpha * x + (1 - alpha) * this.s;
    this.y = x;
    return this.s;
  }

  reset() {
    this.y = null;
    this.s = null;
  }
}

export class OneEuroFilter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.minCutoff=1.0]  baseline cutoff (Hz). Lower = smoother/slower.
   * @param {number} [opts.beta=0.007]     speed coupling. Higher = more responsive to fast motion.
   * @param {number} [opts.dCutoff=1.0]    cutoff for the derivative estimate (Hz).
   */
  constructor({ minCutoff = 1.0, beta = 0.007, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilter = new LowPass();
    this.dxFilter = new LowPass();
    this.lastTime = null;
    this.lastValue = null;
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / Math.max(dt, EPS));
  }

  /** @param {number} x raw sample @param {number} timestamp seconds */
  filter(x, timestamp) {
    let dt = 1 / 60;
    if (this.lastTime !== null && timestamp > this.lastTime) {
      dt = timestamp - this.lastTime;
    }
    this.lastTime = timestamp;

    const dx = this.lastValue === null ? 0 : (x - this.lastValue) / Math.max(dt, EPS);
    const edx = this.dxFilter.filter(dx, OneEuroFilter.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const result = this.xFilter.filter(x, OneEuroFilter.alpha(cutoff, dt));

    this.lastValue = x;
    return result;
  }

  reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
    this.lastValue = null;
  }
}

/** Convenience wrapper that filters a 2D or 3D point component-wise. */
export class OneEuroPoint {
  constructor(opts = {}) {
    this.fx = new OneEuroFilter(opts);
    this.fy = new OneEuroFilter(opts);
    this.fz = new OneEuroFilter(opts);
  }

  /** @param {{x:number,y:number,z?:number}} p @param {number} t seconds */
  filter(p, t) {
    return {
      x: this.fx.filter(p.x, t),
      y: this.fy.filter(p.y, t),
      z: this.fz.filter(p.z || 0, t),
    };
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}

/**
 * Fixed-size ring buffer used to estimate hand velocity over a short window.
 * Velocity is expressed in units-per-second of whatever coordinate space the
 * samples are in.
 */
export class VelocityTracker {
  constructor(size = 6) {
    this.size = size;
    this.samples = [];
  }

  push(x, y, z, t) {
    this.samples.push({ x, y, z: z || 0, t });
    while (this.samples.length > this.size) this.samples.shift();
  }

  /** Least-squares-ish velocity from oldest to newest sample in the window. */
  velocity() {
    if (this.samples.length < 2) return { x: 0, y: 0, z: 0, speed: 0 };
    const a = this.samples[0];
    const b = this.samples[this.samples.length - 1];
    const dt = b.t - a.t;
    if (dt <= EPS) return { x: 0, y: 0, z: 0, speed: 0 };
    const vx = (b.x - a.x) / dt;
    const vy = (b.y - a.y) / dt;
    const vz = (b.z - a.z) / dt;
    return { x: vx, y: vy, z: vz, speed: Math.sqrt(vx * vx + vy * vy + vz * vz) };
  }

  clear() {
    this.samples.length = 0;
  }
}
