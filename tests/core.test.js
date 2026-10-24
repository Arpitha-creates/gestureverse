import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OneEuroFilter, OneEuroPoint, VelocityTracker } from '../src/core/oneEuroFilter.js';
import {
  clamp, lerp, remap, dist2, angleAt, angleDelta, bbox, polygonArea,
  pathLength, pointLineDistance, rdp, convexHull, mean,
} from '../src/core/math.js';

test('One Euro filter passes a constant signal through unchanged', () => {
  const f = new OneEuroFilter();
  let out = 0;
  for (let i = 0; i < 40; i++) out = f.filter(5, i / 60);
  assert.ok(Math.abs(out - 5) < 1e-6);
});

test('One Euro filter reduces jitter on a noisy signal', () => {
  const f = new OneEuroFilter({ minCutoff: 1.0, beta: 0.0 });
  const raw = [];
  const filtered = [];
  let seed = 1;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };
  for (let i = 0; i < 120; i++) {
    const v = 1 + rand() * 0.2;
    raw.push(v);
    filtered.push(f.filter(v, i / 60));
  }
  const sd = (arr) => {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
  };
  assert.ok(sd(filtered) < sd(raw), 'filtered signal should be smoother than raw');
});

test('a higher beta lets fast motion through (speed coupling works)', () => {
  const laggy = new OneEuroFilter({ minCutoff: 1.0, beta: 0.05 });
  const snappy = new OneEuroFilter({ minCutoff: 1.0, beta: 0.5 });
  let a = 0;
  let b = 0;
  for (let i = 0; i < 60; i++) {
    a = laggy.filter(i * 0.1, i / 60);
    b = snappy.filter(i * 0.1, i / 60);
  }
  assert.ok(b > a, 'a larger beta must track the ramp more closely');
  assert.ok(b > 5.3, `fast motion should not be over-smoothed (got ${b})`);
});

test('OneEuroPoint filters x, y and z independently', () => {
  const p = new OneEuroPoint();
  let out = null;
  for (let i = 0; i < 30; i++) out = p.filter({ x: 1, y: 2, z: 3 }, i / 60);
  assert.ok(Math.abs(out.x - 1) < 1e-3);
  assert.ok(Math.abs(out.y - 2) < 1e-3);
  assert.ok(Math.abs(out.z - 3) < 1e-3);
});

test('VelocityTracker estimates speed and direction', () => {
  const v = new VelocityTracker(6);
  for (let i = 0; i < 6; i++) v.push(i * 0.1, 0, 0, i / 60);
  const vel = v.velocity();
  assert.ok(vel.x > 0);
  assert.ok(vel.speed > 0);
});

test('VelocityTracker is zero with fewer than two samples', () => {
  const v = new VelocityTracker();
  v.push(1, 1, 0, 0);
  assert.equal(v.velocity().speed, 0);
});

test('scalar helpers behave', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(remap(5, 0, 10, 0, 100), 50);
  assert.ok(Math.abs(dist2(0, 0, 3, 4) - 5) < 1e-9);
  assert.ok(Math.abs(mean([1, 2, 3]) - 2) < 1e-9);
});

test('angleAt reports 180 for a straight joint', () => {
  const a = { x: -1, y: 0 };
  const b = { x: 0, y: 0 };
  const c = { x: 1, y: 0 };
  assert.ok(Math.abs(angleAt(a, b, c) - 180) < 1e-6);
  const d = { x: 0, y: 1 };
  assert.ok(Math.abs(angleAt(a, b, d) - 90) < 1e-6);
});

test('angleDelta wraps to the shortest path', () => {
  assert.equal(angleDelta(350, 10), 20);
  assert.equal(angleDelta(10, 350), -20);
});

test('bbox and polygonArea are correct for a square', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const b = bbox(sq);
  assert.equal(b.width, 10);
  assert.equal(b.height, 10);
  assert.equal(polygonArea(sq), 100);
  assert.equal(pathLength(sq, true), 40);
});

test('pointLineDistance measures perpendicular distance', () => {
  assert.ok(Math.abs(pointLineDistance({ x: 0, y: 5 }, { x: -10, y: 0 }, { x: 10, y: 0 }) - 5) < 1e-9);
});

test('rdp keeps a straight line to two points and preserves corners', () => {
  const line = [];
  for (let i = 0; i <= 20; i++) line.push({ x: i, y: 0 });
  assert.equal(rdp(line, 0.5).length, 2);

  const corner = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }];
  assert.equal(rdp(corner, 0.1).length, 3);
});

test('convexHull wraps a point cloud', () => {
  const pts = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    { x: 5, y: 5 }, { x: 3, y: 7 },
  ];
  const hull = convexHull(pts);
  assert.equal(hull.length, 4);
});
