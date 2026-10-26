import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { analyzeHand, mirrorLandmarks } from '../src/gestures/handPose.js';
import { makeHand } from './helpers/hands.js';

test('mirroring flips x and preserves y', () => {
  const lm = mirrorLandmarks([{ x: 0.2, y: 0.4, z: 0 }, { x: 0.9, y: 0.1, z: 0.5 }]);
  assert.equal(lm[0].x, 0.8);
  assert.equal(lm[0].y, 0.4);
  assert.ok(Math.abs(lm[1].x - 0.1) < 1e-9);
  assert.equal(lm[1].z, 0.5);
});

test('pointing hand: only the index reads as extended', () => {
  const pose = analyzeHand(makeHand('point'), CONFIG);
  assert.equal(pose.extended.index, true);
  assert.equal(pose.extended.middle, false);
  assert.equal(pose.extended.ring, false);
  assert.equal(pose.extended.pinky, false);
  assert.ok(pose.pinchRatio > CONFIG.gesture.pinchOff, `pinchRatio ${pose.pinchRatio} should read as open`);
});

test('pinching hand: thumb and index tips collapse', () => {
  const pose = analyzeHand(makeHand('pinch'), CONFIG);
  assert.ok(pose.pinchRatio < CONFIG.gesture.pinchOn, `pinchRatio ${pose.pinchRatio} should read as pinched`);
});

test('fist: nothing extended, and never mistaken for a pinch', () => {
  const pose = analyzeHand(makeHand('fist'), CONFIG);
  assert.equal(pose.extendedCount, 0);
  // In a fist the thumb and index tips touch, so the raw ratio looks pinched.
  // The reach gate is what stops that becoming a grab.
  assert.ok(pose.pinchRatio < CONFIG.gesture.pinchOn);
  assert.ok(
    pose.indexReach < CONFIG.gesture.pinchMinReach,
    `indexReach ${pose.indexReach} should be folded back inside the palm`,
  );
});

test('a pinch holds the index tip out in front of the palm', () => {
  const pose = analyzeHand(makeHand('pinch'), CONFIG);
  assert.ok(pose.indexReach > CONFIG.gesture.pinchMinReach);
});

test('open palm: every finger extended', () => {
  const pose = analyzeHand(makeHand('palm'), CONFIG);
  assert.equal(pose.extendedCount, 4);
});

test('a hand translated on screen keeps the same ratios', () => {
  const a = analyzeHand(makeHand('point', { x: 0.3, y: 0.4 }), CONFIG);
  const b = analyzeHand(makeHand('point', { x: 0.7, y: 0.6 }), CONFIG);
  assert.ok(Math.abs(a.pinchRatio - b.pinchRatio) < 1e-6);
  assert.ok(Math.abs(a.palmSize - b.palmSize) < 1e-6);
});

test('target placement lands the index tip where asked', () => {
  const pose = analyzeHand(makeHand('point', { x: 0.25, y: 0.75 }), CONFIG);
  assert.ok(Math.abs(pose.tip.x - 0.25) < 1e-6);
  assert.ok(Math.abs(pose.tip.y - 0.75) < 1e-6);
});

test('rejects malformed input', () => {
  assert.equal(analyzeHand([], CONFIG), null);
  assert.equal(analyzeHand(null, CONFIG), null);
});
