/**
 * Stand-in for `three` used by the browser-free tests.
 *
 * Most exports are auto-stubs, but the classes the app actually inspects -
 * Color, materials, geometries, Object3D, Vector3, WebGLRenderer - are
 * implemented for real. That is deliberate: the bugs these tests guard against
 * live in *how* the app talks to Three.js (a CSS colour passed to setHex, a
 * render skipped before a canvas read-back, a shared geometry disposed twice),
 * and a pure auto-stub would happily swallow every one of them.
 */

import { stub } from './autoStub.mjs';

/* ------------------------------------------------------------------ math */

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  setScalar(s) {
    this.x = s;
    this.y = s;
    this.z = s;
    return this;
  }
  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
  clone() {
    return new Vector3(this.x, this.y, this.z);
  }
  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }
  multiplyScalar(s) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }
  divideScalar(s) {
    return this.multiplyScalar(s === 0 ? 1 : 1 / s);
  }
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
  get isVector3() {
    return true;
  }
}

/** Minimal but faithful THREE.Color. */
export class Color {
  constructor(value) {
    this.r = 1;
    this.g = 1;
    this.b = 1;
    if (value !== undefined && value !== null) this.set(value);
  }

  set(value) {
    if (value instanceof Color) return this.copy(value);
    if (typeof value === 'number') return this.setHex(value);
    if (typeof value === 'string') return this.setStyle(value);
    if (value && typeof value === 'object' && 'r' in value) return this.copy(value);
    return this;
  }

  copy(c) {
    this.r = c.r;
    this.g = c.g;
    this.b = c.b;
    return this;
  }

  /** Mirrors Three.js: bit-shifts the argument, so a string yields NaN. */
  setHex(hex) {
    const h = Math.floor(hex);
    this.r = ((h >> 16) & 255) / 255;
    this.g = ((h >> 8) & 255) / 255;
    this.b = (h & 255) / 255;
    return this;
  }

  /** Mirrors Three.js: parses CSS colour strings. */
  setStyle(style) {
    const hex6 = /^#([0-9a-f]{6})$/i.exec(style);
    if (hex6) return this.setHex(parseInt(hex6[1], 16));
    const hex3 = /^#([0-9a-f]{3})$/i.exec(style);
    if (hex3) {
      const [a, b, c] = hex3[1];
      return this.setHex(parseInt(`${a}${a}${b}${b}${c}${c}`, 16));
    }
    const rgb = /^rgba?\(([^)]+)\)$/i.exec(style);
    if (rgb) {
      const p = rgb[1].split(',').map((s) => parseFloat(s.trim()));
      this.r = p[0] / 255;
      this.g = p[1] / 255;
      this.b = p[2] / 255;
      return this;
    }
    throw new Error(`Unsupported colour style: ${style}`);
  }

  getHex() {
    return (
      (Math.round(this.r * 255) << 16) ^
      (Math.round(this.g * 255) << 8) ^
      Math.round(this.b * 255)
    );
  }

  get isColor() {
    return true;
  }
  clone() {
    return new Color(this);
  }
}

/* ------------------------------------------------------------- materials */

class Material {
  constructor(opts = {}) {
    this.opts = opts;
    this.color = new Color(opts.color ?? 0xffffff);
    this.emissive = new Color(opts.emissive ?? 0x000000);
    this.emissiveIntensity = opts.emissiveIntensity ?? 1;
    this.opacity = opts.opacity ?? 1;
    this.transparent = !!opts.transparent;
    this.blending = opts.blending;
    this.depthWrite = opts.depthWrite !== false;
    this.size = opts.size;
    this.visible = true;
    this.disposed = false;
  }
  dispose() {
    this.disposed = true;
  }
}

export class MeshStandardMaterial extends Material {}
export class MeshBasicMaterial extends Material {}
export class PointsMaterial extends Material {}
export class LineBasicMaterial extends Material {}

/* ------------------------------------------------------------- geometry */

class Geometry {
  constructor() {
    this.disposed = false;
    this.scaled = null;
    this.attributes = {};
  }
  scale(x, y, z) {
    this.scaled = { x, y, z };
    return this;
  }
  center() {
    this.centered = true;
    return this;
  }
  rotateX() {
    return this;
  }
  dispose() {
    this.disposed = true;
  }
}

export class BufferGeometry extends Geometry {
  constructor() {
    super();
    this.drawRange = { start: 0, count: Infinity };
  }
  setAttribute(name, attr) {
    this.attributes[name] = attr;
    return this;
  }
  setDrawRange(start, count) {
    this.drawRange = { start, count };
    return this;
  }
}

export class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = Math.floor(array.length / itemSize);
    this.needsUpdate = false;
  }
}

export class BoxGeometry extends Geometry {}
export class SphereGeometry extends Geometry {}
export class ConeGeometry extends Geometry {}
export class CylinderGeometry extends Geometry {}
export class TorusGeometry extends Geometry {}
export class TorusKnotGeometry extends Geometry {}
export class OctahedronGeometry extends Geometry {}
export class ExtrudeGeometry extends Geometry {}
export class TubeGeometry extends Geometry {}
export class CircleGeometry extends Geometry {}
export class PlaneGeometry extends Geometry {}

export class Shape {
  constructor() {
    this.points = [];
  }
  moveTo(x, y) {
    this.points.push({ x, y });
    return this;
  }
  lineTo(x, y) {
    this.points.push({ x, y });
    return this;
  }
  closePath() {
    return this;
  }
}

export class CatmullRomCurve3 {
  constructor(points) {
    this.points = points;
  }
}

/* -------------------------------------------------------------- objects */

export class Object3D {
  constructor() {
    this.position = new Vector3();
    this.rotation = new Vector3();
    this.scale = new Vector3(1, 1, 1);
    this.children = [];
    this.parent = null;
    this.visible = true;
  }
  add(child) {
    this.children.push(child);
    child.parent = this;
    return this;
  }
  remove(child) {
    const i = this.children.indexOf(child);
    if (i !== -1) this.children.splice(i, 1);
    return this;
  }
}

export class Group extends Object3D {}

export class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry || stub('geometry');
    this.material = material || stub('material');
    this.castShadow = false;
    this.receiveShadow = false;
    this.frustumCulled = true;
  }
}

export class Points extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry || stub('geometry');
    this.material = material || stub('material');
    this.frustumCulled = true;
  }
}

export class Line extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry || stub('geometry');
    this.material = material || stub('material');
    this.frustumCulled = true;
  }
}

export class GridHelper extends Object3D {
  constructor() {
    super();
    this.material = new LineBasicMaterial({ transparent: true, opacity: 1 });
  }
}

export class Scene extends Object3D {
  constructor() {
    super();
    this.background = null;
    this.fog = null;
  }
}

export class PerspectiveCamera extends Object3D {
  constructor(fov = 50, aspect = 1, near = 0.1, far = 100) {
    super();
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
  }
  lookAt() {
    this.lookedAt = true;
    return this;
  }
  updateProjectionMatrix() {
    this.projectionUpdated = true;
  }
}

class Light extends Object3D {
  constructor(color, intensity) {
    super();
    this.color = new Color(color);
    this.intensity = intensity;
  }
}

export class AmbientLight extends Light {}

export class DirectionalLight extends Light {
  constructor(color, intensity) {
    super(color, intensity);
    this.castShadow = false;
    this.shadow = {
      mapSize: new Vector3(),
      camera: { near: 0.1, far: 100, left: -5, right: 5, top: 5, bottom: -5 },
    };
  }
}

export class PointLight extends Light {}

export class FogExp2 {
  constructor(color, density) {
    this.color = new Color(color);
    this.density = density;
  }
}

export class Clock {
  constructor() {
    this.elapsedTime = 0;
    this.running = false;
  }
  start() {
    this.oldTime = Date.now();
    this.elapsedTime = 0;
    this.running = true;
  }
  getDelta() {
    const now = Date.now();
    const d = Math.max(0, (now - (this.oldTime || now)) / 1000);
    this.oldTime = now;
    this.elapsedTime += d;
    return d;
  }
}

/* ------------------------------------------------------------ renderer */

export class WebGLRenderer {
  constructor(opts = {}) {
    this.opts = opts;
    this.domElement = opts.canvas || { width: 1280, height: 720 };
    this.shadowMap = { enabled: false, type: 0, autoUpdate: true, needsUpdate: false };
    this.renderCalls = 0;
    this.disposed = false;
  }
  setPixelRatio(v) {
    this.pixelRatio = v;
  }
  setSize(w, h) {
    this.width = w;
    this.height = h;
  }
  render() {
    this.renderCalls++;
  }
  dispose() {
    this.disposed = true;
  }
}

export const PCFSoftShadowMap = 2;
export const ACESFilmicToneMapping = 4;
export const DoubleSide = 2;
export const BackSide = 1;
export const FrontSide = 0;
export const AdditiveBlending = 2;
export const NormalBlending = 1;

export default stub('THREE');
