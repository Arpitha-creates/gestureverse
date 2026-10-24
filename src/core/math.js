/**
 * GestureVerse - pure math helpers.
 *
 * Everything here is side-effect free so it can be unit-tested in Node
 * without a DOM, WebGL context or webcam.
 */

export const EPS = 1e-9;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v) {
  return clamp(v, 0, 1);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function inverseLerp(a, b, v) {
  return Math.abs(b - a) < EPS ? 0 : (v - a) / (b - a);
}

/** Remap v from [a,b] to [c,d], clamped. */
export function remap(v, a, b, c, d) {
  return lerp(c, d, clamp01(inverseLerp(a, b, v)));
}

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

export function dist2Sq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function dist3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Angle in degrees at vertex b, formed by rays b->a and b->c.
 * Returns 180 for a perfectly straight joint.
 */
export function angleAt(a, b, c) {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v1z = (a.z || 0) - (b.z || 0);
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const v2z = (c.z || 0) - (b.z || 0);
  const n1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z) || EPS;
  const n2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z) || EPS;
  let cos = (v1x * v2x + v1y * v2y + v1z * v2z) / (n1 * n2);
  cos = clamp(cos, -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Signed shortest angular difference b - a, wrapped to [-180, 180]. */
export function angleDelta(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function bbox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!points.length) {
    minX = minY = maxX = maxY = 0;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    diag: Math.sqrt(width * width + height * height),
  };
}

/** Absolute shoelace area of a polygon. */
export function polygonArea(points) {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function pathLength(points, closed = false) {
  const n = points.length;
  if (n < 2) return 0;
  let len = 0;
  for (let i = 1; i < n; i++) {
    len += dist2(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  }
  if (closed) {
    const a = points[n - 1];
    const b = points[0];
    len += dist2(a.x, a.y, b.x, b.y);
  }
  return len;
}

export function centroid(points) {
  if (!points.length) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

/** Perpendicular distance from p to the infinite line through a and b. */
export function pointLineDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < EPS) return dist2(p.x, p.y, a.x, a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

/**
 * Ramer-Douglas-Peucker polyline simplification.
 * Used by the shape recognizer to turn a wobbly hand-drawn stroke into a
 * small set of corner vertices.
 */
export function rdp(points, epsilon) {
  if (points.length < 3) return points.slice();

  const first = points[0];
  const last = points[points.length - 1];
  let index = -1;
  let maxDist = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const d = pointLineDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > epsilon && index !== -1) {
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

/** Andrew's monotone chain convex hull. Returns CCW hull, no duplicate end point. */
export function convexHull(points) {
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Signed turn direction at b for the path a->b->c. >0 = left turn. */
export function cross2(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function mean(values) {
  if (!values.length) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function stdDev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / (values.length - 1));
}

/** Small deterministic PRNG so particle spawns are reproducible in tests. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
