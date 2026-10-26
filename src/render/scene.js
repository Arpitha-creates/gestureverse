/**
 * Thin Three.js wrapper: camera, lights, floor, and the two coordinate
 * conversions the rest of the app depends on.
 *
 * The conversions are done by unprojection rather than trigonometry, so they
 * stay exact no matter how the camera is angled or how the window is resized.
 */

import * as THREE from 'three';

export class SceneView {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05060f, 0.028);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);
    this.camera.position.set(0, 1.3, 9.2);
    this.camera.lookAt(0, -0.25, 0);

    this.addLights();
    this.addFloor();

    this._v = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this.width = 1;
    this.height = 1;
    this.resize();
  }

  addLights() {
    this.scene.add(new THREE.AmbientLight(0x8899ff, 0.55));

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3, 6, 7);
    this.scene.add(key);

    const rimCyan = new THREE.PointLight(0x38f0ff, 60, 40, 2);
    rimCyan.position.set(-6, 3, 4);
    this.scene.add(rimCyan);

    const rimMagenta = new THREE.PointLight(0xff3df0, 55, 40, 2);
    rimMagenta.position.set(6, -2, 3);
    this.scene.add(rimMagenta);
  }

  addFloor() {
    const grid = new THREE.GridHelper(40, 40, 0x1d3a5c, 0x101c2e);
    grid.position.y = -3.2;
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    this.scene.add(grid);
    this.grid = grid;

    const horizon = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshBasicMaterial({ color: 0x070b16, transparent: true, opacity: 0.85 }),
    );
    horizon.rotation.x = -Math.PI / 2;
    horizon.position.y = -3.21;
    this.scene.add(horizon);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Normalised screen point (0..1, already mirrored) to a world position on the
   * plane z = depth.
   */
  toWorld(point, depth = 0) {
    this._v.set(point.x * 2 - 1, -(point.y * 2 - 1), 0.5);
    this._v.unproject(this.camera);
    this._dir.copy(this._v).sub(this.camera.position).normalize();
    const denom = this._dir.z;
    if (Math.abs(denom) < 1e-6) return { x: 0, y: 0, z: depth };
    const t = (depth - this.camera.position.z) / denom;
    return {
      x: this.camera.position.x + this._dir.x * t,
      y: this.camera.position.y + this._dir.y * t,
      z: depth,
    };
  }

  /** World position to canvas pixels. */
  project(pos) {
    this._v.set(pos.x, pos.y, pos.z || 0).project(this.camera);
    return {
      x: (this._v.x * 0.5 + 0.5) * this.width,
      y: (-this._v.y * 0.5 + 0.5) * this.height,
    };
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
