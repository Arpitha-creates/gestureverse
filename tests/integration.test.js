/**
 * GestureVerse - end-to-end interaction test.
 *
 * Walks the signature experience through the real modules, frame by frame,
 * exactly as main.js does - just with synthetic hands instead of a webcam:
 *
 *   draw a circle in the air
 *     -> recognise it
 *     -> create a 3D object
 *     -> grab it with a pinch
 *     -> lift and carry it
 *     -> release and place it
 *     -> pick it up again and throw it
 *     -> let physics settle it on the floor
 *
 * The gesture smoothing is turned right up so the test exercises the
 * interaction wiring rather than the filter's response time.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createConfig } from '../src/core/config.js';
import { CoordinateMapper } from '../src/core/coordinateMapper.js';
import { bbox } from '../src/core/math.js';
import { GestureRecognizer, STATE, EVENT } from '../src/gestures/gestureRecognizer.js';
import { StrokeManager, TOOL } from '../src/drawing/strokeManager.js';
import { recognizeShape, SHAPE } from '../src/drawing/shapeRecognizer.js';
import { ObjectManager, OBJ_STATE } from '../src/objects/objectManager.js';
import { descriptorForShape } from '../src/objects/objectFactory.js';
import { makeHand, BEND } from './helpers/syntheticHand.js';

const DT = 1 / 60;
const RECT = { x: 0, y: 0, width: 1280, height: 720 };

const POINT_BEND = { index: BEND.straight, middle: BEND.curled, ring: BEND.curled, pinky: BEND.curled };
const OPEN_BEND = { index: BEND.straight, middle: BEND.straight, ring: BEND.straight, pinky: BEND.straight };

/** Build a hand of the given pose whose index tip sits exactly at `tip`. */
function handAt(tip, bend, pinchRatio = 1.15) {
  const h = makeHand({ bend, pinchRatio });
  const t = h.landmarks[8];
  const dx = tip.x - t.x;
  const dy = tip.y - t.y;
  for (const p of h.landmarks) {
    p.x += dx;
    p.y += dy;
  }
  return h;
}

/** Pointing hand with the index tip at a normalized point. */
function handWithTip(tip, { pinchRatio = 1.15 } = {}) {
  return handAt(tip, POINT_BEND, pinchRatio);
}

/**
 * Raw normalized cursor position that maps onto a given world point.
 * worldToNormalized is already the exact inverse of toWorld (it applies the
 * mirror itself), so no further flip is needed here.
 */
function normalizedForWorld(worldPt, h) {
  return h.mapper.worldToNormalized(worldPt);
}

/** Mirror of main.js: canvas point -> raw normalized coordinates. */
function canvasToNormalized(px, py, config, rect) {
  const m = config.world.margin;
  const nx = px / rect.width;
  const ny = py / rect.height;
  let rx = m + nx * (1 - 2 * m);
  const ry = m + ny * (1 - 2 * m);
  if (config.mirror) rx = 1 - rx;
  return { x: rx, y: ry };
}

/** A harness that mirrors main.js's event handling, minus the DOM. */
class Harness {
  constructor() {
    this.config = createConfig({
      // near-raw smoothing so the cursor tracks the synthetic hand exactly
      tracking: { smoothing: { minCutoff: 30, beta: 1.0, dCutoff: 1.0 } },
      mirror: true,
    });
    this.mapper = new CoordinateMapper(this.config);
    this.mapper.setViewport(RECT.width, RECT.height);
    this.strokes = new StrokeManager(this.config);
    this.objects = new ObjectManager(this.config);
    this.rec = new GestureRecognizer(this.config);
    this.drawing = false;
    this.t = 0;
    this.log = [];
  }

  /** Feed one hand frame and apply the same event handling main.js uses. */
  step(hand) {
    const res = this.rec.update(hand, this.t);
    this.t += DT * 1000;
    const cursorCanvas = this.mapper.toCanvasInRect(res.cursor, RECT);
    const world = this.mapper.toWorld(res.cursor, res.metrics ? res.metrics.scale : 0.16);

    for (const ev of res.events) {
      this.log.push(ev.type);
      if (ev.type === EVENT.POINT_START) {
        this.strokes.begin(cursorCanvas.x, cursorCanvas.y, {
          tool: TOOL.FREEHAND,
          color: '#22d3ee',
          width: 6,
        });
        this.drawing = true;
      } else if (ev.type === EVENT.POINT_END) {
        if (this.drawing) {
          this.drawing = false;
          this.strokes.end();
        }
      } else if (ev.type === EVENT.PINCH_START) {
        if (this.drawing) {
          this.drawing = false;
          this.strokes.end();
        }
        this.objects.grab(world);
      } else if (ev.type === EVENT.PINCH_END) {
        if (ev.reason === 'lost') this.objects.drop();
        else this.objects.release();
      } else if (ev.type === EVENT.HAND_LOST) {
        if (this.drawing) {
          this.drawing = false;
          this.strokes.end();
        }
        this.objects.drop();
      }
    }

    if (this.drawing) this.strokes.addPoint(cursorCanvas.x, cursorCanvas.y);
    if (this.objects.held) this.objects.drag(world, DT);
    else if (hand) this.objects.updateHover(world);
    else this.objects.clearHover();
    this.objects.update(DT);

    return { res, cursorCanvas, world };
  }
}

test('end-to-end: draw a circle in the air, then grab, carry, place and throw it', () => {
  const h = new Harness();

  // ---- 1. draw a circle with the fingertip ---------------------------
  // The circle is specified in CANVAS pixels and inverted to image space, so
  // the ink the user actually sees is a true circle. (Mapping a circle in
  // normalized space onto a 16:9 canvas would yield an ellipse.)
  const canvasR = 170;
  const frames = 150;
  const startNorm = canvasToNormalized(RECT.width / 2 + canvasR, RECT.height / 2, h.config, RECT);
  for (let i = 0; i <= frames; i++) {
    const a = (i / frames) * Math.PI * 2;
    const px = RECT.width / 2 + Math.cos(a) * canvasR;
    const py = RECT.height / 2 + Math.sin(a) * canvasR;
    h.step(handAt(canvasToNormalized(px, py, h.config, RECT), POINT_BEND));
  }
  // Open the hand (staying at the closing point) to end the stroke cleanly.
  for (let i = 0; i < 10; i++) h.step(handAt(startNorm, OPEN_BEND));

  assert.equal(h.drawing, false, 'the stroke should have ended');
  assert.equal(h.strokes.strokes.length, 1, 'exactly one stroke should be committed');
  assert.ok(h.strokes.strokes[0].points.length > 40, 'the stroke should have many points');
  assert.ok(h.log.includes(EVENT.POINT_START), 'drawing should have started');

  // ---- 2. recognise it ------------------------------------------------
  const stroke = h.strokes.strokes[0];
  const rec = recognizeShape(stroke.points, h.config);
  assert.equal(rec.closed, true);
  assert.equal(rec.shape, SHAPE.CIRCLE, `expected a circle, got ${rec.shape}`);

  // ---- 3. turn it into an object (mirrors main.convertStroke) ---------
  const box = bbox(stroke.points);
  const norm = canvasToNormalized(box.cx, box.cy, h.config, RECT);
  const world = h.mapper.toWorld(norm, h.config.world.sizeReference);
  const desc = descriptorForShape(rec.shape, stroke.color);
  const obj = h.objects.add({
    kind: desc.geometry,
    geometry: desc.geometry,
    color: stroke.color,
    position: world,
    size: desc.size,
    points: stroke.points,
  });
  h.strokes.remove(stroke.id);
  assert.equal(h.objects.all().length, 1);
  assert.equal(h.strokes.strokes.length, 0, 'the 2D stroke is consumed by the object');
  assert.equal(obj.geometry, 'sphere');

  // ---- 4. grab it with a pinch ----------------------------------------
  const grabTip = { x: 0.5, y: 0.5 };
  for (let i = 0; i < 4; i++) h.step(handWithTip(grabTip, { pinchRatio: 1.15 }));
  let grabbed = false;
  for (let i = 0; i < 12 && !grabbed; i++) {
    h.step(handWithTip(grabTip, { pinchRatio: 0.2 }));
    grabbed = !!h.objects.held;
  }
  assert.ok(grabbed, 'the pinch should have grabbed the object');
  assert.equal(h.objects.held.id, obj.id);
  const posAtGrab = { ...obj.position };

  // ---- 5. lift and carry it -------------------------------------------
  const target = { x: 0.32, y: 0.34 };
  for (let i = 0; i < 90; i++) {
    const k = Math.min(1, (i + 1) / 60);
    const tip = {
      x: grabTip.x + (target.x - grabTip.x) * k,
      y: grabTip.y + (target.y - grabTip.y) * k,
    };
    h.step(handWithTip(tip, { pinchRatio: 0.2 }));
  }
  const carried = { ...obj.position };
  assert.ok(
    Math.hypot(carried.x - posAtGrab.x, carried.y - posAtGrab.y) > 0.5,
    'the object should have moved a meaningful distance',
  );
  assert.equal(obj.state, OBJ_STATE.HELD);

  // ---- 6. release and place -------------------------------------------
  for (let i = 0; i < 20; i++) h.step(handWithTip(target, { pinchRatio: 1.15 }));
  assert.equal(h.objects.held, null, 'the pinch release should have let go');
  assert.notEqual(obj.state, OBJ_STATE.HELD);
  assert.notEqual(obj.state, OBJ_STATE.FLYING, 'a slow release should place, not throw');
  const placed = { ...obj.position };

  // Hand wanders far away; the object must stay exactly where it was placed.
  for (let i = 0; i < 40; i++) {
    h.step(handWithTip({ x: 0.85, y: 0.8 }));
  }
  assert.deepEqual(obj.position, placed, 'a placed object must not drift');

  // ---- 7. pick it up again and throw it --------------------------------
  // Put the cursor back on the placed object (invert the world mapping).
  const backTip = normalizedForWorld(placed, h);
  for (let i = 0; i < 60; i++) h.step(handWithTip(backTip));
  let regrabbed = false;
  for (let i = 0; i < 16 && !regrabbed; i++) {
    h.step(handWithTip(backTip, { pinchRatio: 0.2 }));
    regrabbed = !!h.objects.held;
  }
  assert.ok(regrabbed, 'the object should be grabbable a second time');

  // Flick the hand sideways, then release.
  let tip = { ...backTip };
  for (let i = 0; i < 12; i++) {
    tip = { x: tip.x + 0.02, y: tip.y };
    h.step(handWithTip(tip, { pinchRatio: 0.2 }));
  }
  for (let i = 0; i < 6; i++) h.step(handWithTip(tip, { pinchRatio: 1.15 }));

  assert.equal(obj.state, OBJ_STATE.FLYING, 'a fast flick should have thrown the object');
  const speed = Math.hypot(obj.velocity.x, obj.velocity.y, obj.velocity.z);
  assert.ok(speed > 0, 'the thrown object should carry velocity');

  // ---- 8. physics settles it on the floor ------------------------------
  let bounced = false;
  for (let i = 0; i < 900; i++) {
    const evs = h.objects.update(DT);
    if (evs.some((e) => e.type === 'bounce')) bounced = true;
    if (obj.state === OBJ_STATE.IDLE) break;
  }
  assert.equal(obj.state, OBJ_STATE.IDLE, 'the object should come to rest');
  assert.ok(bounced, 'a thrown object should bounce');
  assert.ok(
    Math.abs(obj.position.y - (h.config.world.floorY + obj.size * 0.5)) < 0.1,
    'it should rest on the floor',
  );
});

test('end-to-end: losing tracking mid-grab leaves the object exactly where it was', () => {
  const h = new Harness();
  const obj = h.objects.add({ kind: 'box', geometry: 'box', position: { x: 0, y: 0, z: 0 } });

  const tip = { x: 0.5, y: 0.5 };
  for (let i = 0; i < 4; i++) h.step(handWithTip(tip));
  for (let i = 0; i < 12 && !h.objects.held; i++) h.step(handWithTip(tip, { pinchRatio: 0.2 }));
  assert.ok(h.objects.held);

  // Carry it, then the hand vanishes.
  let t2 = tip;
  for (let i = 0; i < 40; i++) {
    t2 = { x: t2.x - 0.004, y: t2.y + 0.004 };
    h.step(handWithTip(t2, { pinchRatio: 0.2 }));
  }
  h.step(null); // hand leaves the frame
  const resting = { ...obj.position };
  assert.equal(h.objects.held, null);
  assert.equal(obj.state, OBJ_STATE.IDLE);

  for (let i = 0; i < 120; i++) h.objects.update(DT);
  assert.deepEqual(obj.position, resting, 'the object must not fly off when tracking is lost');
});

test('end-to-end: an open palm pauses instead of grabbing or drawing', () => {
  const h = new Harness();
  let palmEvents = 0;
  for (let i = 0; i < 12; i++) {
    const r = h.step(makeHand({ pinchRatio: 1.15 })); // all fingers straight
    palmEvents += r.res.events.filter((e) => e.type === EVENT.PALM).length;
  }
  assert.equal(palmEvents, 1, 'open palm should fire exactly once');
  assert.equal(h.strokes.strokes.length, 0, 'an open palm must not draw anything');
  assert.equal(h.objects.all().length, 0);
});
