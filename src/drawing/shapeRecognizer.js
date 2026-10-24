/**
 * GestureVerse - draw-to-object shape recognition.
 *
 * Contour-analysis classifier over a hand-drawn stroke. Deliberately
 * conservative: it returns a confidence with every verdict, and the app asks
 * the user to confirm when confidence is low. It never claims to recognise
 * arbitrary doodles - only a known set of geometric primitives plus a
 * best-effort heart.
 *
 * Two pieces of maths worth calling out, because both fix real bugs:
 *
 * 1. Circularity (4*pi*A/P^2) cannot separate a square from a circle on its
 *    own - a perfect square scores 0.785 and a circle ~0.99. The circle test
 *    therefore also requires >= 6 simplified vertices, which rules out a
 *    quadrilateral.
 * 2. A star and a heart both have concave regions, so they are separated by
 *    the NUMBER of deep concavity clusters: a star has one per point (5 for a
 *    five-point star), a heart has exactly one.
 */

import {
  bbox,
  centroid,
  convexHull,
  dist2,
  pathLength,
  pointLineDistance,
  polygonArea,
  rdp,
} from '../core/math.js';

export const SHAPE = {
  CIRCLE: 'circle',
  ELLIPSE: 'ellipse',
  TRIANGLE: 'triangle',
  SQUARE: 'square',
  RECTANGLE: 'rectangle',
  PENTAGON: 'pentagon',
  POLYGON: 'polygon',
  STAR: 'star',
  HEART: 'heart',
  LINE: 'line',
  CURVE: 'curve',
  UNKNOWN: 'unknown',
};

/**
 * Drop vertices that are almost collinear with their neighbours. Removes the
 * extra corners that hand tremor introduces into an otherwise clean polygon.
 */
function simplifyCollinear(vertices, angleThreshold = 165) {
  if (vertices.length < 3) return vertices;
  const out = [];
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const cur = vertices[i];
    const next = vertices[(i + 1) % n];
    const a1 = Math.atan2(cur.y - prev.y, cur.x - prev.x);
    const a2 = Math.atan2(next.y - cur.y, next.x - cur.x);
    let deg = (Math.abs((a2 - a1) * 180) / Math.PI) % 360;
    if (deg > 180) deg = 360 - deg;
    const turn = 180 - deg; // 0 = perfectly straight
    if (turn > 180 - angleThreshold) out.push(cur);
  }
  return out.length >= 3 ? out : vertices;
}

/** Radial alternation test: outer point, inner valley, outer point, ... */
function starAnalysis(vertices, c) {
  if (vertices.length < 6) return { isStar: false, points: 0, score: 0 };
  const r = vertices.map((v) => dist2(v.x, v.y, c.x, c.y));
  const mean = r.reduce((a, b) => a + b, 0) / r.length || 1;
  const signs = r.map((v) => (v > mean ? 1 : -1));
  let alternations = 0;
  for (let i = 0; i < signs.length; i++) {
    if (signs[i] !== signs[(i + 1) % signs.length]) alternations++;
  }
  const altRatio = alternations / signs.length;
  const spread = (Math.max(...r) - Math.min(...r)) / mean;
  const isStar = altRatio > 0.75 && spread > 0.3 && signs.length >= 8;
  return { isStar, points: Math.round(signs.length / 2), score: altRatio * spread };
}

/**
 * How far each contour point sits inside the convex hull, plus the number of
 * separate deep pockets. A heart has one pocket; a star has one per point.
 */
function concavity(points, hull) {
  const depths = points.map((p) => {
    let best = Infinity;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i];
      const b = hull[(i + 1) % hull.length];
      best = Math.min(best, pointLineDistance(p, a, b));
    }
    return best;
  });
  const maxDepth = Math.max(...depths);

  // Count contiguous runs of points deeper than half the maximum. Rotating the
  // scan to start at a shallow point stops one pocket being split in two at
  // the wrap-around seam.
  const threshold = maxDepth * 0.5;
  const n = depths.length;
  let start = depths.findIndex((d) => d <= threshold);
  if (start === -1) start = 0;
  let clusters = 0;
  let inCluster = false;
  for (let k = 0; k < n; k++) {
    const d = depths[(start + k) % n];
    if (d > threshold) {
      if (!inCluster) {
        clusters++;
        inCluster = true;
      }
    } else {
      inCluster = false;
    }
  }
  return { depths, maxDepth, clusters };
}

function quadIsSquare(v) {
  const sides = [];
  for (let i = 0; i < 4; i++) {
    const a = v[i];
    const b = v[(i + 1) % 4];
    sides.push(dist2(a.x, a.y, b.x, b.y));
  }
  const mean = sides.reduce((a, b) => a + b, 0) / 4 || 1;
  const variance = sides.reduce((a, b) => a + (b - mean) ** 2, 0) / 4;
  const cv = Math.sqrt(variance) / mean;
  return cv < 0.18;
}

function result(shape, confidence, closed, vertices, alternatives) {
  return {
    shape,
    confidence: Math.max(0, Math.min(1, confidence)),
    closed,
    vertices: (vertices || []).map((v) => ({ x: v.x, y: v.y })),
    alternatives: alternatives || [],
  };
}

/**
 * Classify a stroke.
 * @param {Array<{x:number,y:number}>} points
 * @param {object} config full GestureVerse config
 */
export function recognizeShape(points, config) {
  const cfg = config.drawing.shape;
  const n = points.length;

  if (n < 4) return result(SHAPE.UNKNOWN, 0, false, [], []);

  const box = bbox(points);
  const diag = box.diag || 1e-6;
  const first = points[0];
  const last = points[n - 1];
  const closed = dist2(first.x, first.y, last.x, last.y) < cfg.closednessRatio * diag;

  // --- open strokes: line vs curve --------------------------------------
  if (!closed) {
    let maxDev = 0;
    for (const p of points) maxDev = Math.max(maxDev, pointLineDistance(p, first, last));
    const devRatio = maxDev / diag;
    if (devRatio < 0.06 && n >= cfg.minPoints) {
      const straightness = 1 - devRatio / 0.06;
      return result(SHAPE.LINE, 0.6 + 0.4 * straightness, false, [first, last], [
        { shape: SHAPE.CURVE, confidence: 0.4 },
      ]);
    }
    if (n < cfg.minPoints) return result(SHAPE.CURVE, 0.35, false, [], []);
    return result(SHAPE.CURVE, 0.55, false, [], []);
  }

  if (n < cfg.minPoints) return result(SHAPE.CURVE, 0.35, false, [], []);

  const c = centroid(points);
  const area = polygonArea(points);
  const perim = pathLength(points, true) || 1e-6;
  const circularity = (4 * Math.PI * area) / (perim * perim);
  const aspect = box.height > 0 ? box.width / box.height : 1;

  // --- simplify to corner vertices --------------------------------------
  const closedPath = points.concat([{ ...first }]);
  let vertices = rdp(closedPath, cfg.simplifyRatio * diag);
  if (vertices.length > 1) vertices = vertices.slice(0, -1); // drop duplicate start
  vertices = simplifyCollinear(vertices);
  const vcount = vertices.length;

  // --- star (before heart: a star is a multi-valley shape) --------------
  const star = starAnalysis(vertices, c);
  if (star.isStar) {
    return result(SHAPE.STAR, Math.min(0.95, 0.5 + star.score * 0.3), true, vertices, [
      { shape: SHAPE.POLYGON, confidence: 0.4 },
    ]);
  }

  // --- heart (best effort, deliberately conservative) --------------------
  if (vcount >= 4 && vcount <= 14 && circularity < 0.8) {
    const hull = convexHull(points);
    if (hull.length >= 4) {
      const { maxDepth, clusters } = concavity(points, hull);
      const deepRatio = maxDepth / diag;
      const widerThanTall = box.width > box.height * 0.85;
      if (deepRatio > 0.09 && deepRatio < 0.32 && widerThanTall && clusters === 1) {
        return result(SHAPE.HEART, 0.5 + Math.min(0.22, deepRatio), true, vertices, [
          { shape: SHAPE.POLYGON, confidence: 0.4 },
        ]);
      }
    }
  }

  // --- circle / ellipse (needs enough vertices to rule out a quad) -------
  if (vcount >= 6) {
    const roundish = circularity >= cfg.ellipseCircularity;
    if (roundish && aspect >= 0.78 && aspect <= 1.28 && circularity >= cfg.circleCircularity) {
      return result(SHAPE.CIRCLE, Math.min(0.98, 0.55 + circularity * 0.4), true, vertices, [
        { shape: SHAPE.ELLIPSE, confidence: 0.3 },
      ]);
    }
    if (roundish && (aspect > 1.28 || aspect < 0.78)) {
      return result(SHAPE.ELLIPSE, Math.min(0.9, 0.55 + circularity * 0.3), true, vertices, [
        { shape: SHAPE.CIRCLE, confidence: 0.4 },
      ]);
    }
  }

  // --- polygons ----------------------------------------------------------
  if (vcount === 3) {
    return result(SHAPE.TRIANGLE, 0.82, true, vertices, [
      { shape: SHAPE.POLYGON, confidence: 0.3 },
    ]);
  }
  if (vcount === 4) {
    const isSquare = quadIsSquare(vertices) && aspect > 0.8 && aspect < 1.25;
    return result(isSquare ? SHAPE.SQUARE : SHAPE.RECTANGLE, 0.78, true, vertices, [
      { shape: isSquare ? SHAPE.RECTANGLE : SHAPE.SQUARE, confidence: 0.35 },
    ]);
  }
  if (vcount === 5) {
    return result(SHAPE.PENTAGON, 0.65, true, vertices, [
      { shape: SHAPE.POLYGON, confidence: 0.4 },
    ]);
  }
  if (vcount >= 6) {
    return result(SHAPE.POLYGON, 0.55, true, vertices, []);
  }

  return result(SHAPE.UNKNOWN, 0.3, true, vertices, []);
}
