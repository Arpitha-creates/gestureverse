/** Small dependency-free maths helpers shared by every module. */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

export function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
}

/** Wrap an angle difference into (-PI, PI]. */
export function shortestAngle(a) {
  let x = (a + Math.PI) % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x - Math.PI;
}

/* ------------------------------------------------------------------ filters */

class LowPass {
  constructor() {
    this.y = null;
  }
  filter(x, alpha) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
  reset() {
    this.y = null;
  }
}

/**
 * The One Euro filter (Casiez et al. 2012): heavy smoothing when the signal is
 * slow, almost none when it moves fast. Exactly what a fingertip cursor needs.
 */
export class OneEuroFilter {
  constructor({ minCutoff = 1.0, beta = 0.0, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xf = new LowPass();
    this.dxf = new LowPass();
    this.lastX = null;
    this.lastT = null;
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** @param {number} x value @param {number} t time in SECONDS */
  filter(x, t) {
    if (this.lastT === null) {
      this.lastT = t;
      this.lastX = x;
      this.xf.filter(x, 1);
      this.dxf.filter(0, 1);
      return x;
    }
    let dt = t - this.lastT;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.5) dt = 0.5;
    this.lastT = t;

    const dx = (x - this.lastX) / dt;
    this.lastX = x;
    const edx = this.dxf.filter(dx, OneEuroFilter.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xf.filter(x, OneEuroFilter.alpha(cutoff, dt));
  }

  reset() {
    this.xf.reset();
    this.dxf.reset();
    this.lastX = null;
    this.lastT = null;
  }
}

/** A One Euro filter applied to a {x,y,z} point. */
export class OneEuroPoint {
  constructor(opts = {}) {
    this.fx = new OneEuroFilter(opts);
    this.fy = new OneEuroFilter(opts);
    this.fz = new OneEuroFilter(opts);
  }
  filter(p, t) {
    return { x: this.fx.filter(p.x, t), y: this.fy.filter(p.y, t), z: this.fz.filter(p.z || 0, t) };
  }
  reset() {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}

/* --------------------------------------------------------------- geometry */

export function polylineLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist2(pts[i - 1], pts[i]);
  return total;
}

/** Shoelace area, always positive. */
export function polygonArea(pts) {
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function centroid(pts) {
  if (!pts.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

/** Squared distance from point p to segment ab. */
export function pointSegSq(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = clamp01(t);
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return (p.x - cx) ** 2 + (p.y - cy) ** 2;
}

/**
 * Ramer-Douglas-Peucker simplification, iterative so a 1200 point stroke can
 * never blow the stack.
 */
export function simplifyRDP(points, tol) {
  const n = points.length;
  if (n < 3) return points.slice();
  const sq = tol * tol;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegSq(points[i], points[a], points[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > sq && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * Laplacian smoothing of an open polyline, endpoints pinned.
 *
 * Run over a committed stroke this removes the residual fingertip noise that
 * survives the live filter, without shortening the line or rounding its ends.
 */
export function smoothPolyline(points, passes = 2, weight = 0.25) {
  if (points.length < 3 || passes <= 0) return points.map((p) => ({ ...p }));
  let pts = points.map((p) => ({ ...p }));
  for (let pass = 0; pass < passes; pass++) {
    const next = pts.map((p) => ({ ...p }));
    for (let i = 1; i < pts.length - 1; i++) {
      next[i].x = pts[i].x + weight * ((pts[i - 1].x + pts[i + 1].x) / 2 - pts[i].x);
      next[i].y = pts[i].y + weight * ((pts[i - 1].y + pts[i + 1].y) / 2 - pts[i].y);
    }
    pts = next;
  }
  return pts;
}

/** Number of sharp direction changes around a closed polygon. */
export function countCorners(pts, minTurnRadians = 0.62) {
  const n = pts.length;
  if (n < 3) return 0;
  let corners = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const v1x = a.x - b.x;
    const v1y = a.y - b.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const n1 = Math.hypot(v1x, v1y);
    const n2 = Math.hypot(v2x, v2y);
    if (n1 < 1e-9 || n2 < 1e-9) continue;
    const cos = clamp((v1x * v2x + v1y * v2y) / (n1 * n2), -1, 1);
    const turn = Math.PI - Math.acos(cos); // how far the path bends here
    if (turn > minTurnRadians) corners++;
  }
  return corners;
}

/** Even arc-length resample of an open polyline. */
export function resample(points, count) {
  if (points.length < 2) return points.slice();
  const total = polylineLength(points);
  if (total < 1e-9) return points.slice();
  const step = total / (count - 1);
  const out = [points[0]];
  let target = step;
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    let a = points[i - 1];
    let b = points[i];
    let segLen = dist2(a, b);
    while (segLen >= target - travelled && segLen > 1e-9) {
      const t = (target - travelled) / segLen;
      const nx = a.x + (b.x - a.x) * t;
      const ny = a.y + (b.y - a.y) * t;
      out.push({ x: nx, y: ny });
      a = { x: nx, y: ny };
      travelled = target;
      target += step;
      segLen = dist2(a, b);
    }
    travelled += segLen;
  }
  if (out.length < count) out.push(points[points.length - 1]);
  return out.slice(0, count);
}

/** min/max radius about the centroid. A star has a low ratio, a circle ~1. */
export function radiusSpread(points) {
  const c = centroid(points);
  let min = Infinity;
  let max = 0;
  for (const p of points) {
    const r = Math.hypot(p.x - c.x, p.y - c.y);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  return { min, max, ratio: max > 1e-9 ? min / max : 0, centroid: c };
}
