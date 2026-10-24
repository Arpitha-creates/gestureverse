import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createConfig } from '../src/core/config.js';
import { TwoHandController, TWO_HAND_EVENT } from '../src/gestures/twoHandController.js';

const A = { x: 0.3, y: 0.5 };
const B = { x: 0.7, y: 0.5 };

test('stays inactive with fewer than two hands', () => {
  const c = new TwoHandController(createConfig());
  let r = c.update(A, null, 1 / 60);
  assert.equal(r.active, false);
  r = c.update(null, B, 1 / 60);
  assert.equal(r.active, false);
});

test('activates only after the confirmation frames', () => {
  const cfg = createConfig({ twoHand: { confirmFrames: 4 } });
  const c = new TwoHandController(cfg);
  let started = 0;
  for (let i = 0; i < 3; i++) {
    started += c.update(A, B, 1 / 60).events.filter((e) => e.type === TWO_HAND_EVENT.START).length;
  }
  assert.equal(c.active, false);
  assert.equal(started, 0);

  for (let i = 0; i < 4; i++) {
    started += c.update(A, B, 1 / 60).events.filter((e) => e.type === TWO_HAND_EVENT.START).length;
  }
  assert.equal(c.active, true);
  assert.equal(started, 1);
});

test('separating the hands scales up, bringing them together scales down', () => {
  const cfg = createConfig({ twoHand: { confirmFrames: 1, smoothing: 0.6 } });
  const c = new TwoHandController(cfg);
  c.update(A, B, 1 / 60);
  for (let i = 0; i < 20; i++) c.update({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 1 / 60);
  assert.ok(c.scale > 1.2, `expected scale > 1.2, got ${c.scale}`);
  for (let i = 0; i < 30; i++) c.update({ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }, 1 / 60);
  assert.ok(c.scale < 1.0, `expected scale < 1.0, got ${c.scale}`);
});

test('rotating the two hands accumulates rotation', () => {
  const cfg = createConfig({ twoHand: { confirmFrames: 1, smoothing: 0.8 } });
  const c = new TwoHandController(cfg);
  c.update(A, B, 1 / 60);
  // Rotate the pair counter-clockwise in small steps.
  let ang = 0;
  for (let i = 0; i < 40; i++) {
    ang += 0.05;
    const cxp = 0.5;
    const cyp = 0.5;
    const r = 0.2;
    const a = { x: cxp - r * Math.cos(ang), y: cyp - r * Math.sin(ang) };
    const b = { x: cxp + r * Math.cos(ang), y: cyp + r * Math.sin(ang) };
    c.update(a, b, 1 / 60);
  }
  assert.ok(Math.abs(c.rotation) > 20, `expected meaningful rotation, got ${c.rotation}`);
});

test('deactivates and emits end when a hand leaves', () => {
  const cfg = createConfig({ twoHand: { confirmFrames: 1 } });
  const c = new TwoHandController(cfg);
  for (let i = 0; i < 3; i++) c.update(A, B, 1 / 60);
  assert.equal(c.active, true);
  const r = c.update(A, null, 1 / 60);
  assert.equal(r.active, false);
  assert.equal(r.events.filter((e) => e.type === TWO_HAND_EVENT.END).length, 1);
});

test('a pair closer than minSeparation is ignored', () => {
  const cfg = createConfig({ twoHand: { confirmFrames: 1, minSeparation: 0.2 } });
  const c = new TwoHandController(cfg);
  let r = null;
  for (let i = 0; i < 5; i++) r = c.update({ x: 0.5, y: 0.5 }, { x: 0.55, y: 0.5 }, 1 / 60);
  assert.equal(r.active, false);
});
