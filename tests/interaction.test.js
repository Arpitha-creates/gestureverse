import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { analyzeHand } from '../src/gestures/handPose.js';
import { Interaction } from '../src/gestures/interaction.js';
import { DrawingWorld, Drawing } from '../src/objects/world.js';
import { makeHand, slot } from './helpers/hands.js';

/* A linear stand-in for the camera projection: normalised screen -> world on a
 * 10x10 plane, and back again. Simple, exact, and enough to exercise picking. */
const VIEWPORT = { width: 1000, height: 1000 };
const toWorld = (p, z = 0) => ({ x: (p.x - 0.5) * 10, y: -(p.y - 0.5) * 10, z });
const project = (v) => ({ x: (v.x / 10) * 1000 + 500, y: (-v.y / 10) * 1000 + 500 });

class Harness {
  constructor() {
    this.world = new DrawingWorld(CONFIG);
    this.interaction = new Interaction(CONFIG, this.world);
    this.now = 0;
  }

  hand(index, kind, at) {
    return slot(index, kind, analyzeHand(makeHand(kind, at), CONFIG));
  }

  frame(hands, { dt = 1 / 60, mode = 'draw', eraser = false } = {}) {
    this.now += dt * 1000;
    return this.interaction.update({
      hands,
      now: this.now,
      dt,
      mode,
      brush: { color: '#38f0ff', width: 0.02 },
      eraser,
      toWorld,
      project,
      viewport: VIEWPORT,
    });
  }

  seedDrawing(points = [{ x: -0.3, y: 0 }, { x: 0, y: 0.3 }, { x: 0.3, y: 0 }]) {
    const d = Drawing.fromStroke({ points, color: '#38f0ff', width: 0.02 }, 0);
    this.world.add(d);
    return d;
  }
}

const lost = (i) => slot(i, 'lost', null);

/* ------------------------------------------------------------------ drawing */

test('pointing draws, and releasing the hand keeps the drawing', () => {
  const h = new Harness();
  let info;
  for (let i = 0; i <= 20; i++) {
    const x = 0.3 + i * 0.02;
    info = h.frame([h.hand(0, 'point', { x, y: 0.5 })]);
    assert.equal(info.appState, 'draw');
  }
  assert.equal(h.world.count, 0, 'nothing is committed mid-stroke');

  info = h.frame([lost(0)]);
  assert.equal(h.world.count, 1, 'the finished stroke became a drawing');
  assert.equal(info.stroke, null);
  assert.ok(h.world.drawings[0].radius > 0);
});

test('a stray twitch does not create a drawing', () => {
  const h = new Harness();
  h.frame([h.hand(0, 'point', { x: 0.5, y: 0.5 })]);
  h.frame([h.hand(0, 'point', { x: 0.501, y: 0.5 })]);
  h.frame([lost(0)]);
  assert.equal(h.world.count, 0);
});

test('play mode points without drawing', () => {
  const h = new Harness();
  for (let i = 0; i < 10; i++) h.frame([h.hand(0, 'point', { x: 0.3 + i * 0.02, y: 0.5 })], { mode: 'play' });
  h.frame([lost(0)], { mode: 'play' });
  assert.equal(h.world.count, 0);
});

/* -------------------------------------------------------------------- grab */

test('pinching a drawing grabs it without moving it', () => {
  const h = new Harness();
  const d = h.seedDrawing();
  const before = { ...d.position };

  const info = h.frame([h.hand(0, 'pinch', { x: 0.53, y: 0.5 })]);
  assert.equal(info.appState, 'grab');
  assert.equal(info.carried, d);
  assert.equal(d.selected, true);
  assert.deepEqual(d.position, before, 'the object must not snap to the fingertip');

  h.frame([h.hand(0, 'pinch', { x: 0.53, y: 0.5 })]);
  assert.ok(Math.abs(d.position.x - before.x) < 0.02, 'and it stays put while the hand holds still');
});

test('moving the pinch carries the drawing, and releasing leaves it floating', () => {
  const h = new Harness();
  const d = h.seedDrawing();
  h.frame([h.hand(0, 'pinch', { x: 0.53, y: 0.5 })]);

  for (let i = 1; i <= 30; i++) {
    h.frame([h.hand(0, 'pinch', { x: 0.53 + i * 0.005, y: 0.5 - i * 0.005 })]);
  }
  const moved = { ...d.position };
  assert.ok(moved.x > 0.5, `expected the drawing to travel right, got ${moved.x}`);
  assert.ok(moved.y > 0.5, `expected the drawing to travel up, got ${moved.y}`);

  const info = h.frame([lost(0)]);
  assert.equal(info.carried, null);
  assert.equal(d.selected, false);
  assert.equal(h.world.count, 1, 'releasing never deletes');
  assert.deepEqual(d.position, moved, 'it stays exactly where it was let go');
});

test('pinching empty space grabs nothing and never throws', () => {
  const h = new Harness();
  const info = h.frame([h.hand(0, 'pinch', { x: 0.05, y: 0.05 })]);
  assert.equal(info.carried, null);
  assert.equal(info.appState, 'hover');
});

/* ---------------------------------------------------------------- two hands */

test('pinching with both hands engages a two-hand grab', () => {
  const h = new Harness();
  const d = h.seedDrawing();
  const info = h.frame([
    h.hand(0, 'pinch', { x: 0.42, y: 0.5 }),
    h.hand(1, 'pinch', { x: 0.58, y: 0.5 }),
  ]);
  assert.equal(info.appState, 'two-hand');
  assert.equal(info.carried, d);
  assert.ok(info.twoHand);
});

test('moving the hands apart resizes the drawing', () => {
  const h = new Harness();
  const d = h.seedDrawing();
  h.frame([h.hand(0, 'pinch', { x: 0.42, y: 0.5 }), h.hand(1, 'pinch', { x: 0.58, y: 0.5 })]);

  let info;
  for (let i = 1; i <= 25; i++) {
    info = h.frame([
      h.hand(0, 'pinch', { x: 0.42 - i * 0.004, y: 0.5 }),
      h.hand(1, 'pinch', { x: 0.58 + i * 0.004, y: 0.5 }),
    ]);
  }
  assert.equal(info.appState, 'resize');
  assert.ok(d.scale > 1.4, `expected the drawing to grow, got ${d.scale}`);
  assert.ok(d.scale <= CONFIG.twoHand.maxScale + 1e-6);
});

test('twisting the hands rotates the drawing', () => {
  const h = new Harness();
  const d = h.seedDrawing();
  h.frame([h.hand(0, 'pinch', { x: 0.42, y: 0.5 }), h.hand(1, 'pinch', { x: 0.58, y: 0.5 })]);

  let info;
  for (let i = 1; i <= 25; i++) {
    info = h.frame([
      h.hand(0, 'pinch', { x: 0.5 - i * 0.003, y: 0.5 - i * 0.003 }),
      h.hand(1, 'pinch', { x: 0.5 + i * 0.003, y: 0.5 + i * 0.003 }),
    ]);
  }
  assert.ok(['rotate', 'two-hand'].includes(info.appState), `unexpected state ${info.appState}`);
  assert.ok(Math.abs(d.rotation.z) > 0.3, `expected rotation, got ${d.rotation.z}`);
});

test('a two-hand grab releases itself when a hand is lost', () => {
  const h = new Harness();
  h.seedDrawing();
  h.frame([h.hand(0, 'pinch', { x: 0.42, y: 0.5 }), h.hand(1, 'pinch', { x: 0.58, y: 0.5 })]);
  assert.ok(h.interaction.carried);

  let info;
  for (let i = 0; i < 30; i++) info = h.frame([lost(0), lost(1)]);
  assert.equal(info.carried, null, 'the grab must not survive the hands');
  assert.equal(h.interaction.twoHand, null);
});

/* ------------------------------------------------------------------ delete */

test('holding a fist over a drawing deletes it, once', () => {
  const h = new Harness();
  h.seedDrawing();
  h.seedDrawing([{ x: -0.2, y: -0.2 }, { x: 0.2, y: -0.2 }]);
  assert.equal(h.world.count, 2);

  // 0.9s at 60fps is 54 frames; hold well past it.
  const states = new Set();
  for (let i = 0; i < 80; i++) states.add(h.frame([h.hand(0, 'fist', { x: 0.5, y: 0.5 })]).appState);
  assert.ok(states.has('delete'), 'the delete gesture is reported while it charges');
  assert.ok(h.world.count <= 1, 'the fist deleted the drawing under it');

  const after = h.world.count;
  for (let i = 0; i < 80; i++) h.frame([h.hand(0, 'fist', { x: 0.5, y: 0.5 })]);
  assert.equal(h.world.count, after, 'one fist never chains into more deletes');
});

test('a brief fist does not delete anything', () => {
  const h = new Harness();
  h.seedDrawing();
  for (let i = 0; i < 6; i++) h.frame([h.hand(0, 'fist', { x: 0.5, y: 0.5 })]);
  assert.equal(h.world.count, 1);
});

test('fisting while the other hand holds deletes the held drawing', () => {
  const h = new Harness();
  h.seedDrawing();
  h.frame([h.hand(0, 'pinch', { x: 0.53, y: 0.5 })]);
  let info;
  for (let i = 0; i < 80; i++) {
    info = h.frame([h.hand(0, 'pinch', { x: 0.53, y: 0.5 }), h.hand(1, 'fist', { x: 0.2, y: 0.2 })]);
  }
  assert.equal(h.world.count, 0, 'the held drawing was deleted');
  assert.equal(h.interaction.carried, null);
});

/* -------------------------------------------------------------- undo, erase */

test('holding an open palm undoes the last drawing', () => {
  const h = new Harness();
  for (let i = 0; i <= 20; i++) h.frame([h.hand(0, 'point', { x: 0.3 + i * 0.02, y: 0.5 })]);
  h.frame([lost(0)]);
  assert.equal(h.world.count, 1);

  const palm = slot(0, 'palm', analyzeHand(makeHand('palm'), CONFIG), 1600);
  h.frame([palm]);
  assert.equal(h.world.count, 0, 'palm hold undid the drawing');
});

test('the eraser removes a drawing on contact and then waits', () => {
  const h = new Harness();
  h.seedDrawing();
  h.frame([h.hand(0, 'point', { x: 0.5, y: 0.5 })], { eraser: true });
  assert.equal(h.world.count, 0);
  assert.equal(h.interaction.eraserCooldown > 0, true);
});

/* ---------------------------------------------------------------- fuzzing */

test('fuzz: 4000 random frames never hang, never produce NaN', () => {
  const h = new Harness();
  const kinds = ['point', 'pinch', 'fist', 'palm', 'idle', 'lost'];
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  let noPinchFrames = 0;

  for (let f = 0; f < 4000; f++) {
    const hands = [0, 1].map((i) => {
      const kind = kinds[Math.floor(rand() * kinds.length)];
      if (kind === 'lost') return lost(i);
      const at = { x: 0.15 + rand() * 0.7, y: 0.15 + rand() * 0.7 };
      if (kind === 'idle') return slot(i, 'idle', analyzeHand(makeHand('fist', at), CONFIG));
      return slot(i, kind, analyzeHand(makeHand(kind, at), CONFIG), kind === 'palm' ? rand() * 2000 : 0);
    });

    const info = h.frame(hands, {
      dt: 1 / 60,
      mode: rand() > 0.5 ? 'draw' : 'play',
      eraser: rand() > 0.9,
    });

    for (const d of h.world.drawings) {
      for (const key of ['x', 'y', 'z']) {
        assert.ok(Number.isFinite(d.position[key]), `frame ${f}: position.${key} went NaN`);
      }
      assert.ok(Number.isFinite(d.scale) && d.scale > 0, `frame ${f}: scale went bad (${d.scale})`);
      assert.ok(Number.isFinite(d.rotation.z), `frame ${f}: rotation went NaN`);
    }
    assert.ok(Number.isFinite(info.deleteProgress));
    assert.ok(Number.isFinite(info.palmProgress));

    const pinching = hands.some((hd) => hd.result && hd.result.state === 'pinch');
    noPinchFrames = pinching ? 0 : noPinchFrames + 1;
    if (noPinchFrames > 25) {
      assert.equal(info.carried, null, `frame ${f}: an object stayed grabbed with no pinch`);
    }
  }

  // Whatever happened, every object must still be somewhere sane.
  for (const d of h.world.drawings) {
    assert.ok(Math.abs(d.position.x) <= 9.01);
    assert.ok(Math.abs(d.position.y) <= 6.01);
    assert.ok(Math.abs(d.position.z) <= 3.51);
  }
});

test('forceRelease drops everything immediately', () => {
  const h = new Harness();
  const d = h.seedDrawing();
  h.frame([h.hand(0, 'pinch', { x: 0.53, y: 0.5 })]);
  assert.ok(h.interaction.carried);
  h.interaction.forceRelease();
  assert.equal(h.interaction.carried, null);
  assert.equal(d.selected, false);
  assert.equal(h.interaction.appState, 'idle');
});
