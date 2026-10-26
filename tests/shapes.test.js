/**
 * Exact 3D shapes.
 *
 * Shapes mode exists so the user can place a guaranteed-correct primitive
 * instead of freehand. These tests pin the behaviour that makes it usable:
 * a pinch on empty space places, a pinch on an object still grabs, and a
 * placed shape behaves like any other object afterwards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { analyzeHand } from '../src/gestures/handPose.js';
import { Interaction } from '../src/gestures/interaction.js';
import { DrawingWorld, Drawing } from '../src/objects/world.js';
import { SHAPES, isShapeId, shapeLabel } from '../src/objects/shapes.js';
import { makeHand, slot } from './helpers/hands.js';

const VIEWPORT = { width: 1000, height: 1000 };
const toWorld = (p, z = 0) => ({ x: (p.x - 0.5) * 16, y: -(p.y - 0.5) * 9, z });
const project = (v) => ({ x: (v.x / 16) * 1000 + 500, y: (-v.y / 9) * 1000 + 500 });

class Harness {
  constructor() {
    this.world = new DrawingWorld(CONFIG);
    this.interaction = new Interaction(CONFIG, this.world);
    this.now = 0;
  }

  hand(index, kind, at) {
    return slot(index, kind, analyzeHand(makeHand(kind, at), CONFIG));
  }

  frame(hands, { dt = 1 / 60, mode = 'shape', stamp = 'cube' } = {}) {
    this.now += dt * 1000;
    return this.interaction.update({
      hands,
      now: this.now,
      dt,
      mode,
      brush: { color: '#38f0ff', width: 0.019 },
      eraser: false,
      stamp,
      toWorld,
      project,
      viewport: VIEWPORT,
    });
  }
}

const lost = (i) => slot(i, 'lost', null);

test('the catalogue exposes eight distinct primitives', () => {
  assert.equal(SHAPES.length, 8);
  assert.equal(new Set(SHAPES.map((s) => s.id)).size, 8);
  assert.ok(isShapeId('sphere'));
  assert.equal(isShapeId('banana'), false);
  assert.equal(shapeLabel('torus'), 'Torus');
});

test('pinching empty space in Shapes mode places the chosen primitive', () => {
  const h = new Harness();
  const info = h.frame([h.hand(0, 'pinch', { x: 0.62, y: 0.44 })], { stamp: 'sphere' });

  assert.equal(info.appState, 'place');
  assert.equal(h.world.count, 1);
  const obj = h.world.drawings[0];
  assert.equal(obj.kind, 'shape');
  assert.equal(obj.primitive, 'sphere');
  assert.equal(obj.radius, CONFIG.shapes.size);
  assert.equal(obj.color, '#38f0ff');
  // placed where the pinch was
  const expected = toWorld({ x: 0.62, y: 0.44 }, 0);
  assert.ok(Math.abs(obj.position.x - expected.x) < 0.05);
  assert.ok(Math.abs(obj.position.y - expected.y) < 0.05);
});

test('the shape can be adjusted immediately, because the next frame grabs it', () => {
  const h = new Harness();
  h.frame([h.hand(0, 'pinch', { x: 0.5, y: 0.5 })], { stamp: 'cube' });
  const info = h.frame([h.hand(0, 'pinch', { x: 0.5, y: 0.5 })], { stamp: 'cube' });
  assert.equal(info.appState, 'grab');
  assert.equal(h.world.count, 1, 'grabbing must not place a second copy');
});

test('pinching an existing object grabs it instead of stamping', () => {
  const h = new Harness();
  const existing = Drawing.fromShape({
    primitive: 'cube',
    size: CONFIG.shapes.size,
    position: { x: 0, y: 0, z: 0 },
    color: '#ff3df0',
    createdAt: 0,
  });
  h.world.add(existing);

  const info = h.frame([h.hand(0, 'pinch', { x: 0.5, y: 0.5 })], { stamp: 'sphere' });
  assert.equal(info.appState, 'grab');
  assert.equal(h.world.count, 1, 'no extra shape was stamped on top');
  assert.equal(info.carried, existing);
});

test('Shapes mode never draws a stroke', () => {
  const h = new Harness();
  for (let i = 0; i < 30; i++) {
    h.frame([h.hand(0, 'point', { x: 0.3 + i * 0.01, y: 0.5 })]);
  }
  h.frame([lost(0)]);
  assert.equal(h.world.count, 0, 'pointing in Shapes mode must not create ink');
});

test('a placed shape can be carried and left somewhere else', () => {
  const h = new Harness();
  h.frame([h.hand(0, 'pinch', { x: 0.5, y: 0.5 })], { stamp: 'cone' });
  const obj = h.world.drawings[0];
  const startX = obj.position.x;

  for (let i = 1; i <= 30; i++) {
    h.frame([h.hand(0, 'pinch', { x: 0.5 + i * 0.006, y: 0.5 })], { stamp: 'cone' });
  }
  assert.ok(obj.position.x > startX + 1, `expected the shape to move, x=${obj.position.x}`);

  const info = h.frame([lost(0)], { stamp: 'cone' });
  assert.equal(info.carried, null);
  assert.equal(h.world.count, 1);
});

test('two hands resize a placed shape', () => {
  const h = new Harness();
  h.frame([h.hand(0, 'pinch', { x: 0.5, y: 0.5 })], { stamp: 'cube' });
  const obj = h.world.drawings[0];
  h.frame([lost(0)]);

  h.frame(
    [h.hand(0, 'pinch', { x: 0.45, y: 0.5 }), h.hand(1, 'pinch', { x: 0.55, y: 0.5 })],
    { stamp: 'cube' },
  );
  let info;
  for (let i = 1; i <= 25; i++) {
    info = h.frame(
      [
        h.hand(0, 'pinch', { x: 0.45 - i * 0.004, y: 0.5 }),
        h.hand(1, 'pinch', { x: 0.55 + i * 0.004, y: 0.5 }),
      ],
      { stamp: 'cube' },
    );
  }
  assert.ok(obj.scale > 1.4, `expected the shape to grow, scale=${obj.scale}`);
});

test('placing is undoable', () => {
  const h = new Harness();
  h.frame([h.hand(0, 'pinch', { x: 0.5, y: 0.5 })], { stamp: 'torus' });
  assert.equal(h.world.count, 1);
  assert.equal(h.world.undo(), true);
  assert.equal(h.world.count, 0);
});

test('shapes survive a serialise/restore round trip', () => {
  const world = new DrawingWorld(CONFIG);
  world.add(
    Drawing.fromShape({
      primitive: 'pyramid',
      size: 0.85,
      position: { x: 1.2, y: -0.4, z: 0.5 },
      color: '#a6ff3d',
      createdAt: 10,
    }),
  );
  const snapshot = world.serialize();
  const restored = new DrawingWorld(CONFIG);
  restored.restore(snapshot);
  const obj = restored.drawings[0];
  assert.equal(obj.kind, 'shape');
  assert.equal(obj.primitive, 'pyramid');
  assert.equal(obj.color, '#a6ff3d');
  assert.deepEqual(obj.position, { x: 1.2, y: -0.4, z: 0.5 });
});

test('strokes and shapes coexist and are picked independently', () => {
  const h = new Harness();
  const stroke = Drawing.fromStroke(
    { points: [{ x: -4, y: 2 }, { x: -3, y: 2.2 }], color: '#fff', width: 0.02 },
    0,
  );
  h.world.add(stroke);
  h.frame([h.hand(0, 'pinch', { x: 0.5, y: 0.5 })], { stamp: 'cube' });
  assert.equal(h.world.count, 2);

  // pinch over the stroke's own position and confirm it is the one picked up
  const strokePx = project(stroke.position);
  const at = { x: strokePx.x / VIEWPORT.width, y: strokePx.y / VIEWPORT.height };
  const info = h.frame([lost(0)]);
  assert.equal(info.carried, null);
  const pick = h.frame([h.hand(0, 'pinch', at)], { stamp: 'cube' });
  assert.equal(pick.carried, stroke, 'the stroke under the cursor wins the pick');
});
