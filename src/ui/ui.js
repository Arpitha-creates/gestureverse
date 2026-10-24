/**
 * GestureVerse - DOM UI.
 *
 * Owns every element outside the two canvases: mode switcher, drawing tools,
 * object panel, HUD, onboarding, calibration and error surfaces. It holds no
 * application state - it renders what main.js hands it and forwards user
 * intent back through callbacks.
 */

export class UI {
  constructor(config) {
    this.config = config;
    this.callbacks = {};
    this.el = {
      app: document.getElementById('app'),
      video: document.getElementById('camera'),
      scene: document.getElementById('scene'),
      overlay: document.getElementById('overlay'),
      hudMode: document.getElementById('hud-mode'),
      hudTracking: document.getElementById('hud-tracking'),
      hudFps: document.getElementById('hud-fps'),
      hudGesture: document.getElementById('hud-gesture'),
      hudObject: document.getElementById('hud-object'),
      hudHand: document.getElementById('hud-hand'),
      palette: document.getElementById('palette'),
      brushes: document.getElementById('brushes'),
      tools: document.getElementById('tools'),
      modeButtons: Array.from(document.querySelectorAll('[data-mode]')),
      toast: document.getElementById('toast'),
      error: document.getElementById('error-banner'),
      errorText: document.getElementById('error-text'),
      onboarding: document.getElementById('onboarding'),
      guide: document.getElementById('guide'),
      guideToggle: document.getElementById('guide-toggle'),
      sensitivity: document.getElementById('sensitivity'),
      sensitivityLabel: document.getElementById('sensitivity-label'),
      throwToggle: document.getElementById('throw-toggle'),
      cameraToggle: document.getElementById('camera-toggle'),
      handPref: document.getElementById('hand-pref'),
      undo: document.getElementById('btn-undo'),
      redo: document.getElementById('btn-redo'),
      clear: document.getElementById('btn-clear'),
      save: document.getElementById('btn-save'),
      reset: document.getElementById('btn-reset'),
      fullscreen: document.getElementById('btn-fullscreen'),
      panelToggle: document.getElementById('panel-toggle'),
      leftPanel: document.getElementById('left-panel'),
      rightPanel: document.getElementById('right-panel'),
      presetButtons: Array.from(document.querySelectorAll('[data-preset]')),
    };
    this._buildPalette();
    this._buildBrushes();
    this._buildTools();
    this._wire();
    this._toastTimer = null;
  }

  on(name, fn) {
    this.callbacks[name] = fn;
  }

  _fire(name, ...args) {
    if (this.callbacks[name]) this.callbacks[name](...args);
  }

  _buildPalette() {
    const { palette, defaultColor } = this.config.drawing;
    this.el.palette.innerHTML = '';
    palette.forEach((color, i) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.setProperty('--c', color);
      b.title = color;
      b.setAttribute('aria-label', `Colour ${color}`);
      if (i === 0) b.classList.add('active');
      b.addEventListener('click', () => {
        this.el.palette.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
        b.classList.add('active');
        this._fire('color', color);
      });
      this.el.palette.appendChild(b);
    });
    this.selectedColor = defaultColor;
  }

  _buildBrushes() {
    const { brushSizes, defaultWidth } = this.config.drawing;
    this.el.brushes.innerHTML = '';
    brushSizes.forEach((size) => {
      const b = document.createElement('button');
      b.className = 'brush';
      b.title = `${size}px`;
      b.setAttribute('aria-label', `Brush ${size} pixels`);
      const dot = document.createElement('span');
      dot.style.width = `${Math.min(size, 18)}px`;
      dot.style.height = `${Math.min(size, 18)}px`;
      b.appendChild(dot);
      if (size === defaultWidth) b.classList.add('active');
      b.addEventListener('click', () => {
        this.el.brushes.querySelectorAll('.brush').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this._fire('brush', size);
      });
      this.el.brushes.appendChild(b);
    });
    this.selectedWidth = defaultWidth;
  }

  _buildTools() {
    const tools = [
      ['freehand', 'Freehand'],
      ['line', 'Line'],
      ['rect', 'Rectangle'],
      ['square', 'Square'],
      ['circle', 'Circle'],
      ['ellipse', 'Ellipse'],
      ['triangle', 'Triangle'],
      ['star', 'Star'],
    ];
    this.el.tools.innerHTML = '';
    tools.forEach(([id, label], i) => {
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.tool = id;
      b.textContent = label;
      if (i === 0) b.classList.add('active');
      b.addEventListener('click', () => {
        this.el.tools.querySelectorAll('.tool').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this._fire('tool', id);
      });
      this.el.tools.appendChild(b);
    });
    this.selectedTool = 'freehand';
  }

  _wire() {
    this.el.modeButtons.forEach((b) =>
      b.addEventListener('click', () => this._fire('mode', b.dataset.mode)),
    );
    this.el.undo.addEventListener('click', () => this._fire('undo'));
    this.el.redo.addEventListener('click', () => this._fire('redo'));
    this.el.clear.addEventListener('click', () => this._fire('clear'));
    this.el.save.addEventListener('click', () => this._fire('save'));
    this.el.reset.addEventListener('click', () => this._fire('reset'));
    this.el.fullscreen.addEventListener('click', () => this._fire('fullscreen'));
    this.el.guideToggle.addEventListener('click', () => this.toggleGuide());
    this.el.panelToggle.addEventListener('click', () => this.togglePanels());
    this.el.cameraToggle.addEventListener('change', () => this._fire('camera', this.el.cameraToggle.checked));
    this.el.throwToggle.addEventListener('change', () => this._fire('throw', this.el.throwToggle.checked));
    this.el.handPref.addEventListener('change', () => this._fire('hand', this.el.handPref.value));
    this.el.sensitivity.addEventListener('input', () => {
      const v = Number(this.el.sensitivity.value);
      this.el.sensitivityLabel.textContent = `${v > 0 ? '+' : ''}${v}`;
      this._fire('sensitivity', v);
    });
    this.el.presetButtons.forEach((b) =>
      b.addEventListener('click', () => {
        this.el.presetButtons.forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this._fire('preset', b.dataset.preset);
      }),
    );
    const startBtn = document.getElementById('btn-start');
    if (startBtn) startBtn.addEventListener('click', () => this._fire('start'));
    const skipBtn = document.getElementById('btn-skip');
    if (skipBtn) skipBtn.addEventListener('click', () => this._fire('start'));
    const retryBtn = document.getElementById('btn-retry');
    if (retryBtn) retryBtn.addEventListener('click', () => this._fire('retry'));
  }

  setMode(mode) {
    this.el.modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    this.el.hudMode.textContent = { draw: 'Air Drawing', play: 'Object Playground', creative: 'Creative Playground' }[mode] || mode;
    document.body.dataset.mode = mode;
  }

  setHand(h) {
    this.el.hudHand.textContent = h || '—';
  }

  setTracking(text, ok) {
    this.el.hudTracking.textContent = text;
    this.el.hudTracking.classList.toggle('ok', !!ok);
    this.el.hudTracking.classList.toggle('bad', !ok);
  }

  setFps(fps) {
    this.el.hudFps.textContent = `${fps} FPS`;
  }

  setGesture(name) {
    this.el.hudGesture.textContent = name || '—';
  }

  setObject(info) {
    this.el.hudObject.textContent = info || 'None selected';
  }

  setHistory(canUndo, canRedo) {
    this.el.undo.disabled = !canUndo;
    this.el.redo.disabled = !canRedo;
  }

  toast(message, kind = 'info') {
    const t = this.el.toast;
    t.textContent = message;
    t.className = `toast show ${kind}`;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      t.className = 'toast';
    }, 2200);
  }

  showError(message) {
    this.el.errorText.textContent = message;
    this.el.error.classList.add('show');
  }

  hideError() {
    this.el.error.classList.remove('show');
  }

  showOnboarding() {
    this.el.onboarding.classList.add('show');
  }

  hideOnboarding() {
    this.el.onboarding.classList.remove('show');
  }

  toggleGuide(force) {
    const show = force === undefined ? !this.el.guide.classList.contains('show') : force;
    this.el.guide.classList.toggle('show', show);
  }

  togglePanels(force) {
    const hide = force === undefined ? !document.body.classList.contains('panels-hidden') : force;
    document.body.classList.toggle('panels-hidden', hide);
  }

  setCameraVisible(visible) {
    this.el.video.style.opacity = visible ? '0.34' : '0';
    this.el.cameraToggle.checked = visible;
  }

  setThrowEnabled(on) {
    this.el.throwToggle.checked = on;
  }

  setSensitivityLabel(v) {
    this.el.sensitivity.value = String(v);
    this.el.sensitivityLabel.textContent = `${v > 0 ? '+' : ''}${v}`;
  }
}
