/**
 * Performance and cache-correctness tests.
 *
 * The offscreen stroke cache is a real optimisation only if two things hold:
 * it must actually avoid work, and it must never serve stale pixels. Both are
 * asserted here, because a cache that silently stops updating is far worse
 * than no cache at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installFakeDom } from './fakeDom.mjs';
import { createConfig } from '../src/core/config.js';
import { StrokeManager, TOOL } from '../src/drawing/strokeManager.js';
import { StrokeRenderer } from '../src/render/strokeRenderer.js';

installFakeDom();

function makeRenderer() {
  const canvas = document.createElement('canvas');
  return new StrokeRenderer(canvas, createConfig());
}

function addStroke(sm, i) {
  sm.begin(100 + i, 100, { tool: TOOL.FREEHAND });
  for (let k = 0; k < 40; k++) sm.addPoint(100 + i + k, 100 + k);
  sm.end();
}

test('committed strokes are rasterised once, not once per frame', () => {
  const sm = new StrokeManager(createConfig());
  const renderer = makeRenderer();
  renderer.resize(1280, 720);

  const STROKES = 60;
  for (let i = 0; i < STROKES; i++) addStroke(sm, i);

  let draws = 0;
  const original = renderer._drawStroke.bind(renderer);
  renderer._drawStroke = (s, live) => {
    draws++;
    return original(s, live);
  };

  // Render 60 frames of an idle scene.
  const FRAMES = 60;
  for (let f = 0; f < FRAMES; f++) renderer.render(sm, sm.active, false);

  // Without the cache this would be STROKES * FRAMES = 3600 traces.
  assert.ok(
    draws <= STROKES + 2,
    `expected ~${STROKES} traces for ${FRAMES} frames, got ${draws}`,
  );
});

test('a live stroke is redrawn each frame but committed strokes are not', () => {
  const sm = new StrokeManager(createConfig());
  const renderer = makeRenderer();
  renderer.resize(1280, 720);
  for (let i = 0; i < 40; i++) addStroke(sm, i);

  let committedDraws = 0;
  let liveDraws = 0;
  const original = renderer._drawStroke.bind(renderer);
  renderer._drawStroke = (s, live) => {
    if (live) liveDraws++;
    else committedDraws++;
    return original(s, live);
  };

  sm.begin(500, 500, { tool: TOOL.FREEHAND });
  for (let f = 0; f < 30; f++) {
    sm.addPoint(500 + f, 500 + f);
    renderer.render(sm, sm.active, true);
  }

  assert.ok(committedDraws <= 42, `committed strokes should be cached (got ${committedDraws})`);
  assert.ok(liveDraws >= 30, `the live stroke should redraw every frame (got ${liveDraws})`);
});

test('the cache is invalidated by every mutation of the stroke list', () => {
  const sm = new StrokeManager(createConfig());
  const renderer = makeRenderer();
  renderer.resize(1280, 720);

  // Prime the cache.
  addStroke(sm, 0);
  assert.equal(renderer.render(sm, null, false), true);
  assert.equal(renderer.render(sm, null, false), false, 'idle scene should short-circuit');
  assert.equal(renderer.cachedVersion, sm.version);

  // Every one of these must force a rebuild.
  addStroke(sm, 1);
  assert.equal(renderer.render(sm, null, false), true, 'adding a stroke must invalidate');
  assert.equal(renderer.cachedVersion, sm.version);

  sm.undo();
  assert.equal(renderer.render(sm, null, false), true, 'undo must invalidate');

  sm.redo();
  assert.equal(renderer.render(sm, null, false), true, 'redo must invalidate');

  sm.remove(sm.strokes[0].id);
  assert.equal(renderer.render(sm, null, false), true, 'remove must invalidate');

  sm.clear();
  assert.equal(renderer.render(sm, null, false), true, 'clear must invalidate');
  assert.equal(sm.strokes.length, 0);
});

test('resizing forces a cache rebuild at the new size', () => {
  const sm = new StrokeManager(createConfig());
  const renderer = makeRenderer();
  renderer.resize(1280, 720);
  addStroke(sm, 0);
  renderer.render(sm, null, false);
  const before = renderer.cachedVersion;

  renderer.resize(900, 600);
  assert.notEqual(renderer.cachedVersion, before);
  assert.equal(renderer.cachedVersion, -1);
  assert.equal(renderer.render(sm, null, false), true);
});

test('StrokeManager.version advances on every mutation', () => {
  const sm = new StrokeManager(createConfig());
  const v0 = sm.version;

  sm.begin(0, 0);
  sm.addPoint(0.2, 0.2);
  sm.end();
  const v1 = sm.version;
  assert.ok(v1 > v0, 'committing a stroke must bump the version');

  sm.undo();
  assert.ok(sm.version > v1, 'undo must bump the version');
  const v2 = sm.version;
  sm.redo();
  assert.ok(sm.version > v2, 'redo must bump the version');
});
