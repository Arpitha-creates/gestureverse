import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createConfig } from '../src/core/config.js';
import { GestureRecognizer, STATE, EVENT } from '../src/gestures/gestureRecognizer.js';
import { makeHand, BEND } from './helpers/syntheticHand.js';

const POINT_HAND = () => makeHand({ bend: { index: BEND.straight, middle: BEND.curled, ring: BEND.curled, pinky: BEND.curled }, pinchRatio: 1.15 });
const OPEN_HAND = () => makeHand({ bend: { index: BEND.straight, middle: BEND.straight, ring: BEND.straight, pinky: BEND.straight }, pinchRatio: 1.15 });
const FIST_HAND = () => makeHand({ bend: { index: BEND.curled, middle: BEND.curled, ring: BEND.curled, pinky: BEND.curled }, pinchRatio: 1.15 });
const NEUTRAL_HAND = () => makeHand({ bend: { index: BEND.neutral, middle: BEND.neutral, ring: BEND.neutral, pinky: BEND.neutral }, pinchRatio: 1.15 });
const PINCH_HAND = (origin) => makeHand({ bend: { index: BEND.straight, middle: BEND.straight, ring: BEND.straight, pinky: BEND.straight }, pinchRatio: 0.2, origin });

function feed(rec, hand, frames, startT = 0, step = 16) {
  const events = [];
  let t = startT;
  let res = null;
  for (let i = 0; i < frames; i++) {
    res = rec.update(hand, t);
    events.push(...res.events);
    t += step;
  }
  return { res, events, t };
}

function newRec(overrides) {
  return new GestureRecognizer(createConfig(overrides));
}

test('index finger extended, others curled -> point state with a single point_start', () => {
  const rec = newRec();
  const { res, events } = feed(rec, POINT_HAND(), 6);
  assert.equal(res.state, STATE.POINT);
  assert.equal(events.filter((e) => e.type === EVENT.POINT_START).length, 1);
  assert.ok(res.metrics.extensions.index > 0.6);
  assert.ok(res.metrics.extensions.middle < 0.4);
});

test('holding the point does not re-fire point_start', () => {
  const rec = newRec();
  const { t } = feed(rec, POINT_HAND(), 6);
  const { events } = feed(rec, POINT_HAND(), 20, t);
  assert.equal(events.filter((e) => e.type === EVENT.POINT_START).length, 0);
  assert.equal(rec.state, STATE.POINT);
});

test('open palm -> palm state (deliberate, needs confirmation frames)', () => {
  const rec = newRec();
  const { res, events } = feed(rec, OPEN_HAND(), 10);
  assert.equal(res.state, STATE.PALM);
  assert.equal(events.filter((e) => e.type === EVENT.PALM).length, 1);
});

test('closed fist fires exactly once and never repeats while held', () => {
  const rec = newRec();
  const { res, events } = feed(rec, FIST_HAND(), 40);
  assert.equal(res.state, STATE.FIST);
  assert.equal(events.filter((e) => e.type === EVENT.FIST).length, 1);
});

test('a fist does not accidentally emit draw or grab events', () => {
  const rec = newRec();
  const { events } = feed(rec, FIST_HAND(), 40);
  assert.equal(events.filter((e) => e.type === EVENT.POINT_START).length, 0);
  assert.equal(events.filter((e) => e.type === EVENT.PINCH_START).length, 0);
  assert.equal(events.filter((e) => e.type === EVENT.PALM).length, 0);
});

test('ambiguous half-open hand resolves to the neutral state', () => {
  const rec = newRec();
  const { res } = feed(rec, NEUTRAL_HAND(), 12);
  assert.equal(res.state, STATE.NONE);
});

test('pinch activates then releases, emitting start and end', () => {
  const rec = newRec();
  const { t } = feed(rec, OPEN_HAND(), 4);
  const pinched = feed(rec, PINCH_HAND(), 20, t);
  assert.equal(rec.state, STATE.PINCH);
  assert.equal(pinched.events.filter((e) => e.type === EVENT.PINCH_START).length, 1);

  const released = feed(rec, OPEN_HAND(), 20, pinched.t);
  assert.notEqual(rec.state, STATE.PINCH);
  assert.equal(released.events.filter((e) => e.type === EVENT.PINCH_END).length, 1);
  const endEvent = released.events.find((e) => e.type === EVENT.PINCH_END);
  assert.ok(endEvent.velocity && typeof endEvent.velocity.speed === 'number');
});

test('pinch uses hysteresis: wobble between the two thresholds does not flicker', () => {
  const rec = newRec();
  let t = feed(rec, OPEN_HAND(), 4).t;
  t = feed(rec, PINCH_HAND(), 20, t).t;
  assert.equal(rec.state, STATE.PINCH);

  // Values above pinchOn (0.42) but below pinchOff (0.6) must not release.
  let starts = 0;
  let ends = 0;
  for (let i = 0; i < 40; i++) {
    const ratio = 0.48 + (i % 2) * 0.06; // 0.48 .. 0.54
    const hand = makeHand({ bend: { index: BEND.straight, middle: BEND.straight, ring: BEND.straight, pinky: BEND.straight }, pinchRatio: ratio });
    const r = rec.update(hand, t);
    starts += r.events.filter((e) => e.type === EVENT.PINCH_START).length;
    ends += r.events.filter((e) => e.type === EVENT.PINCH_END).length;
    t += 16;
  }
  assert.equal(rec.state, STATE.PINCH);
  assert.equal(starts, 0);
  assert.equal(ends, 0);
});

test('pinch end carries the hand velocity so the app can throw', () => {
  const rec = newRec();
  let t = feed(rec, OPEN_HAND(), 4).t;
  t = feed(rec, PINCH_HAND({ x: 0.4, y: 0.86 }), 20, t).t;
  // Move the pinched hand to the right across several frames.
  let last = null;
  for (let i = 0; i < 8; i++) {
    last = rec.update(PINCH_HAND({ x: 0.4 + i * 0.02, y: 0.86 }), t);
    t += 16;
  }
  assert.ok(last.velocity.x > 0);
});

test('hand leaving the frame emits hand_lost and resets state', () => {
  const rec = newRec();
  const { t } = feed(rec, POINT_HAND(), 6);
  const { events } = feed(rec, null, 1, t);
  assert.equal(rec.state, STATE.LOST);
  assert.equal(events.filter((e) => e.type === EVENT.HAND_LOST).length, 1);
  assert.equal(events.filter((e) => e.type === EVENT.POINT_END).length, 1);
});

test('losing the hand mid-pinch still emits pinch_end so nothing stays grabbed', () => {
  const rec = newRec();
  let t = feed(rec, OPEN_HAND(), 4).t;
  t = feed(rec, PINCH_HAND(), 20, t).t;
  assert.equal(rec.state, STATE.PINCH);
  const { events } = feed(rec, null, 1, t);
  const end = events.find((e) => e.type === EVENT.PINCH_END);
  assert.ok(end, 'pinch_end should fire on hand loss');
  assert.equal(end.reason, 'lost');
  assert.equal(rec.state, STATE.LOST);
});

test('hand returning after loss emits hand_found', () => {
  const rec = newRec();
  const { t } = feed(rec, POINT_HAND(), 4);
  feed(rec, null, 2, t);
  const back = feed(rec, POINT_HAND(), 2, t + 100);
  assert.equal(back.events.filter((e) => e.type === EVENT.HAND_FOUND).length, 1);
});

test('teleport-sized landmark jumps are rejected instead of snapping the cursor', () => {
  // Near-raw filtering makes the guard reachable in a single frame.
  const rec = newRec({ tracking: { smoothing: { minCutoff: 60, beta: 0.3, dCutoff: 1 } } });
  const a = makeHand({ bend: { index: BEND.straight, middle: BEND.curled, ring: BEND.curled, pinky: BEND.curled }, origin: { x: 0.2, y: 0.8 } });
  const b = makeHand({ bend: { index: BEND.straight, middle: BEND.curled, ring: BEND.curled, pinky: BEND.curled }, origin: { x: 0.95, y: 0.8 } });
  feed(rec, a, 3);
  const before = rec.lastCursor.x;
  rec.update(b, 1000);
  assert.ok(rec.jumpRejects >= 1, 'the jump guard should have triggered');
  assert.ok(Math.abs(rec.lastCursor.x - before) < 0.06, 'cursor should hold position, not snap');
});

test('gesture definitions are driven by config (retuning changes behaviour)', () => {
  // With a very loose pinch threshold the same hand reads as a pinch.
  const rec = newRec({ gestures: { pinchOn: 0.9, pinchOff: 1.0 } });
  const hand = makeHand({ bend: { index: BEND.straight, middle: BEND.straight, ring: BEND.straight, pinky: BEND.straight }, pinchRatio: 0.85 });
  const { res } = feed(rec, hand, 12);
  assert.equal(res.state, STATE.PINCH);
});

test('the jump guard does not latch: a persistent move is eventually followed', () => {
  // A single far teleport is rejected as a glitch...
  const rec = newRec({ tracking: { smoothing: { minCutoff: 60, beta: 0.3, dCutoff: 1 } } });
  const A = makeHand({ bend: { index: BEND.straight, middle: BEND.curled, ring: BEND.curled, pinky: BEND.curled }, origin: { x: 0.15, y: 0.8 } });
  const B = makeHand({ bend: { index: BEND.straight, middle: BEND.curled, ring: BEND.curled, pinky: BEND.curled }, origin: { x: 0.9, y: 0.8 } });
  feed(rec, A, 5);
  const held = rec.lastCursor.x;
  rec.update(B, 1000);
  assert.ok(Math.abs(rec.lastCursor.x - held) < 0.06, 'first frame should be held');

  // ...but if the hand stays there, the cursor must catch up rather than
  // being stuck forever at the old position.
  let t = 1016;
  for (let i = 0; i < 12; i++) {
    rec.update(B, t);
    t += 16;
  }
  assert.ok(rec.lastCursor.x > 0.7, `cursor should have followed the hand (got ${rec.lastCursor.x})`);
});

test('a genuinely fast hand movement is never mistaken for a glitch', () => {
  const rec = newRec();
  const hand = (x) => makeHand({ bend: { index: BEND.straight, middle: BEND.curled, ring: BEND.curled, pinky: BEND.curled }, origin: { x, y: 0.8 } });
  let t = 0;
  for (let i = 0; i < 5; i++) { rec.update(hand(0.2), t); t += 16; }
  const before = rec.jumpRejects;
  // 0.02 per frame is a brisk but perfectly ordinary hand speed.
  for (let i = 0; i < 20; i++) { rec.update(hand(0.2 + i * 0.02), t); t += 16; }
  assert.equal(rec.jumpRejects, before, 'normal motion must not be rejected');
});
