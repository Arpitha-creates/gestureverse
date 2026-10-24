/**
 * GestureVerse - visual effects.
 *
 * A pooled particle system, a glowing hand cursor, and neon trails. Everything
 * is allocated once and recycled so effects never allocate during interaction
 * and never stall the render loop.
 */

import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

export class Effects {
  constructor(sceneView, config) {
    this.sceneView = sceneView;
    this.config = config;
    this.rand = mulberry32(1337);
    this._buildParticles();
    this._buildCursor();
    this._buildTrail();
    this._bursts = [];
  }

  _buildParticles() {
    const max = this.config.effects.particles;
    this.maxParticles = max;
    this.pPositions = new Float32Array(max * 3);
    this.pColors = new Float32Array(max * 3);
    this.pVel = new Float32Array(max * 3);
    this.pLife = new Float32Array(max);
    this.pMaxLife = new Float32Array(max);
    this.pCursor = 0;
    // Indices of live particles, so the update loop is O(alive) rather than
    // O(pool). With a mostly-idle scene that is the difference between
    // touching 500 particles and touching none.
    this.alive = [];

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pColors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.09,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.particles = new THREE.Points(geo, mat);
    this.particles.frustumCulled = false;
    this.sceneView.add(this.particles);

    // Hide all particles initially.
    for (let i = 0; i < max; i++) this.pLife[i] = 0;
    geo.setDrawRange(0, max);
  }

  _buildCursor() {
    const group = new THREE.Group();

    this.cursorCore = new THREE.Mesh(
      new THREE.SphereGeometry(this.config.world.pointerRadius, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9 }),
    );
    group.add(this.cursorCore);

    this.cursorGlow = new THREE.Mesh(
      new THREE.SphereGeometry(this.config.world.pointerRadius * 2.6, 20, 16),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    group.add(this.cursorGlow);

    this.cursorRing = new THREE.Mesh(
      new THREE.TorusGeometry(this.config.world.pointerRadius * 1.9, 0.018, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xe879f9, transparent: true, opacity: 0.8 }),
    );
    group.add(this.cursorRing);

    this.cursor = group;
    group.visible = false;
    this.sceneView.add(group);
  }

  /** Drop every live particle (used by reset). */
  clearParticles() {
    for (const i of this.alive) this.pPositions[i * 3 + 1] = -999;
    this.alive.length = 0;
    for (let i = 0; i < this.maxParticles; i++) this.pLife[i] = 0;
    this.particles.geometry.attributes.position.needsUpdate = true;
  }

  _buildTrail() {
    const len = this.config.effects.trailLength;
    this.trailLen = len;
    this.trailPoints = [];
    const positions = new Float32Array(len * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });
    this.trail = new THREE.Line(geo, mat);
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.sceneView.add(this.trail);
    this.trailPositions = positions;
  }

  /** Emit a burst of particles at a world position. */
  spawnBurst(position, color, count = 28, speed = 2.4) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const idx = this.pCursor;
      this.pCursor = (this.pCursor + 1) % this.maxParticles;
      const i3 = idx * 3;
      this.pPositions[i3] = position.x;
      this.pPositions[i3 + 1] = position.y;
      this.pPositions[i3 + 2] = position.z;

      const theta = this.rand() * Math.PI * 2;
      const phi = Math.acos(2 * this.rand() - 1);
      const sp = speed * (0.4 + this.rand() * 0.9);
      this.pVel[i3] = Math.sin(phi) * Math.cos(theta) * sp;
      this.pVel[i3 + 1] = Math.cos(phi) * sp;
      this.pVel[i3 + 2] = Math.sin(phi) * Math.sin(theta) * sp;

      this.pColors[i3] = c.r;
      this.pColors[i3 + 1] = c.g;
      this.pColors[i3 + 2] = c.b;
      this.pMaxLife[idx] = 0.6 + this.rand() * 0.7;
      this.pLife[idx] = this.pMaxLife[idx];
      this.alive.push(idx);
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.color.needsUpdate = true;
  }

  /** Show the cursor at a world position. */
  setCursor(pos, { visible = true, color = 0x22d3ee, pinch = 0 } = {}) {
    this.cursor.visible = visible;
    if (!visible) return;
    this.cursor.position.set(pos.x, pos.y, pos.z);
    const s = 1 - pinch * 0.35;
    this.cursorCore.scale.setScalar(s);
    this.cursorCore.material.color.setHex(color);
    this.cursorGlow.material.color.setHex(color);
    this.cursorGlow.material.opacity = 0.12 + pinch * 0.3;
  }

  /** Feed the 3D neon trail a new point. */
  trailPush(pos, color) {
    if (!this.config.effects.glow) return;
    this.trailPoints.push({ x: pos.x, y: pos.y, z: pos.z });
    while (this.trailPoints.length > this.trailLen) this.trailPoints.shift();

    const n = this.trailPoints.length;
    this.trail.geometry.setDrawRange(0, n);
    for (let i = 0; i < n; i++) {
      const p = this.trailPoints[i];
      const i3 = i * 3;
      this.trailPositions[i3] = p.x;
      this.trailPositions[i3 + 1] = p.y;
      this.trailPositions[i3 + 2] = p.z;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.visible = n > 1;
    if (color !== undefined) this.trail.material.color.set(color);
  }

  trailClear() {
    this.trailPoints.length = 0;
    this.trail.visible = false;
  }

  update(dt, elapsed) {
    // Particles - iterate only the live ones and compact the list in place.
    const pos = this.pPositions;
    const vel = this.pVel;
    const alive = this.alive;
    if (alive.length) {
      let w = 0;
      for (let k = 0; k < alive.length; k++) {
        const i = alive[k];
        this.pLife[i] -= dt;
        const i3 = i * 3;
        if (this.pLife[i] <= 0) {
          // Park dead particles far below the floor so they are invisible.
          pos[i3 + 1] = -999;
          continue; // dropped from the compacted list
        }
        vel[i3 + 1] -= 5.5 * dt; // gravity
        pos[i3] += vel[i3] * dt;
        pos[i3 + 1] += vel[i3 + 1] * dt;
        pos[i3 + 2] += vel[i3 + 2] * dt;
        alive[w++] = i;
      }
      alive.length = w;
      this.particles.geometry.attributes.position.needsUpdate = true;
    }

    // Cursor shimmer
    if (this.cursor.visible) {
      this.cursorRing.rotation.z = elapsed * 1.4;
      this.cursorRing.rotation.x = Math.PI / 2 + Math.sin(elapsed * 2) * 0.2;
    }
  }
}
