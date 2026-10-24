/**
 * GestureVerse - application orchestration.
 *
 * Wires the hand tracker to the gesture recognizer, and the recognizer's
 * events to drawing, object manipulation, effects and UI. This is the only
 * module that knows about every subsystem.
 *
 * Frame model: the tracker runs its own detection loop and drops the newest
 * hands into `latestHands`. The render loop reads that and does all the
 * gesture interpretation, physics and drawing, so detection never blocks
 * rendering and a slow inference frame simply reuses the previous landmarks.
 */

import { createConfig, PRESETS, deepMerge, cloneConfig } from './core/config.js';
import { CoordinateMapper } from './core/coordinateMapper.js';
import { bbox } from './core/math.js';
import { handScale, palmCenter } from './gestures/landmarks.js';
import { GestureRecognizer, STATE, EVENT } from './gestures/gestureRecognizer.js';
import { TwoHandController } from './gestures/twoHandController.js';
import { StrokeManager, TOOL } from './drawing/strokeManager.js';
import { recognizeShape, SHAPE } from './drawing/shapeRecognizer.js';
import { ObjectManager, OBJ_STATE } from './objects/objectManager.js';
import { descriptorForShape, sampleObject, shapeLabel, GEOMETRY } from './objects/objectFactory.js';
import { HandTracker } from './tracking/handTracker.js';
import { SceneView } from './render/scene.js';
import { ObjectViewManager } from './render/objectView.js';
import { Effects } from './render/effects.js';
import { StrokeRenderer } from './render/strokeRenderer.js';
import { UI } from './ui/ui.js';

const MODE = { DRAW: 'draw', PLAY: 'play', CREATIVE: 'creative' };

const GESTURE_LABEL = {
  [STATE.NONE]: 'Neutral',
  [STATE.POINT]: 'Pointing',
  [STATE.PINCH]: 'Pinch',
  [STATE.PALM]: 'Open palm',
  [STATE.FIST]: 'Fist',
  [STATE.LOST]: 'No hand',
};

export class GestureVerse {
  constructor() {
    this.config = createConfig();
    this.mode = MODE.DRAW;
    this.paused = false;
    this.drawing = false;
    this.latestHands = [];
    this.latestStats = { fps: 0 };
    this.lastHandScale = this.config.world.sizeReference;
    this.lastStroke = null;
    this.lastRecognition = null;
    this._hudTimer = 0;
    this._running = false;
    this._primarySide = null;
    this._primarySince = 0;
    this._palmHeld = 0;
    this._palmFired = false;
    this.palmPauseSeconds = 1.0;
    this._hadHand = false;
    this._fpsSamples = [];
  }

  async init() {
    const el = {
      scene: document.getElementById('scene'),
      overlay: document.getElementById('overlay'),
      video: document.getElementById('camera'),
    };
    this.dom = el;

    this.ui = new UI(this.config);
    this.mapper = new CoordinateMapper(this.config);
    this.strokeManager = new StrokeManager(this.config);
    this.objectManager = new ObjectManager(this.config);
    this.recognizer = new GestureRecognizer(this.config);
    this.twoHand = new TwoHandController(this.config);
    this.sceneView = new SceneView(this.config, el.scene);
    this.objectViews = new ObjectViewManager(this.sceneView);
    this.effects = new Effects(this.sceneView, this.config);
    this.strokeRenderer = new StrokeRenderer(el.overlay, this.config);
    this.tracker = new HandTracker(this.config);

    this._bindUI();
    this._bindResize();
    this.sceneView.onFrame = (dt, elapsed) => this.frame(dt, elapsed);
    this.sceneView.start();
    this.resize();

    this.ui.setMode(this.mode);
    this.ui.setThrowEnabled(this.config.throwEnabled);
    this.ui.showOnboarding();
    this.ui.setTracking('Waiting to start', false);
  }

  _bindUI() {
    this.ui.on('mode', (m) => this.setMode(m));
    this.ui.on('color', (c) => {
      this.currentColor = c;
    });
    this.ui.on('brush', (w) => {
      this.currentWidth = w;
    });
    this.ui.on('tool', (t) => {
      this.currentTool = t;
    });
    this.ui.on('undo', () => {
      if (this.strokeManager.undo()) {
        this.ui.toast('Undo');
        this._syncHistory();
      }
    });
    this.ui.on('redo', () => {
      if (this.strokeManager.redo()) {
        this.ui.toast('Redo');
        this._syncHistory();
      }
    });
    this.ui.on('clear', () => this.clearCanvas());
    this.ui.on('save', () => this.capture());
    this.ui.on('reset', () => this.resetAll());
    this.ui.on('fullscreen', () => this.toggleFullscreen());
    this.ui.on('camera', (on) => {
      this.config.showCamera = on;
      this.ui.setCameraVisible(on);
    });
    this.ui.on('throw', (on) => {
      this.config.throwEnabled = on;
      this.ui.toast(on ? 'Throwing enabled' : 'Throwing disabled');
    });
    this.ui.on('hand', (h) => {
      this.config.handedness = h;
    });
    this.ui.on('sensitivity', (v) => this.applySensitivity(v));
    this.ui.on('preset', (p) => this.applyPreset(p));
    this.ui.on('start', () => this.start());
    this.ui.on('retry', () => this.start());

    const makeBtn = document.getElementById('btn-make');
    if (makeBtn) makeBtn.addEventListener('click', () => this.makeObjectFromLastStroke());
    const shapeSel = document.getElementById('shape-select');
    if (shapeSel) {
      for (const s of Object.values(SHAPE)) {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = shapeLabel(s);
        shapeSel.appendChild(o);
      }
    }
    this.currentColor = this.config.drawing.defaultColor;
    this.currentWidth = this.config.drawing.defaultWidth;
    this.currentTool = TOOL.FREEHAND;

    window.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        this.makeObjectFromLastStroke();
      } else if (e.key === 'g') {
        this.ui.toggleGuide();
      } else if (e.key === 'h') {
        this.ui.togglePanels();
      } else if (e.key === 'Escape') {
        this.clearCanvas();
      }
    });
  }

  _bindResize() {
    window.addEventListener('resize', () => this.resize());
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(this.dom.scene.parentElement || document.body);
    }
  }

  resize() {
    this.sceneView.resize();
    const w = this.sceneView.width || window.innerWidth;
    const h = this.sceneView.height || window.innerHeight;
    this.strokeRenderer.resize(w, h);
    this.mapper.setViewport(w, h);
  }

  /** Begin camera capture and hand tracking. */
  async start() {
    this.ui.hideError();
    this.ui.setTracking('Starting camera…', false);
    try {
      await this.tracker.start(this.dom.video, {
        onResult: (result, stats) => {
          this.latestHands = HandTracker.toHands(result);
          this.latestStats = stats;
        },
        onError: (err) => this.ui.showError(err.message),
      });
      this.ui.hideOnboarding();
      this.ui.setTracking('Tracking', true);
      this._running = true;
      this.ui.toast('Show your hand to begin', 'good');
    } catch (err) {
      this._running = false;
      this.ui.setTracking('Tracking failed', false);
      this.ui.showError(err.message || 'Could not start the camera.');
      this.ui.showOnboarding();
    }
  }

  setMode(mode) {
    if (!Object.values(MODE).includes(mode)) return;
    if (this.drawing) {
      this.strokeManager.end();
      this.drawing = false;
    }
    this.mode = mode;
    this.ui.setMode(mode);
    this.ui.toast(
      {
        [MODE.DRAW]: 'Air Drawing — point to draw, pinch to grab',
        [MODE.PLAY]: 'Object Playground — pinch an object to grab it',
        [MODE.CREATIVE]: 'Creative Playground — grab, stack and throw',
      }[mode],
    );
    if (mode === MODE.CREATIVE) this.seedSampleObjects();
  }

  /* ---------------------------------------------------------------- frame */

  frame(dt, elapsed) {
    const hands = this.latestHands || [];
    const { primary, secondary } = this.selectHands(hands);
    const now = performance.now();

    const res = this.recognizer.update(primary, now);
    this.lastRes = res;

    if (primary && res.metrics) this.lastHandScale = res.metrics.scale;

    // --- two-hand scale / rotate -------------------------------------
    const palmA = primary ? palmCenter(primary.landmarks) : null;
    const palmB = secondary ? palmCenter(secondary.landmarks) : null;
    const two = this.twoHand.update(palmA, palmB, dt);
    if (two.events.length) for (const ev of two.events) this.handleTwoHandEvent(ev);
    if (two.active && this.objectManager.held) {
      if (!this._transforming) {
        this.objectManager.beginTransform();
        this._transforming = true;
      }
      this.objectManager.applyTransform(two.scale, two.rotation);
    } else if (this._transforming) {
      this._transforming = false;
    }

    // --- cursor in both coordinate spaces ----------------------------
    const cursorCanvas = this.mapper.toCanvasInRect(res.cursor, this.overlayRect());
    const worldPos = this.mapper.toWorld(res.cursor, this.lastHandScale);

    // --- gesture events ----------------------------------------------
    for (const ev of res.events) this.handleEvent(ev, res, cursorCanvas, worldPos);

    // --- open palm: brief = end the stroke, held = toggle pause --------
    // Splitting these matters: in Air Drawing you finish a stroke by opening
    // your hand, and that must not also pause the app. Pausing is a deliberate
    // gesture, so it requires holding the palm for about a second.
    if (res.state === STATE.PALM && primary) {
      this._palmHeld += dt;
      if (!this._palmFired && this._palmHeld >= this.palmPauseSeconds) {
        this._palmFired = true;
        this.togglePause();
      }
    } else {
      this._palmHeld = 0;
      this._palmFired = false;
    }

    // --- continuous interactions --------------------------------------
    if (!this.paused) {
      if (this.drawing && this.mode === MODE.DRAW) {
        this.strokeManager.addPoint(cursorCanvas.x, cursorCanvas.y);
      }
      if (this.objectManager.held) {
        this.objectManager.drag(worldPos, dt);
        this.effects.trailPush(worldPos, this.objectManager.held.color);
      } else if (primary) {
        this.objectManager.updateHover(worldPos);
      } else {
        // No hand in frame: drop any selection glow rather than leaving a
        // stale highlight floating at the frame centre.
        this.objectManager.clearHover();
      }
    }

    // --- physics + views ----------------------------------------------
    const physEvents = this.objectManager.update(dt);
    for (const e of physEvents) {
      if (e.type === 'bounce') {
        const obj = this.objectManager.get(e.id);
        if (obj) this.effects.spawnBurst(obj.position, obj.color, 8, 1.4);
      }
    }
    this.syncObjectViews(elapsed, dt);
    this.effects.update(dt, elapsed);
    this.effects.setCursor(worldPos, {
      visible: !!primary && !this.paused,
      color: this.currentColor,
      pinch: res.pinchStrength,
    });

    // --- draw the ink layer -------------------------------------------
    // The overlay is only touched when it can actually have changed: a hand is
    // on screen (the skeleton must follow it), a stroke is live, or the hand
    // just left (one final pass to clear the skeleton). An idle scene costs
    // nothing.
    const needsOverlay = !!primary || this._hadHand || this.drawing;
    this.strokeRenderer.render(this.strokeManager, this.strokeManager.active, needsOverlay);
    if (primary) {
      this.strokeRenderer.drawHand(primary.landmarks, this.mapper, null, {
        state: res.state,
        pinchStrength: res.pinchStrength,
        color: this._cursorColor(res.state),
      });
    }
    this._hadHand = !!primary;

    // --- adaptive performance ------------------------------------------
    this._adaptPerformance(dt);

    // --- HUD -----------------------------------------------------------
    this._hudTimer += dt;
    if (this._hudTimer > 0.2) {
      this._hudTimer = 0;
      this.updateHud(res, primary, two);
    }
  }

  /**
   * Keep the interaction fast by trading tracking rate for frame rate.
   *
   * Detection is the expensive half of the loop, and its cost is roughly
   * independent of how smooth the rendering is. So when the frame rate dips we
   * halve the detection rate first (barely perceptible, since the cursor is
   * smoothed anyway) before touching anything the user can see. When there is
   * headroom we restore full rate.
   */
  _adaptPerformance(dt) {
    if (!this.config.performance.adaptive) return;
    const fps = dt > 0 ? 1 / dt : 60;
    this._fpsSamples.push(fps);
    if (this._fpsSamples.length > 90) this._fpsSamples.shift();
    if (this._fpsSamples.length < 60) return;

    const avg = this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length;
    const p = this.config.performance;
    if (avg < 42 && p.trackingEveryNthFrame === 1) {
      p.trackingEveryNthFrame = 2;
      this.ui.toast('Smoothing performance — running detection every other frame');
    } else if (avg > 56 && p.trackingEveryNthFrame === 2) {
      p.trackingEveryNthFrame = 1;
    }
  }

  _cursorColor(state) {
    if (state === STATE.PINCH) return '#e879f9';
    if (state === STATE.PALM) return '#facc15';
    if (state === STATE.FIST) return '#f472b6';
    if (this.paused) return '#94a3b8';
    return this.currentColor || '#22d3ee';
  }

  overlayRect() {
    return { x: 0, y: 0, width: this.strokeRenderer.width, height: this.strokeRenderer.height };
  }

  syncObjectViews(elapsed, dt) {
    const live = new Set();
    for (const obj of this.objectManager.all()) {
      live.add(obj.id);
      this.objectViews.ensure(obj);
      this.objectViews.sync(obj, elapsed);
    }
    this.objectViews.prune(live);
    this.objectViews.updatePops(dt);
  }

  /* --------------------------------------------------------------- events */

  handleEvent(ev, res, cursorCanvas, worldPos) {
    switch (ev.type) {
      case EVENT.POINT_START:
        if (this.paused) return;
        if (this.mode === MODE.DRAW) {
          this.strokeManager.begin(cursorCanvas.x, cursorCanvas.y, {
            tool: this.currentTool,
            color: this.currentColor,
            width: this.currentWidth,
          });
          this.drawing = true;
        }
        break;

      case EVENT.POINT_END:
        if (this.drawing) this.finishStroke();
        break;

      case EVENT.PINCH_START: {
        if (this.paused) return;
        if (this.drawing) this.finishStroke();
        const obj = this.objectManager.grab(worldPos);
        if (obj) {
          this.effects.spawnBurst(obj.position, obj.color, 26, 2.2);
          this.ui.toast('Grabbed — move your hand to carry it', 'good');
        }
        break;
      }

      case EVENT.PINCH_END: {
        // The recognizer tags an involuntary end (hand left the frame) with
        // reason:'lost'. That must drop the object, never throw it.
        const lost = ev.reason === 'lost';
        const obj = lost ? this.objectManager.drop() : this.objectManager.release();
        if (obj) {
          this.effects.spawnBurst(obj.position, obj.color, 34, 2.6);
          this.ui.toast(
            obj.state === OBJ_STATE.FLYING ? 'Thrown!' : 'Placed',
            obj.state === OBJ_STATE.FLYING ? 'good' : 'info',
          );
        }
        this.twoHand.reset();
        this._transforming = false;
        this.effects.trailClear();
        break;
      }

      case EVENT.PALM:
        // A palm always ends the current stroke. Pausing is handled separately
        // (see the held-palm timer in frame()), so lifting your pen does not
        // also freeze the app.
        if (this.drawing) this.finishStroke();
        break;

      case EVENT.FIST:
        // Deliberately NOT a scene wipe: it erases only the object the user is
        // already hovering, so a closed hand can never destroy the whole scene.
        this.eraseUnderCursor(worldPos);
        break;

      case EVENT.HAND_LOST:
        if (this.drawing) this.finishStroke();
        if (this.objectManager.held) {
          // drop(), not release(): a tracking dropout must never throw.
          this.objectManager.drop();
          this._transforming = false;
        }
        break;

      default:
        break;
    }
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.drawing) this.finishStroke();
    if (this.paused && this.objectManager.held) this.objectManager.drop();
    this.ui.toast(
      this.paused ? 'Paused — hold an open palm again to resume' : 'Resumed',
      this.paused ? 'info' : 'good',
    );
  }

  handleTwoHandEvent(ev) {
    if (ev.type === 'twohand_start' && this.objectManager.held) {
      this.ui.toast('Two-hand mode — spread to scale, twist to rotate');
    }
  }

  finishStroke() {
    this.drawing = false;
    const stroke = this.strokeManager.end();
    this._syncHistory();
    if (!stroke) return;
    this.lastStroke = stroke;
    if (stroke.kind !== 'freehand') {
      // Parametric shapes are intentional: convert straight away.
      this.convertStroke(stroke, { shape: stroke.tool, confidence: 1, closed: true });
      return;
    }
    const rec = recognizeShape(stroke.points, this.config);
    this.lastRecognition = { stroke, rec };
    const strong = rec.confidence >= 0.75 && rec.closed && rec.shape !== SHAPE.CURVE && rec.shape !== SHAPE.UNKNOWN;
    if (strong) {
      this.convertStroke(stroke, rec);
    } else if (rec.closed && rec.confidence >= this.config.drawing.shape.minConfidence) {
      this.ui.toast(`Looks like a ${shapeLabel(rec.shape)}? Tap "Make object" to create it`);
    }
  }

  /** Turn a stroke into a manipulable 3D object. */
  convertStroke(stroke, rec) {
    const box = bbox(stroke.points);
    const world = this.canvasToWorld({ x: box.cx, y: box.cy }, this.lastHandScale);
    const desc = descriptorForShape(rec.shape, stroke.color);
    const obj = this.objectManager.add({
      kind: desc.geometry,
      geometry: desc.geometry,
      color: stroke.color,
      position: world,
      size: desc.size,
      points: stroke.points,
    });
    this.objectViews.ensure(obj);
    this.objectViews.pop(obj.id);
    this.effects.spawnBurst(world, stroke.color, 44, 3);
    this.strokeManager.remove(stroke.id);
    this._syncHistory();
    this.ui.toast(`${shapeLabel(rec.shape)} created — pinch to grab it`, 'good');
    return obj;
  }

  makeObjectFromLastStroke() {
    const sel = document.getElementById('shape-select');
    const forced = sel && sel.value ? sel.value : null;
    if (this.lastRecognition && this.strokeManager.strokes.includes(this.lastRecognition.stroke)) {
      const { stroke, rec } = this.lastRecognition;
      this.convertStroke(stroke, { ...rec, shape: forced || rec.shape });
      return;
    }
    const strokes = this.strokeManager.strokes;
    if (!strokes.length) {
      this.ui.toast('Draw a shape first');
      return;
    }
    const stroke = strokes[strokes.length - 1];
    const rec = recognizeShape(stroke.points, this.config);
    this.convertStroke(stroke, { ...rec, shape: forced || rec.shape });
  }

  eraseUnderCursor(worldPos) {
    const target = this.objectManager.nearest(worldPos, this.config.objects.hoverRadius);
    if (target) {
      const { object } = target;
      this.effects.spawnBurst(object.position, object.color, 20, 1.8);
      this.objectViews.prune(new Set(this.objectManager.all().map((o) => o.id).filter((id) => id !== object.id)));
      this.objectManager.remove(object.id);
      this.ui.toast('Object removed');
      return;
    }
    const canvasPt = this.mapper.toCanvasInRect(
      this.mapper.worldToNormalized(worldPos),
      this.overlayRect(),
    );
    const stroke = this.strokeManager.hitTest(canvasPt.x, canvasPt.y, 20);
    if (stroke) {
      this.strokeManager.remove(stroke.id);
      this._syncHistory();
      this.ui.toast('Stroke erased');
    } else {
      this.ui.toast('Nothing under the cursor to erase');
    }
  }

  /* ------------------------------------------------------------ utilities */

  canvasToWorld(canvasPt, handScaleValue) {
    const rect = this.overlayRect();
    const m = this.config.world.margin;
    const nx = (canvasPt.x - rect.x) / Math.max(rect.width, 1);
    const ny = (canvasPt.y - rect.y) / Math.max(rect.height, 1);
    let rx = m + nx * (1 - 2 * m);
    const ry = m + ny * (1 - 2 * m);
    if (this.config.mirror) rx = 1 - rx;
    return this.mapper.toWorld({ x: rx, y: ry }, handScaleValue || this.config.world.sizeReference);
  }

  selectHands(hands) {
    if (!hands.length) return { primary: null, secondary: null };
    const pref = this.config.handedness;
    let candidates = hands;
    if (pref !== 'any') {
      const filtered = hands.filter((h) => (h.handedness || '').toLowerCase() === pref);
      if (filtered.length) candidates = filtered;
    }
    const scored = candidates
      .map((h) => ({ h, scale: handScale(h.landmarks) }))
      .sort((a, b) => b.scale - a.scale);
    const primary = scored[0].h;
    const secondary = hands.find((h) => h !== primary) || null;
    return { primary, secondary };
  }

  seedSampleObjects() {
    if (this.objectManager.all().length > 0) return;
    const n = this.config.objects.sampleObjects;
    const palette = this.config.drawing.palette;
    for (let i = 0; i < n; i++) {
      const desc = sampleObject(i, palette[i % palette.length]);
      const angle = (i / n) * Math.PI * 2;
      const obj = this.objectManager.add({
        kind: desc.geometry,
        geometry: desc.geometry,
        color: desc.color,
        size: desc.size,
        position: {
          x: Math.cos(angle) * 2.4,
          y: 0.4 + (i % 2) * 0.7,
          z: Math.sin(angle) * 1.6,
        },
      });
      this.objectViews.ensure(obj);
      this.objectViews.pop(obj.id);
    }
  }

  clearCanvas() {
    if (this.drawing) this.finishStroke();
    this.strokeManager.clear();
    this._syncHistory();
    this.ui.toast('Canvas cleared');
  }

  resetAll() {
    this.clearCanvas();
    this.objectManager.clear();
    this.objectViews.clear();
    this.recognizer.reset();
    this.twoHand.reset();
    this.effects.trailClear();
    this.effects.clearParticles();
    this.drawing = false;
    this.paused = false;
    this._palmHeld = 0;
    this._palmFired = false;
    this.ui.toast('Everything reset');
  }

  applySensitivity(v) {
    // v in [-3, +3]: shifts the One Euro cutoff and the pinch thresholds.
    const s = this.config.tracking.smoothing;
    const g = this.config.gestures;
    s.minCutoff = Math.max(0.4, 1.5 + v * 0.5);
    s.beta = Math.max(0.05, 0.6 + v * 0.2);
    g.pinchOn = Math.min(0.6, Math.max(0.25, 0.42 - v * 0.03));
    g.pinchOff = Math.min(0.8, Math.max(0.35, 0.6 - v * 0.04));
    this.recognizer.cursorFilter = new (this.recognizer.cursorFilter.constructor)(s);
  }

  applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    const base = cloneConfig();
    this.config.tracking.smoothing = deepMerge(base.tracking.smoothing, preset.tracking?.smoothing || {});
    this.config.gestures = deepMerge(base.gestures, preset.gestures || {});
    this.recognizer.cursorFilter = new (this.recognizer.cursorFilter.constructor)(this.config.tracking.smoothing);
    this.ui.setSensitivityLabel(0);
    this.ui.toast(`${name[0].toUpperCase()}${name.slice(1)} sensitivity`);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.dom.scene.parentElement?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  }

  /** Save a PNG of the current scene + ink. */
  capture() {
    try {
      const scene = this.sceneView.renderer.domElement;
      const out = document.createElement('canvas');
      out.width = scene.width;
      out.height = scene.height;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#05060f';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(scene, 0, 0, out.width, out.height);
      ctx.drawImage(this.strokeRenderer.canvas, 0, 0, out.width, out.height);
      const link = document.createElement('a');
      link.download = `gestureverse-${Date.now()}.png`;
      link.href = out.toDataURL('image/png');
      link.click();
      this.ui.toast('Snapshot saved', 'good');
    } catch (err) {
      this.ui.showError(`Could not save the snapshot: ${err.message}`);
    }
  }

  _syncHistory() {
    this.ui.setHistory(this.strokeManager.canUndo(), this.strokeManager.canRedo());
  }

  updateHud(res, primary, two) {
    this.ui.setFps(this.latestStats.fps || 0);
    this.ui.setTracking(primary ? 'Hand detected' : 'Show your hand', !!primary);
    this.ui.setHand(primary ? primary.handedness || '—' : '—');
    this.ui.setGesture(this.paused ? 'Paused' : GESTURE_LABEL[res.state] || '—');
    const held = this.objectManager.held;
    if (held) {
      this.ui.setObject(`${shapeLabel(held.kind)} · held · scale ${held.scale.toFixed(2)}`);
    } else {
      const hovered = this.objectManager.all().find((o) => o.selectable);
      this.ui.setObject(hovered ? `${shapeLabel(hovered.kind)} · ready to grab` : 'None selected');
    }
    this.ui.setHistory(this.strokeManager.canUndo(), this.strokeManager.canRedo());
  }

  dispose() {
    this.tracker.dispose();
    this.sceneView.dispose();
  }
}

/* ------------------------------------------------------------------ boot */

export async function boot() {
  const app = new GestureVerse();
  window.gestureverse = app; // handy for debugging and for the tests/docs
  await app.init();
  return app;
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    boot().catch((err) => {
      console.error(err);
      const banner = document.getElementById('error-text');
      if (banner) banner.textContent = err.message;
      document.getElementById('error-banner')?.classList.add('show');
    });
  });
}

export { MODE, GEOMETRY };
