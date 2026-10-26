/**
 * GestureVerse — application wiring.
 *
 * The frame loop is the only thing that runs on every animation frame. It asks
 * the tracker for hands, pushes them through the gesture layer, lets the
 * interaction brain mutate the world, and then renders. Nothing else schedules
 * work, so there is exactly one place to look when something misbehaves.
 */

import { CONFIG } from './config.js';
import { clamp, OneEuroPoint } from './core/util.js';
import { HandTracker } from './tracking/handTracker.js';
import { analyzeHand } from './gestures/handPose.js';
import { HandState } from './gestures/handState.js';
import { Interaction } from './gestures/interaction.js';
import { AppStateName, HandStateName } from './gestures/states.js';
import { DrawingWorld } from './objects/world.js';
import { SceneView } from './render/scene.js';
import { DrawingView } from './render/drawingView.js';
import { Overlay } from './render/overlay.js';
import { UI } from './ui/ui.js';
import { SHAPES } from './objects/shapes.js';

class GestureVerse {
  constructor() {
    this.config = CONFIG;
    this.video = document.getElementById('camera');

    this.scene = new SceneView(document.getElementById('scene'));
    this.overlay = new Overlay(document.getElementById('overlay'), CONFIG);
    this.world = new DrawingWorld(CONFIG);
    this.view = new DrawingView(this.scene);
    this.interaction = new Interaction(CONFIG, this.world);
    this.tracker = new HandTracker(CONFIG);

    this.slots = [0, 1].map((index) => ({
      index,
      state: new HandState(CONFIG),
      pose: null,
      result: { state: HandStateName.LOST, previous: HandStateName.LOST, changed: false, pose: null, holdMs: 0 },
      // Per-hand smoothing. The pen tip gets the gentler filter; the pinch
      // point gets a snappier one so grabbing never feels laggy.
      tipFilter: new OneEuroPoint(CONFIG.smoothing.pen),
      pinchFilter: new OneEuroPoint(CONFIG.smoothing.grab),
    }));

    this.tracking = false;
    this.mode = 'draw';
    this.stamp = SHAPES[0].id;
    this.brush = { color: CONFIG.colors[0], width: 0.019 };
    this.eraser = false;
    this.fps = 60;
    this.handCount = 0;
    this.last = performance.now();
    this.info = { appState: AppStateName.IDLE };
    this.hudAccumulator = 0;

    this.ui = new UI(CONFIG, {
      onStart: () => this.start(),
      onMode: (mode) => {
        this.mode = mode;
      },
      onBrush: (brush) => {
        this.brush = { ...brush };
      },
      onShape: (id) => {
        this.stamp = id;
      },
      onEraser: (on) => {
        this.eraser = on;
        if (on) this.interaction.forceRelease();
      },
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onClear: () => this.clearAll(),
      onResetView: () => this.resetView(),
      onToggleTracking: () => this.toggleTracking(),
      onEscape: () => {
        this.interaction.forceRelease();
        this.ui.toast('Released');
      },
    });

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('visibilitychange', () => {
      if (document.hidden) this.interaction.forceRelease();
    });

    this.ui.setTracking(false);
    requestAnimationFrame(this.frame);
  }

  /* --------------------------------------------------------------- setup */

  onResize() {
    this.scene.resize();
    this.overlay.resize();
  }

  async start() {
    const btn = this.ui.el.startBtn;
    btn.disabled = true;
    btn.textContent = 'Starting camera…';
    try {
      await this.tracker.start(this.video);
      this.tracking = true;
      this.ui.hideStart();
      this.ui.setTracking(true);
      this.ui.toast('Camera ready — raise your index finger to draw');
    } catch (err) {
      this.ui.showStartError(err && err.message ? err.message : String(err));
    }
  }

  toggleTracking() {
    if (!this.tracker.ready) {
      this.ui.toast('Start the camera first');
      return;
    }
    this.tracking = !this.tracking;
    if (!this.tracking) {
      this.interaction.forceRelease();
      const now = performance.now();
      for (const slot of this.slots) {
        slot.pose = null;
        slot.result = slot.state.update(null, now);
      }
      this.handCount = 0;
    }
    this.ui.setTracking(this.tracking);
    this.ui.toast(this.tracking ? 'Hand tracking on' : 'Hand tracking paused');
  }

  /* ----------------------------------------------------------- the loop */

  frame = (now) => {
    requestAnimationFrame(this.frame);

    const dt = clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    if (dt > 0.0001) this.fps = this.fps * 0.92 + (1 / dt) * 0.08;

    if (this.tracking) this.stepHands(now, dt);

    this.view.sync(this.world);
    this.updateGhost();
    this.scene.render();
    this.overlay.draw(this.buildFrame());

    this.hudAccumulator += dt;
    if (this.hudAccumulator > 0.12) {
      this.hudAccumulator = 0;
      this.ui.update({
        appState: this.info.appState,
        handCount: this.handCount,
        fps: this.fps,
        canUndo: this.world.history.canUndo,
        canRedo: this.world.history.canRedo,
      });
    }
  };

  /**
   * In Shapes mode a translucent preview of the chosen primitive follows the
   * hand, so what gets placed is never a surprise.
   */
  updateGhost() {
    const show = this.mode === 'shape' && this.stamp && !this.interaction.carried;
    if (!show) {
      this.view.setGhost(null);
      return;
    }
    const hand = this.slots.find((s) => s.pose && s.result.state !== HandStateName.LOST);
    if (!hand) {
      this.view.setGhost(null);
      return;
    }
    const p = this.scene.toWorld(hand.pose.pinch, 0);
    this.view.setGhost(this.stamp, this.brush.color, p);
  }

  stepHands(now, dt) {
    const raw = this.tracker.detect(now);
    const poses = [];
    for (const hand of raw) {
      const pose = analyzeHand(hand.landmarks, this.config);
      if (pose) {
        pose.handedness = hand.handedness;
        poses.push(pose);
      }
    }

    this.assignSlots(poses);
    this.smoothCursors(now);

    for (const slot of this.slots) {
      slot.result = slot.state.update(slot.pose, now);
    }
    this.handCount = this.slots.filter((s) => s.pose).length;

    this.info = this.interaction.update({
      hands: this.slots,
      now,
      dt,
      mode: this.mode,
      brush: this.brush,
      eraser: this.eraser,
      stamp: this.stamp,
      toWorld: (point, depth) => this.scene.toWorld(point, depth),
      project: (v) => this.scene.project(v),
      viewport: { width: this.scene.width, height: this.scene.height },
    });
  }

  /**
   * One Euro filtering on the fingertip and pinch points.
   *
   * Landmarks are noisy enough that an unfiltered pen draws visibly shaky
   * lines; this is the single biggest quality difference in the drawing feel.
   * Filters are reset when a hand disappears so a re-appearing hand snaps to
   * where it actually is instead of sliding in from wherever it left.
   */
  smoothCursors(now) {
    const t = now / 1000;
    for (const slot of this.slots) {
      if (!slot.pose) {
        slot.tipFilter.reset();
        slot.pinchFilter.reset();
        continue;
      }
      slot.pose.tip = slot.tipFilter.filter(slot.pose.tip, t);
      slot.pose.pinch = slot.pinchFilter.filter(slot.pose.pinch, t);
    }
  }

  /**
   * MediaPipe returns hands in no guaranteed order. Sorting by x alone makes
   * slots swap whenever hands cross, which would reset a gesture state machine
   * mid-grab. Matching to the previous frame's positions keeps a hand on the
   * same slot as long as it is plausibly the same hand.
   */
  assignSlots(poses) {
    const assigned = [null, null];
    const used = new Set();

    for (let s = 0; s < 2; s++) {
      const prev = this.slots[s].pose && this.slots[s].pose.tip;
      if (!prev) continue;
      let best = -1;
      let bestDist = 0.3;
      for (let i = 0; i < poses.length; i++) {
        if (used.has(i)) continue;
        const d = Math.hypot(poses[i].tip.x - prev.x, poses[i].tip.y - prev.y);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      if (best >= 0) {
        assigned[s] = poses[best];
        used.add(best);
      }
    }

    const leftovers = poses.filter((_, i) => !used.has(i));
    leftovers.sort((a, b) => a.tip.x - b.tip.x);
    for (let s = 0; s < 2 && leftovers.length; s++) {
      if (!assigned[s]) assigned[s] = leftovers.shift();
    }

    for (let s = 0; s < 2; s++) this.slots[s].pose = assigned[s];
  }

  /* ------------------------------------------------------- overlay input */

  ringFor(drawing) {
    const centre = this.scene.project(drawing.position);
    const edge = this.scene.project({
      x: drawing.position.x + drawing.radius * drawing.scale,
      y: drawing.position.y,
      z: drawing.position.z,
    });
    const radius = edge ? Math.hypot(edge.x - centre.x, edge.y - centre.y) : 0;
    return { x: centre.x, y: centre.y, radius: Math.max(22, radius + 8) };
  }

  buildFrame() {
    const info = this.info;
    const frame = {
      hands: this.slots.map((s) => ({ pose: s.pose, result: s.result })),
      cursor: info.cursor,
      pinching: this.slots.some((s) => s.result && s.result.state === HandStateName.PINCH),
      stroke: info.stroke,
      brushColor: this.brush.color,
      deleteProgress: info.deleteProgress || 0,
      palmProgress: info.palmProgress || 0,
    };

    if (info.hover) frame.hoverRing = this.ringFor(info.hover);
    if (info.deleteTarget) frame.deleteRing = this.ringFor(info.deleteTarget);

    const palmHand = this.slots.find((s) => s.result && s.result.state === HandStateName.PALM);
    if (palmHand && palmHand.pose) {
      const p = this.overlay.px(palmHand.pose.palm);
      frame.palmRing = { x: p.x, y: p.y, radius: 34 };
    }

    if (info.twoHand) {
      const a = this.slots.find((s) => s.index === info.twoHand.aIndex);
      const b = this.slots.find((s) => s.index === info.twoHand.bIndex);
      if (a && a.pose && b && b.pose) {
        frame.twoHandPoints = [a.pose.pinch, b.pose.pinch];
        const ind = info.indicators || {};
        const parts = [];
        if (ind.spanRatio) parts.push(`${ind.spanRatio.toFixed(2)}×`);
        if (ind.rotDelta) parts.push(`${Math.round((ind.rotDelta * 180) / Math.PI)}°`);
        frame.twoHandLabel = parts.join('   ');
      }
    }

    return frame;
  }

  /* ------------------------------------------------------------- actions */

  undo() {
    this.interaction.forceRelease();
    if (this.world.undo()) this.ui.toast('Undone');
    else this.ui.toast('Nothing to undo');
  }

  redo() {
    this.interaction.forceRelease();
    if (this.world.redo()) this.ui.toast('Redone');
    else this.ui.toast('Nothing to redo');
  }

  clearAll() {
    this.interaction.forceRelease();
    if (!this.world.count) {
      this.ui.toast('Canvas is already empty');
      return;
    }
    this.world.mark();
    this.world.clear();
    this.ui.toast('Canvas cleared — press U to undo');
  }

  resetView() {
    this.scene.camera.position.set(0, 1.3, 9.2);
    this.scene.camera.lookAt(0, -0.25, 0);
    this.scene.camera.updateMatrixWorld();
    this.ui.toast('View reset');
  }
}

function boot() {
  try {
    window.gestureverse = new GestureVerse();
  } catch (err) {
    const el = document.getElementById('start-error');
    if (el) {
      el.textContent = `GestureVerse could not start: ${err.message}. WebGL may be disabled in this browser.`;
      el.classList.add('show');
    }
    throw err;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
