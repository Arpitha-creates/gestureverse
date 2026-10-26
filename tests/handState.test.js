import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { analyzeHand } from '../src/gestures/handPose.js';
import { HandState } from '../src/gestures/handState.js';
import { HandStateName } from '../src/gestures/states.js';
import { makeHand } from './helpers/hands.js';

const pose = (kind) => analyzeHand(makeHand(kind), CONFIG);

test('pinch needs confirmation frames before it engages', () => {
  const s = new HandState(CONFIG);
  const p = pose('pinch');
  s.update(p, 0);
  assert.equal(s.state, HandStateName.IDLE);
  s.update(p, 16);
  assert.equal(s.state, HandStateName.PINCH, 'second agreeing frame commits the pinch');
});

test('a held pinch never flickers', () => {
  const s = new HandState(CONFIG);
  const p = pose('pinch');
  let t = 0;
  for (let i = 0; i < 4; i++) s.update(p, (t += 16));
  for (let i = 0; i < 60; i++) {
    const r = s.update(p, (t += 16));
    assert.equal(r.state, HandStateName.PINCH);
  }
});

test('pinch releases only past the wider release threshold', () => {
  const s = new HandState(CONFIG);
  const pinched = pose('pinch');
  const open = pose('point');
  let t = 0;
  s.update(pinched, (t += 16));
  s.update(pinched, (t += 16));
  assert.equal(s.state, HandStateName.PINCH);
  s.update(open, (t += 16));
  s.update(open, (t += 16));
  assert.notEqual(s.state, HandStateName.PINCH, 'opening the hand releases the pinch');
});

test('pointing needs three agreeing frames', () => {
  const s = new HandState(CONFIG);
  const p = pose('point');
  s.update(p, 0);
  s.update(p, 16);
  assert.notEqual(s.state, HandStateName.POINT);
  s.update(p, 32);
  assert.equal(s.state, HandStateName.POINT);
});

test('flickering between postures never commits', () => {
  const s = new HandState(CONFIG);
  const point = pose('point');
  const fist = pose('fist');
  let t = 0;
  for (let i = 0; i < 20; i++) {
    s.update(i % 2 === 0 ? point : fist, (t += 16));
    assert.notEqual(s.state, HandStateName.POINT);
    assert.notEqual(s.state, HandStateName.FIST);
  }
});

test('losing the hand resets to lost and clears the pinch', () => {
  const s = new HandState(CONFIG);
  const p = pose('pinch');
  s.update(p, 0);
  s.update(p, 16);
  assert.equal(s.state, HandStateName.PINCH);
  const r = s.update(null, 32);
  assert.equal(r.state, HandStateName.LOST);
  assert.equal(r.pinch, false);
});

test('palm hold accumulates time', () => {
  const s = new HandState(CONFIG);
  const p = pose('palm');
  let t = 0;
  for (let i = 0; i < 5; i++) s.update(p, (t += 16));
  const r = s.update(p, (t += 500));
  assert.equal(r.state, HandStateName.PALM);
  assert.ok(r.holdMs > 400);
});

test('a fist requires more confirmation than a point', () => {
  assert.ok(CONFIG.gesture.fistConfirmFrames > CONFIG.gesture.pointConfirmFrames);
});
