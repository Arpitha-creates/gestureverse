import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createConfig } from '../src/core/config.js';
import { recognizeShape, SHAPE } from '../src/drawing/shapeRecognizer.js';

const cfg = createConfig();

function closeLoop(pts) {
  return pts.concat([{ ...pts[0] }]);
}

function circle(cx, cy, r, n = 48) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return closeLoop(pts);
}

function polygon(corners, perEdge = 12) {
  const pts = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    for (let j = 0; j < perEdge; j++) {
      const t = j / perEdge;
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return closeLoop(pts);
}

function star(cx, cy, R, r, points = 5) {
  const pts = [];
  const n = points * 2;
  for (let i = 0; i < n; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
  }
  return closeLoop(pts);
}

/** Classic parametric heart outline (y flipped for screen coordinates). */
function heart(cx, cy, scale = 8, n = 72) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push({ x: cx + x * scale, y: cy - y * scale });
  }
  return closeLoop(pts);
}

function line(a, b, n = 30) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return pts;
}

function arc(cx, cy, r, from, to, n = 30) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

test('a drawn circle is recognised as a circle', () => {
  const r = recognizeShape(circle(200, 200, 100), cfg);
  assert.equal(r.shape, SHAPE.CIRCLE);
  assert.ok(r.confidence > 0.6, `confidence ${r.confidence}`);
  assert.equal(r.closed, true);
});

test('a drawn square is recognised as a square, not a circle', () => {
  const r = recognizeShape(polygon([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }]), cfg);
  assert.equal(r.shape, SHAPE.SQUARE);
});

test('a 2:1 rectangle is recognised as a rectangle', () => {
  const r = recognizeShape(polygon([{ x: 100, y: 150 }, { x: 300, y: 150 }, { x: 300, y: 250 }, { x: 100, y: 250 }]), cfg);
  assert.equal(r.shape, SHAPE.RECTANGLE);
});

test('a drawn triangle is recognised as a triangle', () => {
  const r = recognizeShape(polygon([{ x: 200, y: 80 }, { x: 320, y: 300 }, { x: 80, y: 300 }]), cfg);
  assert.equal(r.shape, SHAPE.TRIANGLE);
});

test('a five-point star is recognised as a star', () => {
  const r = recognizeShape(star(200, 200, 110, 45), cfg);
  assert.equal(r.shape, SHAPE.STAR);
});

test('a straight stroke is recognised as a line', () => {
  const r = recognizeShape(line({ x: 50, y: 300 }, { x: 350, y: 120 }), cfg);
  assert.equal(r.shape, SHAPE.LINE);
  assert.equal(r.closed, false);
});

test('an open arc is recognised as a curve, not a closed shape', () => {
  const r = recognizeShape(arc(200, 250, 120, Math.PI, Math.PI * 2), cfg);
  assert.equal(r.shape, SHAPE.CURVE);
  assert.equal(r.closed, false);
});

test('an ellipse is distinguished from a circle', () => {
  const pts = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    pts.push({ x: 250 + 160 * Math.cos(a), y: 200 + 70 * Math.sin(a) });
  }
  const r = recognizeShape(closeLoop(pts), cfg);
  assert.equal(r.shape, SHAPE.ELLIPSE);
});

test('a shape with a deep concavity is flagged as a heart candidate', () => {
  const r = recognizeShape(heart(240, 200, 9), cfg);
  assert.equal(r.shape, SHAPE.HEART);
  assert.ok(r.confidence >= 0.5 && r.confidence < 0.8, 'heart confidence stays conservative');
});

test('every verdict carries a confidence and alternative candidates', () => {
  const r = recognizeShape(polygon([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }]), cfg);
  assert.ok(typeof r.confidence === 'number');
  assert.ok(r.confidence >= 0 && r.confidence <= 1);
  assert.ok(Array.isArray(r.alternatives));
});

test('too few points is reported as unknown rather than guessed', () => {
  const r = recognizeShape([{ x: 0, y: 0 }, { x: 1, y: 1 }], cfg);
  assert.equal(r.shape, SHAPE.UNKNOWN);
});
