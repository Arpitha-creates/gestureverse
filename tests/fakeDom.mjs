/**
 * A deliberately small fake DOM, just enough for GestureVerse to boot under
 * Node. Element ids are read straight out of index.html so a renamed id in the
 * markup breaks this test rather than silently breaking the app.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class FakeClassList {
  constructor() {
    this.set = new Set();
  }
  add(...c) {
    c.forEach((x) => this.set.add(x));
  }
  remove(...c) {
    c.forEach((x) => this.set.delete(x));
  }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : force;
    if (on) this.set.add(c);
    else this.set.delete(c);
    return on;
  }
  contains(c) {
    return this.set.has(c);
  }
}

class FakeContext {
  constructor() {
    this.canvas = null;
  }
  setTransform() {}
  clearRect() {}
  save() {}
  restore() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  arc() {}
  arcTo() {}
  rect() {}
  ellipse() {}
  closePath() {}
  stroke() {}
  fill() {}
  fillRect() {}
  drawImage() {}
  quadraticCurveTo() {}
  fillText() {}
  measureText(text) {
    return { width: String(text).length * 7 };
  }
}

export class FakeElement {
  constructor(tag = 'div', id = '') {
    this.tagName = String(tag).toUpperCase();
    this.id = id;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.attributes = {};
    this.listeners = {};
    this.style = { setProperty() {}, removeProperty() {} };
    this.textContent = '';
    this.innerHTML = '';
    this.value = '0';
    this.checked = true;
    this.disabled = false;
    this.clientWidth = 1280;
    this.clientHeight = 720;
    this.width = 1280;
    this.height = 720;
    this.srcObject = null;
    this.readyState = 4;
    this.currentTime = 0;
    this._ctx = new FakeContext();
  }
  setAttribute(k, v) {
    this.attributes[k] = v;
  }
  getAttribute(k) {
    return this.attributes[k];
  }
  appendChild(c) {
    this.children.push(c);
    c.parentElement = this;
    return c;
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  }
  addEventListener(type, fn) {
    (this.listeners[type] || (this.listeners[type] = [])).push(fn);
  }
  removeEventListener() {}
  dispatch(type, ev = {}) {
    (this.listeners[type] || []).forEach((fn) => fn(ev));
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  getContext() {
    return this._ctx;
  }
  play() {
    return Promise.resolve();
  }
  requestFullscreen() {
    return Promise.resolve();
  }
}

/** Install a fake DOM on globalThis, driven by the real index.html ids. */
export function installFakeDom() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

  const byId = new Map();
  for (const id of ids) byId.set(id, new FakeElement('div', id));

  const body = new FakeElement('body', 'body');
  const appEl = byId.get('app') || new FakeElement('div', 'app');

  const makeButtons = (attr, values) =>
    values.map((v) => {
      const b = new FakeElement('button');
      b.dataset[attr] = v;
      return b;
    });

  const document = {
    body,
    documentElement: body,
    fullscreenElement: null,
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => new FakeElement(tag),
    querySelector: () => null,
    querySelectorAll: (sel) => {
      if (sel === '[data-mode]') return makeButtons('mode', ['draw', 'play', 'creative']);
      if (sel === '[data-preset]') return makeButtons('preset', ['relaxed', 'balanced', 'responsive']);
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
    exitFullscreen() {},
  };

  const clock = { t: 0 };
  const win = {
    document,
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    navigator: { mediaDevices: {} },
  };

  globalThis.document = document;
  globalThis.window = win;
  globalThis.navigator = win.navigator;
  globalThis.requestAnimationFrame = () => 0; // no auto-loop; the test drives frames
  globalThis.cancelAnimationFrame = () => {};
  globalThis.performance = { now: () => clock.t, timeOrigin: 0 };
  // Browsers expose these as bare globals, and main.js uses them that way.
  globalThis.ResizeObserver = win.ResizeObserver;

  return { document, window: win, clock, byId, appEl };
}
