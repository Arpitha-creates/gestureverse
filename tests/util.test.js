import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OneEuroFilter,
  OneEuroPoint,
  clamp,
  shortestAngle,
  simplifyRDP,
  polygonArea,
  polylineLength,
  resample,
  centroid,
  countCorners,
} from '../src/core/util.js';

test('clamp bounds values', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(0.5, 0, 1), 0.5);
});

test('shortestAngle wraps into (-PI, PI]', () => {
  assert.ok(Math.abs(shortestAngle(Math.PI * 2 + 0.1) - 0.1) < 1e-9);
  assert.ok(Math.abs(shortestAngle(-Math.PI * 2 - 0.1) + 0.1) < 1e-9);
  assert.ok(Math.abs(shortestAngle(3.1) - 3.1) < 1e-9);
});

test('the One Euro filter converges on a constant signal', () => {
  const f = new OneEuroFilter({ minCutoff: 1, beta: 0.02 });
  let out = 0;
  for (let i = 0; i < 200; i++) out = f.filter(0.7, i / 60);
  assert.ok(Math.abs(out - 0.7) < 1e-3);
});

test('the One Euro filter lags a jump but always gets there', () => {
  const f = new OneEuroFilter({ minCutoff: 1, beta: 0.02 });
  for (let i = 0; i < 60; i++) f.filter(0, i / 60);
  const justAfter = f.filter(1, 61 / 60);
  assert.ok(justAfter > 0 && justAfter < 1, 'it must not teleport');
  let out = justAfter;
  for (let i = 62; i < 400; i++) out = f.filter(1, i / 60);
  assert.ok(Math.abs(out - 1) < 0.01);
});

test('OneEuroPoint smooths all three axes independently', () => {
  const p = new OneEuroPoint({ minCutoff: 2, beta: 0.03 });
  let out = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 200; i++) out = p.filter({ x: 0.2, y: 0.9, z: -0.4 }, i / 60);
  assert.ok(Math.abs(out.x - 0.2) < 1e-2);
  assert.ok(Math.abs(out.y - 0.9) < 1e-2);
  assert.ok(Math.abs(out.z + 0.4) < 1e-2);
});

test('a repeated timestamp never breaks the filter', () => {
  const f = new OneEuroFilter();
  f.filter(0.1, 1);
  const out = f.filter(0.5, 1);
  assert.ok(Number.isFinite(out));
});

test('RDP drops collinear points and keeps corners', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.001 },
    { x: 1, y: 0 },
  ];
  assert.equal(simplifyRDP(line, 0.01).length, 2);

  const corner = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 0 },
  ];
  assert.equal(simplifyRDP(corner, 0.01).length, 3);
});

test('RDP survives a very long stroke without overflowing', () => {
  const pts = [];
  for (let i = 0; i < 5000; i++) pts.push({ x: i / 5000, y: Math.sin(i / 40) * 0.1 });
  const out = simplifyRDP(pts, 0.001);
  assert.ok(out.length > 2 && out.length < pts.length);
});

test('polygon area and perimeter are sane for a unit square', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  assert.ok(Math.abs(polygonArea(square) - 1) < 1e-9);
  assert.ok(Math.abs(polylineLength([...square, square[0]]) - 4) < 1e-9);
  assert.equal(countCorners(square), 4);
});

test('resample produces evenly spaced points', () => {
  const out = resample([{ x: 0, y: 0 }, { x: 1, y: 0 }], 5);
  assert.equal(out.length, 5);
  assert.ok(Math.abs(out[2].x - 0.5) < 1e-6);
});

test('centroid of a symmetric ring is its middle', () => {
  const c = centroid([
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ]);
  assert.ok(Math.abs(c.x) < 1e-9 && Math.abs(c.y) < 1e-9);
});
