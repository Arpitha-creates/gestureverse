/**
 * Regression tests.
 *
 * Every test here corresponds to a bug that was actually present and shipped
 * past the first test suite. They all live in the browser-facing layer - the
 * part the pure unit tests could not reach - which is exactly why the Three.js
 * stub is now a small but faithful implementation rather than an auto-stub.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { installFakeDom } from './fakeDom.mjs';
import { createConfig } from '../src/core/config.js';
import { TOOL, StrokeManager } from '../src/drawing/strokeManager.js';
import { SHAPE } from '../src/drawing/shapeRecognizer.js';
import { descriptorForShape, GEOMETRY } from '../src/objects/objectFactory.js';
import { ObjectManager, OBJ_STATE } from '../src/objects/objectManager.js';
import { ObjectViewManager } from '../src/render/objectView.js';
import { StrokeRenderer } from '../src/render/strokeRenderer.js';
import { Effects } from '../src/render/effects.js';
import { CoordinateMapper } from '../src/core/coordinateMapper.js';
import { GestureRecognizer, STATE, EVENT } from '../src/gestures/gestureRecognizer.js';
import { makeHand, BEND } from './helpers/syntheticHand.js';

installFakeDom();

/* ------------------------------------------------------------------ *
 * Bug 1: a drawn rectangle became a sphere.
 * The `rect` tool id never matched the `rectangle` shape key, so the
 * geometry lookup fell through to the default.
 * ------------------------------------------------------------------ */

test('every parametric drawing tool maps to a sensible 3D geometry', () => {
  const expected = {
    [TOOL.FREEHAND]: GEOMETRY.TUBE,
    [TOOL.LINE]: GEOMETRY.TUBE,
    [TOOL.RECT]: GEOMETRY.BOX,
    [TOOL.SQUARE]: GEOMETRY.BOX,
    [TOOL.CIRCLE]: GEOMETRY.SPHERE,
    [TOOL.ELLIPSE]: GEOMETRY.SPHERE,
    [TOOL.TRIANGLE]: GEOMETRY.CONE,
    [TOOL.STAR]: GEOMETRY.STAR,
  };
  for (const [tool, geometry] of Object.entries(expected)) {
    assert.equal(
      descriptorForShape(tool, '#fff').geometry,
      geometry,
      `tool "${tool}" should produce a ${geometry}`,
    );
  }
});

test('rect and rectangle are treated as the same shape', () => {
  const a = descriptorForShape('rect', '#fff');
  const b = descriptorForShape(SHAPE.RECTANGLE, '#fff');
  assert.equal(a.geometry, b.geometry);
  assert.equal(a.geometry, GEOMETRY.BOX);
});

test('every recognised shape resolves to a real geometry, never the fallback', () => {
  for (const shape of Object.values(SHAPE)) {
    const d = descriptorForShape(shape, '#fff');
    assert.ok(d.geometry, `shape "${shape}" produced no geometry`);
    assert.ok(typeof d.size === 'number' && d.size > 0);
    // 'unknown' is the only one allowed to land on the default sphere.
    if (shape !== SHAPE.UNKNOWN) {
      assert.notEqual(d.geometry, undefined);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Bug 2: the 3D fingertip cursor rendered black.
 * Effects.setCursor called Color.setHex() with a CSS string, and setHex
 * bit-shifts its argument - on a string that is NaN.
 * ------------------------------------------------------------------ */

test('the 3D cursor accepts a CSS colour string without producing NaN', () => {
  const config = createConfig();
  const sceneView = { config, add() {}, remove() {} };
  const effects = new Effects(sceneView, config);

  effects.setCursor({ x: 0, y: 0, z: 0 }, { visible: true, color: '#22d3ee', pinch: 0.5 });

  // Assert the exact colour, not merely "finite": setHex() on a string
  // silently produces black (Math.floor('#22d3ee') is NaN, and NaN >> 16 is
  // 0), which is finite and would slip past a looser check.
  assert.equal(effects.cursorCore.material.color.getHex(), 0x22d3ee, 'core colour');
  assert.equal(effects.cursorGlow.material.color.getHex(), 0x22d3ee, 'glow colour');
});

test('every palette colour survives a trip through the cursor', () => {
  const config = createConfig();
  const effects = new Effects({ config, add() {}, remove() {} }, config);
  for (const hex of config.drawing.palette) {
    effects.setCursor({ x: 0, y: 0, z: 0 }, { color: hex });
    assert.equal(
      effects.cursorCore.material.color.getHex(),
      parseInt(hex.slice(1), 16),
      `palette colour ${hex} did not survive the trip`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * Bug 3: the hand skeleton and fingertip dot were drawn with the
 * un-padded mapping while the ink used the padded one, so the glowing
 * cursor sat somewhere other than where strokes appeared.
 * ------------------------------------------------------------------ */

test('the hand skeleton is drawn with the same mapping as the ink', () => {
  const config = createConfig();
  const renderer = new StrokeRenderer(document.createElement('canvas'), config);
  renderer.resize(1280, 720);

  const mapper = new CoordinateMapper(config);
  mapper.setViewport(1280, 720);
  const rect = { x: 0, y: 0, width: 1280, height: 720 };

  const hand = makeHand({
    bend: { index: BEND.straight, middle: BEND.curled, ring: BEND.curled, pinky: BEND.curled },
  });

  renderer.drawHand(hand.landmarks, mapper, rect, { color: '#22d3ee' });

  // The last arc drawn is the fingertip glow, centred on the index tip.
  const lastArc = renderer.ctx.last('arc');
  assert.ok(lastArc, 'drawHand should have drawn the fingertip cursor');
  const expected = mapper.toCanvasInRect(hand.landmarks[8], rect);
  const old = mapper.toCanvas(hand.landmarks[8]);

  assert.ok(Math.abs(lastArc.args[0] - expected.x) < 1e-6, 'x should use the padded mapping');
  assert.ok(Math.abs(lastArc.args[1] - expected.y) < 1e-6, 'y should use the padded mapping');
  assert.ok(
    Math.abs(expected.x - old.x) > 1,
    'the two mappings must actually differ, or this test proves nothing',
  );
});

/* ------------------------------------------------------------------ *
 * Bug 4: pausing did not freeze the world - thrown objects kept flying.
 * ------------------------------------------------------------------ */

test('a frozen world does not integrate physics but still drains events', () => {
  const om = new ObjectManager(createConfig());
  const obj = om.add({ kind: 'sphere', position: { x: 0, y: 1, z: 0 } });
  obj.state = OBJ_STATE.FLYING;
  obj.velocity = { x: 4, y: 2, z: 0 };
  const before = { ...obj.position };

  for (let i = 0; i < 60; i++) om.update(1 / 60, { frozen: true });

  assert.deepEqual(obj.position, before, 'a frozen object must not move');
  assert.equal(obj.state, OBJ_STATE.FLYING, 'it should still be in flight, not settled');
  assert.equal(om.events.length, 0, 'queued events should still be drained');
});

test('unfreezing resumes the flight', () => {
  const om = new ObjectManager(createConfig());
  const obj = om.add({ kind: 'sphere', position: { x: 0, y: 1, z: 0 } });
  obj.state = OBJ_STATE.FLYING;
  obj.velocity = { x: 4, y: 2, z: 0 };
  for (let i = 0; i < 30; i++) om.update(1 / 60, { frozen: true });
  const frozen = { ...obj.position };
  om.update(1 / 60, { frozen: false });
  assert.notDeepEqual(obj.position, frozen, 'it should move again once unfrozen');
});

/* ------------------------------------------------------------------ *
 * Bug 5: erasing an object used a prune() trick with a filtered id set,
 * which was easy to get wrong. There is now a direct removeView().
 * ------------------------------------------------------------------ */

test('removeView disposes exactly one object and leaves the others alone', () => {
  const config = createConfig();
  const sceneView = { config, add() {}, remove() {}, added: [], removed: [] };
  const ovm = new ObjectViewManager(sceneView);
  const om = new ObjectManager(config);

  const a = om.add({ kind: 'sphere', position: { x: 0, y: 0, z: 0 } });
  const b = om.add({ kind: 'box', position: { x: 1, y: 0, z: 0 } });
  const va = ovm.ensure(a);
  const vb = ovm.ensure(b);
  assert.equal(ovm.views.size, 2);

  assert.equal(ovm.removeView(a.id), true);
  assert.equal(ovm.views.size, 1);
  assert.equal(va.material.disposed, true, 'the removed material should be disposed');
  assert.equal(va.mesh.geometry.disposed, true, 'the removed geometry should be disposed');
  assert.equal(vb.material.disposed, false, 'the surviving object must be untouched');
  assert.equal(ovm.views.has(b.id), true);

  assert.equal(ovm.removeView('nope'), false, 'removing an unknown id is a no-op');
});

test('prune drops only the views whose objects are gone', () => {
  const config = createConfig();
  const ovm = new ObjectViewManager({ config, add() {}, remove() {} });
  const om = new ObjectManager(config);
  const a = om.add({ kind: 'sphere', position: { x: 0, y: 0, z: 0 } });
  const b = om.add({ kind: 'box', position: { x: 1, y: 0, z: 0 } });
  ovm.ensure(a);
  const vb = ovm.ensure(b);

  om.remove(a.id);
  ovm.prune(new Set(om.all().map((o) => o.id)));

  assert.equal(ovm.views.size, 1);
  assert.equal(ovm.views.has(b.id), true);
  assert.equal(vb.material.disposed, false);
});

/* ------------------------------------------------------------------ *
 * Bug 6: pinch carried a 350 ms cooldown, so a quick grab-release-grab
 * silently swallowed the second pinch.
 * ------------------------------------------------------------------ */

test('a quick grab-release-grab is not swallowed by a cooldown', () => {
  const rec = new GestureRecognizer(createConfig());
  const pinched = makeHand({
    bend: { index: BEND.straight, middle: BEND.straight, ring: BEND.straight, pinky: BEND.straight },
    pinchRatio: 0.2,
  });
  const open = makeHand({
    bend: { index: BEND.straight, middle: BEND.straight, ring: BEND.straight, pinky: BEND.straight },
    pinchRatio: 1.15,
  });

  const starts = [];
  let t = 0;
  const feed = (hand, frames) => {
    for (let i = 0; i < frames; i++) {
      const r = rec.update(hand, t);
      for (const ev of r.events) if (ev.type === EVENT.PINCH_START) starts.push(t);
      t += 16;
    }
  };

  feed(pinched, 8);
  feed(open, 4); // a brief release
  feed(pinched, 12);

  assert.equal(starts.length, 2, `expected two pinches, got ${starts.length}`);
  const gap = starts[1] - starts[0];
  assert.ok(gap < 350, `the two pinches were ${gap}ms apart, which must be inside the old cooldown`);
});

test('palm and fist still respect their cooldowns', () => {
  const cfg = createConfig({ gestures: { fistCooldownMs: 1200 } });
  const rec = new GestureRecognizer(cfg);
  const fist = makeHand({
    bend: { index: BEND.curled, middle: BEND.curled, ring: BEND.curled, pinky: BEND.curled },
    pinchRatio: 1.15,
  });
  let fistEvents = 0;
  let t = 0;
  for (let i = 0; i < 120; i++) {
    const r = rec.update(fist, t);
    fistEvents += r.events.filter((e) => e.type === EVENT.FIST).length;
    t += 16;
  }
  assert.equal(fistEvents, 1, 'a held fist must fire exactly once');
});

/* ------------------------------------------------------------------ *
 * Bug 7: the shape dropdown defaulted to its first option, so every
 * manual "Create" silently forced a circle.
 * ------------------------------------------------------------------ */

test('the shape dropdown offers an explicit auto option', () => {
  const html = readIndexHtml();
  const select = /<select id="shape-select"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  assert.ok(select, 'shape-select should exist');
  assert.match(
    select[1],
    /<option value="">/,
    'the first option must be the empty "auto" value, or manual creation always forces a shape',
  );
  const firstOption = /<option value="([^"]*)"/.exec(select[1]);
  assert.equal(firstOption[1], '', 'the auto option must come first so it is the default');
});

function readIndexHtml() {
  return fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
}
