/**
 * All DOM wiring lives here so nothing else in the app touches the document.
 */

import { AppStateName } from '../gestures/states.js';
import { SHAPES } from '../objects/shapes.js';

const STATE_LABEL = {
  [AppStateName.IDLE]: 'Idle',
  [AppStateName.DRAW]: 'Drawing',
  [AppStateName.HOVER]: 'Hovering',
  [AppStateName.GRAB]: 'Grabbing',
  [AppStateName.MOVE]: 'Moving',
  [AppStateName.TWO_HAND]: 'Two-hand',
  [AppStateName.RESIZE]: 'Resizing',
  [AppStateName.ROTATE]: 'Rotating',
  [AppStateName.DELETE]: 'Delete',
  [AppStateName.PLACE]: 'Placing',
};

const BRUSHES = [
  { label: 'Thin', width: 0.011 },
  { label: 'Medium', width: 0.019 },
  { label: 'Bold', width: 0.032 },
];

export class UI {
  constructor(config, handlers) {
    this.config = config;
    this.handlers = handlers;
    this.brush = { color: config.colors[0], width: BRUSHES[1].width };
    this.mode = 'draw';
    this.stamp = SHAPES[0].id;
    this.eraser = false;
    this.toastTimer = null;

    this.el = {
      start: document.getElementById('start-screen'),
      startBtn: document.getElementById('btn-start'),
      startError: document.getElementById('start-error'),
      palette: document.getElementById('palette'),
      brushes: document.getElementById('brushes'),
      shapes: document.getElementById('shapes'),
      shapesSection: document.getElementById('shapes-section'),
      brushSection: document.getElementById('brush-section'),
      modes: Array.from(document.querySelectorAll('[data-mode]')),
      stateBadge: document.getElementById('state-badge'),
      pillTracking: document.getElementById('pill-tracking'),
      pillHands: document.getElementById('pill-hands'),
      pillFps: document.getElementById('pill-fps'),
      btnUndo: document.getElementById('btn-undo'),
      btnRedo: document.getElementById('btn-redo'),
      btnClear: document.getElementById('btn-clear'),
      btnReset: document.getElementById('btn-reset'),
      btnGuide: document.getElementById('btn-guide'),
      btnEraser: document.getElementById('btn-eraser'),
      btnTracking: document.getElementById('btn-tracking'),
      guide: document.getElementById('guide'),
      guideClose: document.getElementById('guide-close'),
      toast: document.getElementById('toast'),
    };

    this.buildPalette();
    this.buildBrushes();
    this.buildShapes();
    this.bind();
    this.applyModeSections();
  }

  buildPalette() {
    this.el.palette.innerHTML = '';
    for (const color of this.config.colors) {
      const btn = document.createElement('button');
      btn.className = 'swatch';
      btn.style.setProperty('--swatch', color);
      btn.setAttribute('aria-label', `Colour ${color}`);
      if (color === this.brush.color) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.brush.color = color;
        for (const s of this.el.palette.children) s.classList.remove('active');
        btn.classList.add('active');
        this.handlers.onBrush?.({ ...this.brush });
      });
      this.el.palette.appendChild(btn);
    }
  }

  buildBrushes() {
    this.el.brushes.innerHTML = '';
    for (const b of BRUSHES) {
      const btn = document.createElement('button');
      btn.className = 'brush';
      btn.textContent = b.label;
      if (b.width === this.brush.width) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.brush.width = b.width;
        for (const s of this.el.brushes.children) s.classList.remove('active');
        btn.classList.add('active');
        this.handlers.onBrush?.({ ...this.brush });
      });
      this.el.brushes.appendChild(btn);
    }
  }

  buildShapes() {
    this.el.shapes.innerHTML = '';
    for (const shape of SHAPES) {
      const btn = document.createElement('button');
      btn.className = 'shape-btn';
      btn.textContent = shape.label;
      btn.dataset.shape = shape.id;
      if (shape.id === this.stamp) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.stamp = shape.id;
        for (const b of this.el.shapes.children) b.classList.remove('active');
        btn.classList.add('active');
        this.handlers.onShape?.(shape.id);
        this.toast(`${shape.label} selected — point to place it, pinch to drop it`);
      });
      this.el.shapes.appendChild(btn);
    }
  }

  /** Shapes mode swaps the brush controls for the primitive palette. */
  applyModeSections() {
    const shapeMode = this.mode === 'shape';
    if (this.el.shapesSection) this.el.shapesSection.classList.toggle('is-hidden', !shapeMode);
    if (this.el.brushSection) this.el.brushSection.classList.toggle('is-hidden', shapeMode);
  }

  bind() {
    this.el.startBtn.addEventListener('click', () => this.handlers.onStart?.());

    for (const btn of this.el.modes) {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    }

    this.el.btnEraser.addEventListener('click', () => {
      this.eraser = !this.eraser;
      this.el.btnEraser.classList.toggle('active', this.eraser);
      this.handlers.onEraser?.(this.eraser);
      this.toast(this.eraser ? 'Eraser on — point at a drawing to remove it' : 'Eraser off');
    });

    this.el.btnUndo.addEventListener('click', () => this.handlers.onUndo?.());
    this.el.btnRedo.addEventListener('click', () => this.handlers.onRedo?.());
    this.el.btnClear.addEventListener('click', () => this.handlers.onClear?.());
    this.el.btnReset.addEventListener('click', () => this.handlers.onResetView?.());
    this.el.btnGuide.addEventListener('click', () => this.toggleGuide());
    this.el.guideClose.addEventListener('click', () => this.toggleGuide(false));
    this.el.btnTracking.addEventListener('click', () => this.handlers.onToggleTracking?.());

    window.addEventListener('keydown', (e) => {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      switch (e.key.toLowerCase()) {
        case 'escape':
          this.handlers.onEscape?.();
          break;
        case 'u':
          this.handlers.onUndo?.();
          break;
        case 'r':
          this.handlers.onRedo?.();
          break;
        case 'c':
          this.handlers.onClear?.();
          break;
        case 'g':
          this.toggleGuide();
          break;
        case 'e':
          this.el.btnEraser.click();
          break;
        case '1':
          this.setMode('draw');
          break;
        case '2':
          this.setMode('shape');
          break;
        case '3':
          this.setMode('play');
          break;
        default:
          break;
      }
    });
  }

  setMode(mode) {
    this.mode = mode;
    for (const btn of this.el.modes) btn.classList.toggle('active', btn.dataset.mode === mode);
    this.applyModeSections();
    this.handlers.onMode?.(mode);
    if (mode === 'draw') this.toast('Draw mode — point to draw');
    else if (mode === 'shape') this.toast('Shapes mode — pick a shape, pinch to place it');
    else this.toast('Play mode — point to select, pinch to grab');
  }

  toggleGuide(force) {
    const show = force === undefined ? !this.el.guide.classList.contains('open') : force;
    this.el.guide.classList.toggle('open', show);
  }

  toast(message) {
    const el = this.el.toast;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  hideStart() {
    this.el.start.classList.add('hidden');
  }

  showStartError(message) {
    this.el.startError.textContent = message;
    this.el.startError.classList.add('show');
    this.el.startBtn.disabled = false;
    this.el.startBtn.textContent = 'Try again';
  }

  setTracking(on) {
    this.el.btnTracking.classList.toggle('active', on);
    this.el.btnTracking.textContent = on ? 'Tracking on' : 'Tracking off';
    this.el.pillTracking.textContent = on ? 'Tracking' : 'Paused';
    this.el.pillTracking.classList.toggle('good', on);
    this.el.pillTracking.classList.toggle('bad', !on);
  }

  update({ appState, handCount, fps, canUndo, canRedo }) {
    this.el.stateBadge.textContent = STATE_LABEL[appState] || 'Idle';
    this.el.stateBadge.dataset.state = appState;
    this.el.pillHands.textContent = `${handCount} hand${handCount === 1 ? '' : 's'}`;
    this.el.pillHands.classList.toggle('good', handCount > 0);
    this.el.pillHands.classList.toggle('bad', handCount === 0);
    this.el.pillFps.textContent = `${Math.round(fps)} fps`;
    this.el.btnUndo.disabled = !canUndo;
    this.el.btnRedo.disabled = !canRedo;
  }
}
