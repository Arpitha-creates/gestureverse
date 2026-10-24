import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createConfig } from '../src/core/config.js';
import { StrokeManager, TOOL } from '../src/drawing/strokeManager.js';

function manager() {
  return new StrokeManager(createConfig());
}

test('a freehand stroke is committed with its points', () => {
  const sm = manager();
  sm.begin(0.1, 0.1, { tool: TOOL.FREEHAND });
  sm.addPoint(0.2, 0.2);
  sm.addPoint(0.3, 0.25);
  const stroke = sm.end();
  assert.ok(stroke);
  assert.equal(sm.strokes.length, 1);
  assert.equal(stroke.points.length, 3);
  assert.equal(sm.isDrawing, false);
});

test('points closer than minPointDistance are filtered to keep strokes light', () => {
  const sm = manager();
  sm.begin(0.1, 0.1);
  const accepted1 = sm.addPoint(0.1, 0.1); // identical -> rejected
  const accepted2 = sm.addPoint(0.1, 0.1 + 1e-6); // too close -> rejected
  const accepted3 = sm.addPoint(0.2, 0.2); // far enough -> accepted
  assert.equal(accepted1, false);
  assert.equal(accepted2, false);
  assert.equal(accepted3, true);
  assert.equal(sm.active.points.length, 2);
});

test('a tap with no movement does not create a stroke', () => {
  const sm = manager();
  sm.begin(0.5, 0.5);
  const stroke = sm.end();
  assert.equal(stroke, null);
  assert.equal(sm.strokes.length, 0);
});

test('a parametric shape records start and end', () => {
  const sm = manager();
  sm.begin(0.2, 0.2, { tool: TOOL.CIRCLE });
  sm.addPoint(0.5, 0.6);
  const stroke = sm.end();
  assert.equal(stroke.kind, 'shape');
  assert.deepEqual(stroke.start, { x: 0.2, y: 0.2 });
  assert.deepEqual(stroke.end, { x: 0.5, y: 0.6 });
});

test('a shape that never moved is rejected', () => {
  const sm = manager();
  sm.begin(0.2, 0.2, { tool: TOOL.LINE });
  assert.equal(sm.end(), null);
});

test('undo and redo move through stroke history', () => {
  const sm = manager();
  sm.begin(0, 0);
  sm.addPoint(0.2, 0.2);
  sm.end();
  sm.begin(0.5, 0.5);
  sm.addPoint(0.7, 0.7);
  sm.end();
  assert.equal(sm.strokes.length, 2);

  assert.equal(sm.undo(), true);
  assert.equal(sm.strokes.length, 1);
  assert.equal(sm.undo(), true);
  assert.equal(sm.strokes.length, 0);
  assert.equal(sm.undo(), false);

  assert.equal(sm.redo(), true);
  assert.equal(sm.strokes.length, 1);
  assert.equal(sm.redo(), true);
  assert.equal(sm.strokes.length, 2);
  assert.equal(sm.redo(), false);
});

test('a new stroke clears the redo stack', () => {
  const sm = manager();
  sm.begin(0, 0);
  sm.addPoint(0.2, 0.2);
  sm.end();
  sm.undo();
  assert.equal(sm.canRedo(), true);
  sm.begin(0.4, 0.4);
  sm.addPoint(0.6, 0.6);
  sm.end();
  assert.equal(sm.canRedo(), false);
});

test('clear can be undone', () => {
  const sm = manager();
  sm.begin(0, 0);
  sm.addPoint(0.2, 0.2);
  sm.end();
  assert.equal(sm.clear(), true);
  assert.equal(sm.strokes.length, 0);
  assert.equal(sm.undo(), true);
  assert.equal(sm.strokes.length, 1);
});

test('hit testing finds the stroke under a point', () => {
  const sm = manager();
  sm.begin(100, 100, { tool: TOOL.FREEHAND, width: 6 });
  sm.addPoint(120, 100);
  sm.addPoint(140, 100);
  sm.end();
  assert.ok(sm.hitTest(130, 102, 8));
  assert.equal(sm.hitTest(300, 300, 8), null);
});

test('serialisation round-trips strokes', () => {
  const sm = manager();
  sm.begin(0, 0);
  sm.addPoint(0.2, 0.2);
  sm.end();
  const json = JSON.parse(JSON.stringify(sm.toJSON()));
  const sm2 = manager();
  assert.equal(sm2.loadJSON(json), true);
  assert.equal(sm2.strokes.length, 1);
});
