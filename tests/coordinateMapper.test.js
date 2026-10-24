import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createConfig } from '../src/core/config.js';
import { CoordinateMapper } from '../src/core/coordinateMapper.js';

function mapper(overrides) {
  return new CoordinateMapper(createConfig(overrides));
}

test('mirroring flips x on the way out', () => {
  const m = mapper({ mirror: true });
  assert.ok(Math.abs(m.applyMirror(0.25) - 0.75) < 1e-9);
  const m2 = mapper({ mirror: false });
  assert.equal(m2.applyMirror(0.25), 0.25);
});

test('toCanvas maps normalized coords to viewport pixels', () => {
  const m = mapper({ mirror: false });
  m.setViewport(1000, 500);
  const p = m.toCanvas({ x: 0.5, y: 0.5 });
  assert.equal(p.x, 500);
  assert.equal(p.y, 250);
});

test('toWorld maps the frame corners into the interaction volume', () => {
  const m = mapper({ mirror: false });
  const w = m.config.world;
  const centre = m.toWorld({ x: 0.5, y: 0.5 }, w.sizeReference);
  assert.ok(Math.abs(centre.x) < 1e-6);
  assert.ok(Math.abs(centre.y) < 1e-6);

  const right = m.toWorld({ x: 0.99, y: 0.5 }, w.sizeReference);
  assert.ok(right.x > 0, 'right of frame is +x in world');
  const top = m.toWorld({ x: 0.5, y: 0.01 }, w.sizeReference);
  assert.ok(top.y > 0, 'top of frame is +y in world');
});

test('mirroring reverses horizontal world motion exactly once', () => {
  const mirrored = mapper({ mirror: true });
  const plain = mapper({ mirror: false });
  const a = mirrored.toWorld({ x: 0.2, y: 0.5 }, 0.16);
  const b = mirrored.toWorld({ x: 0.8, y: 0.5 }, 0.16);
  assert.ok(b.x < a.x, 'with mirroring, moving right on screen moves left in world');

  const pa = plain.toWorld({ x: 0.2, y: 0.5 }, 0.16);
  const pb = plain.toWorld({ x: 0.8, y: 0.5 }, 0.16);
  assert.ok(pb.x > pa.x, 'without mirroring, the mapping is not reversed');
});

test('a larger hand maps to a nearer depth', () => {
  const m = mapper();
  const small = m.depthFromHandScale(0.1);
  const big = m.depthFromHandScale(0.24);
  assert.ok(big > small, 'a closer hand (larger scale) should map nearer');
});

test('clampToWorld keeps points inside the volume', () => {
  const m = mapper();
  const w = m.config.world;
  const p = m.clampToWorld({ x: 999, y: -999, z: 999 });
  assert.ok(p.x <= w.width / 2 + 1e-9);
  assert.ok(p.y >= w.floorY - 1e-9);
  assert.ok(p.z <= w.depth / 2 + 1e-9);
});

test('worldToNormalized inverts toWorld at the centre', () => {
  const m = mapper({ mirror: true });
  const w = m.config.world;
  const n = m.worldToNormalized({ x: 0, y: 0, z: 0 });
  assert.ok(Math.abs(n.x - 0.5) < 1e-6);
  assert.ok(Math.abs(n.y - 0.5) < 1e-6);
});
