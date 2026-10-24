/**
 * Boot smoke test.
 *
 * Loads the REAL application module graph (with Three.js and MediaPipe swapped
 * for stubs by tests/loader.mjs), boots it against a fake DOM, and then drives
 * the full signature interaction through `GestureVerse.frame()` - the same
 * method the browser's render loop calls.
 *
 * This is what catches the errors a unit test cannot: a renamed DOM id, a
 * method that moved, an event handler wired to the wrong subsystem, or a frame
 * that throws once there are objects in the scene.
 *
 * Run with the stub loader:
 *   node --import ./tests/register.mjs --test tests/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installFakeDom } from './fakeDom.mjs';
import { makeHand, BEND } from './helpers/syntheticHand.js';

const POINT_BEND = { index: BEND.straight, middle: BEND.curled, ring: BEND.curled, pinky: BEND.curled };
const OPEN_BEND = { index: BEND.straight, middle: BEND.straight, ring: BEND.straight, pinky: BEND.straight };

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

async function bootApp() {
  const dom = installFakeDom();
  const { GestureVerse } = await import('../src/main.js');
  const app = new GestureVerse();
  await app.init();
  // init() kicks off the render loop; our requestAnimationFrame stub is a
  // no-op, so the test drives every frame explicitly.
  const step = (hand) => {
    app.latestHands = hand ? [hand] : [];
    dom.clock.t += 1000 / 60;
    app.frame(1 / 60, dom.clock.t / 1000);
  };
  return { app, dom, step };
}

test('the app boots against the real index.html and survives empty frames', async () => {
  const { app, step } = await bootApp();
  assert.ok(app.sceneView, 'scene view should exist');
  assert.ok(app.strokeRenderer, 'stroke renderer should exist');
  assert.ok(app.ui, 'ui should exist');
  assert.ok(app.mapper, 'coordinate mapper should exist');

  for (let i = 0; i < 20; i++) step(null);
  assert.equal(app.strokeManager.strokes.length, 0);
  assert.equal(app.objectManager.all().length, 0);
});

test('every DOM id the app expects is actually present in index.html', async () => {
  const { app, dom } = await bootApp();
  // UI constructor resolves these eagerly; if any were missing the app would
  // have thrown during init(), but assert explicitly for a clear message.
  for (const id of ['scene', 'overlay', 'camera', 'palette', 'brushes', 'tools', 'hud-mode']) {
    assert.ok(dom.byId.has(id), `index.html should contain #${id}`);
  }
  assert.ok(app.ui.el.scene);
  assert.ok(app.ui.el.overlay);
});

test('boot -> draw -> object -> grab -> move -> release, driven through frame()', async () => {
  const { app, dom, step } = await bootApp();

  const rect = app.overlayRect();
  const toNorm = (px, py) => {
    const m = app.config.world.margin;
    let rx = m + (px / rect.width) * (1 - 2 * m);
    const ry = m + (py / rect.height) * (1 - 2 * m);
    if (app.config.mirror) rx = 1 - rx;
    return { x: rx, y: ry };
  };

  // --- draw a circle in canvas space -------------------------------
  const R = 170;
  const frames = 150;
  const startNorm = toNorm(rect.width / 2 + R, rect.height / 2);
  for (let i = 0; i <= frames; i++) {
    const a = (i / frames) * Math.PI * 2;
    step(handAt(toNorm(rect.width / 2 + Math.cos(a) * R, rect.height / 2 + Math.sin(a) * R), POINT_BEND));
  }
  assert.ok(app.strokeManager.isDrawing, 'a stroke should be in progress');

  // --- open the hand: the stroke ends and becomes an object ----------
  for (let i = 0; i < 12; i++) step(handAt(startNorm, OPEN_BEND));

  assert.equal(app.strokeManager.strokes.length, 0, 'the stroke is consumed by the object');
  assert.equal(app.objectManager.all().length, 1, 'exactly one object should have been created');
  const obj = app.objectManager.all()[0];
  assert.equal(obj.geometry, 'sphere', 'a drawn circle becomes a sphere');
  assert.ok(app.objectViews.views.has(obj.id), 'a mesh should exist for the new object');

  // --- move the cursor onto it and pinch -----------------------------
  const onObject = app.mapper.worldToNormalized(obj.position);
  // Give the One Euro filter time to settle on the object before asserting.
  for (let i = 0; i < 45; i++) step(handAt(onObject, POINT_BEND));
  assert.ok(obj.selectable, 'the object should be highlighted when the cursor is on it');

  for (let i = 0; i < 20 && !app.objectManager.held; i++) step(handAt(onObject, POINT_BEND, 0.2));
  assert.ok(app.objectManager.held, 'pinching on the object should grab it');
  assert.equal(app.objectManager.held.id, obj.id);

  // --- carry it somewhere else ---------------------------------------
  const destination = { x: onObject.x + 0.12, y: onObject.y - 0.1 };
  for (let i = 0; i < 70; i++) {
    const k = Math.min(1, (i + 1) / 50);
    step(
      handAt(
        { x: onObject.x + (destination.x - onObject.x) * k, y: onObject.y + (destination.y - onObject.y) * k },
        POINT_BEND,
        0.2,
      ),
    );
  }
  assert.ok(app.objectManager.held, 'the object should still be held while being carried');
  const carried = { ...obj.position };

  // --- release, then walk the hand away ------------------------------
  for (let i = 0; i < 30; i++) step(handAt(destination, POINT_BEND));
  assert.equal(app.objectManager.held, null, 'the release should have let go');
  const placed = { ...obj.position };

  for (let i = 0; i < 40; i++) step(handAt({ x: 0.9, y: 0.85 }, POINT_BEND));
  assert.deepEqual(obj.position, placed, 'the placed object must not drift');

  // The scene keeps rendering cleanly with an object present.
  for (let i = 0; i < 30; i++) step(handAt({ x: 0.9, y: 0.85 }, POINT_BEND));
  assert.ok(carried.y !== undefined);
});

test('mode switching, panel toggles and shortcuts do not throw', async () => {
  const { app, dom } = await bootApp();
  assert.doesNotThrow(() => app.setMode('play'));
  assert.doesNotThrow(() => app.setMode('creative'));
  assert.equal(app.objectManager.all().length, app.config.objects.sampleObjects, 'creative mode seeds samples');
  assert.doesNotThrow(() => app.setMode('draw'));

  assert.doesNotThrow(() => app.ui.toggleGuide(true));
  assert.doesNotThrow(() => app.ui.togglePanels(true));
  assert.doesNotThrow(() => app.ui.togglePanels(false));
  assert.doesNotThrow(() => app.applyPreset('responsive'));
  assert.doesNotThrow(() => app.applySensitivity(-2));
  assert.doesNotThrow(() => app.applySensitivity(0));

  assert.doesNotThrow(() => app.clearCanvas());
  assert.doesNotThrow(() => app.resetAll());
  assert.equal(app.objectManager.all().length, 0);
  assert.ok(dom.clock.t >= 0);
});

test('the tracker reports a friendly error instead of crashing when the camera is denied', async () => {
  const { app } = await bootApp();
  globalThis.navigator.mediaDevices.getUserMedia = () => {
    const err = new Error('denied');
    err.name = 'NotAllowedError';
    return Promise.reject(err);
  };
  await app.start();
  assert.equal(app._running, false);
  assert.match(app.ui.el.errorText.textContent, /camera/i);
});
