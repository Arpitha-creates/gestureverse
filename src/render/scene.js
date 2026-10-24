/**
 * GestureVerse - Three.js world.
 *
 * Owns the renderer, scene, camera, lighting, floor grid and the render loop.
 * Everything else (objects, effects) attaches to `scene` through this module.
 */

import * as THREE from 'three';

export class SceneView {
  constructor(config, canvas) {
    this.config = config;
    this.canvas = canvas;

    // Antialiasing costs real fragment time, and on a high-DPI display the
    // extra device pixels already hide the jaggies.
    const dpr = window.devicePixelRatio || 1;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: dpr <= 1.5,
      alpha: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, config.performance.pixelRatioCap),
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.scene.background = null; // the CSS gradient behind shows through
    this.scene.fog = new THREE.FogExp2(0x05060f, 0.035);

    const w = config.world;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.set(0, 0.6, 9);
    this.camera.lookAt(0, 0, 0);

    this._buildLights();
    this._buildFloor();

    this._clock = new THREE.Clock();
    this._updaters = [];
    this._running = false;
    this._rafId = null;
    this.onFrame = null;
    this.resize();
  }

  _buildLights() {
    const ambient = new THREE.AmbientLight(0x6b7cff, 0.55);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(4, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    this.scene.add(key);
    this.keyLight = key;

    const rim = new THREE.DirectionalLight(0x22d3ee, 0.9);
    rim.position.set(-6, 3, -5);
    this.scene.add(rim);

    const fill = new THREE.PointLight(0xe879f9, 0.7, 30);
    fill.position.set(-4, -2, 4);
    this.scene.add(fill);
  }

  _buildFloor() {
    const w = this.config.world;

    // A soft reflective floor plane that catches shadows.
    const floorGeo = new THREE.PlaneGeometry(w.width * 2.2, w.depth * 2.2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0a0f22,
      roughness: 0.75,
      metalness: 0.25,
      transparent: true,
      opacity: 0.92,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = w.floorY;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.floor = floor;

    const grid = new THREE.GridHelper(w.width * 1.6, 24, 0x22d3ee, 0x1e2a52);
    grid.position.y = w.floorY + 0.005;
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    this.scene.add(grid);
    this.grid = grid;

    // Faint back wall glow so the volume reads as a room.
    const wallGeo = new THREE.PlaneGeometry(w.width * 1.6, w.height * 1.6);
    const wallMat = new THREE.MeshBasicMaterial({
      color: 0x0b1030,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, 0, -w.depth / 2 - 1.2);
    this.scene.add(wall);
  }

  /** Register a per-frame updater: fn(dt, elapsed). */
  addUpdater(fn) {
    this._updaters.push(fn);
    return fn;
  }

  removeUpdater(fn) {
    const i = this._updaters.indexOf(fn);
    if (i !== -1) this._updaters.splice(i, 1);
  }

  resize() {
    const parent = this.canvas.parentElement || document.body;
    const width = parent.clientWidth || window.innerWidth;
    const height = parent.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.width = width;
    this.height = height;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._clock.start();
    const loop = () => {
      if (!this._running) return;
      this._rafId = requestAnimationFrame(loop);
      const dt = Math.min(this._clock.getDelta(), 0.05); // clamp after tab switches
      const elapsed = this._clock.elapsedTime;
      for (const fn of this._updaters) fn(dt, elapsed);
      if (this.onFrame) this.onFrame(dt, elapsed);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  stop() {
    this._running = false;
    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  add(object) {
    this.scene.add(object);
  }

  remove(object) {
    this.scene.remove(object);
  }

  dispose() {
    this.stop();
    this.renderer.dispose();
  }
}
