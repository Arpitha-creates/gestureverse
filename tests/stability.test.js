/**
 * Drawing stability.
 *
 * These are the failure modes that made the pen feel wrong, measured rather
 * than eyeballed: a lagging pen distorts the shape you drew, and a hand held
 * still must not scribble. Numbers here came from tuning the filter against a
 * noisy virtual hand; the thresholds are deliberately loose enough to allow
 * tuning, tight enough to catch a real regression.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { analyzeHand } from '../src/gestures/handPose.js';
import { HandState } from '../src/gestures/handState.js';
import { Interaction } from '../src/gestures/interaction.js';
import { DrawingWorld } from '../src/objects/world.js';
import { OneEuroPoint, resample } from '../src/core/util.js';
import { makeHand } from './helpers/hands.js';

const VIEWPORT = { width: 1000, height: 1000 };
const SX = 16;
const SY = 9;
const toWorld = (p, z = 0) => ({ x: (p.x - 0.5) * SX, y: -(p.y - 0.5) * SY, z });
const project = (v) => ({ x: (v.x / SX) * 1000 + 500, y: (-v.y / SY) * 1000 + 500 });
const RADIUS = 0.16;

function makeNoise(seed) {
  let s = seed;
  const r = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  // Sum of uniforms: roughly gaussian landmark jitter.
  return (sigma) => (r() + r() + r() + r() - 2) * sigma * 1.7;
}

function drive({ frames = 200, sigma = 0.004, still = false, seed = 7 }) {
  const noise = makeNoise(seed);
  const world = new DrawingWorld(CONFIG);
  const interaction = new Interaction(CONFIG, world);
  const state = new HandState(CONFIG);
  const slot = {
    index: 0,
    state,
    pose: null,
    result: { state: 'lost', previous: 'lost', changed: false, pose: null, holdMs: 0 },
    tipFilter: new OneEuroPoint(CONFIG.smoothing.pen),
    pinchFilter: new OneEuroPoint(CONFIG.smoothing.grab),
  };
  let now = 0;
  let lagSum = 0;
  let lagCount = 0;

  for (let f = 0; f < frames; f++) {
    const t = f / (frames - 1);
    const a = t * Math.PI * 1.5;
    const at = still ? { x: 0.5, y: 0.5 } : { x: 0.5 + Math.cos(a) * RADIUS, y: 0.5 + Math.sin(a) * RADIUS };

    const lm = makeHand('point', at).map((p) => ({
      x: p.x + noise(sigma),
      y: p.y + noise(sigma),
      z: p.z,
    }));

    slot.pose = analyzeHand(lm, CONFIG);
    now += 1000 / 60;
    slot.pose.tip = slot.tipFilter.filter(slot.pose.tip, now / 1000);
    slot.pose.pinch = slot.pinchFilter.filter(slot.pose.pinch, now / 1000);
    slot.result = state.update(slot.pose, now);

    if (!still) {
      const pen = toWorld(slot.pose.tip, 0);
      const truth = toWorld(at, 0);
      lagSum += Math.hypot(pen.x - truth.x, pen.y - truth.y);
      lagCount++;
    }

    interaction.update({
      hands: [slot],
      now,
      dt: 1 / 60,
      mode: 'draw',
      brush: { color: '#38f0ff', width: 0.019 },
      eraser: false,
      toWorld,
      project,
      viewport: VIEWPORT,
    });
  }

  slot.pose = null;
  slot.result = state.update(null, (now += 20));
  interaction.update({
    hands: [slot],
    now,
    dt: 1 / 60,
    mode: 'draw',
    brush: { color: '#38f0ff', width: 0.019 },
    eraser: false,
    toWorld,
    project,
    viewport: VIEWPORT,
  });

  return { world, lag: lagCount ? lagSum / lagCount : 0 };
}

function shapeError(world) {
  const pts = world.drawings.flatMap((d) =>
    d.points.map((p) => ({ x: p.x + d.position.x, y: p.y + d.position.y })),
  );
  if (pts.length < 4) return 1;
  const dense = resample(pts, 200);
  const rx = RADIUS * SX;
  const ry = RADIUS * SY;
  let sum = 0;
  for (const p of dense) sum += Math.abs(Math.hypot(p.x / rx, p.y / ry) - 1);
  return sum / dense.length;
}

test('a hand held still never scribbles a drawing', () => {
  for (const sigma of [0.004, 0.008]) {
    const { world } = drive({ still: true, frames: 120, sigma });
    assert.equal(
      world.count,
      0,
      `sigma ${sigma}: a stationary hand produced ${world.count} drawing(s)`,
    );
  }
});

test('one continuous gesture produces exactly one drawing', () => {
  const { world } = drive({ sigma: 0.004 });
  assert.equal(world.count, 1);
});

test('the pen follows the hand closely enough to keep the shape', () => {
  const { lag } = drive({ sigma: 0.004 });
  const lagPx = (lag / SY) * 1000;
  assert.ok(lagPx < 30, `pen lagged ${lagPx.toFixed(1)}px behind the fingertip (limit 30)`);
});

test('a drawn circle stays a circle', () => {
  for (const sigma of [0.004, 0.008]) {
    const { world } = drive({ sigma });
    const err = shapeError(world);
    assert.ok(err < 0.03, `sigma ${sigma}: radial error ${(err * 100).toFixed(1)}% (limit 3%)`);
  }
});

test('stroke cleanup does not destroy detail', () => {
  const { world } = drive({ sigma: 0.004 });
  const d = world.drawings[0];
  assert.ok(d.points.length >= 20, `only ${d.points.length} points kept - shape would look blocky`);
});
