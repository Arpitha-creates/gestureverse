/**
 * Renders the data-layer drawings as neon tubes.
 *
 * Each drawing keeps its own stroke path, so what you drew is exactly what
 * floats in the workspace - shape, colour and thickness all preserved. Geometry
 * is built once per drawing and only transforms change per frame; anything
 * removed from the world is disposed properly.
 */

import * as THREE from 'three';

const GLOW_OPACITY = 0.14;
const SELECTED_BOOST = 2.4;

export class DrawingView {
  constructor(sceneView) {
    this.sceneView = sceneView;
    this.root = new THREE.Group();
    sceneView.scene.add(this.root);
    this.entries = new Map(); // id -> {group, materials, signature}
  }

  build(drawing) {
    const group = new THREE.Group();
    const materials = [];
    const color = new THREE.Color(drawing.color);
    const radius = Math.max(0.004, drawing.width * 0.5);
    const pts = drawing.points;

    if (pts.length >= 2) {
      // Centripetal parameterisation: the uniform variant overshoots between
      // closely spaced points, which reads as the line wobbling.
      const curve = new THREE.CatmullRomCurve3(
        pts.map((p) => new THREE.Vector3(p.x, p.y, p.z || 0)),
        false,
        'centripetal',
      );
      const segments = Math.min(320, Math.max(12, pts.length * 2));

      const coreMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.15,
        roughness: 0.3,
        metalness: 0.15,
        toneMapped: false,
      });
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 6, false), coreMat));
      materials.push({ material: coreMat, kind: 'core' });

      const glowMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: GLOW_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const glowRadius = radius * 3.2;
      group.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(curve, Math.max(12, segments >> 1), glowRadius, 6, false),
          glowMat,
        ),
      );
      materials.push({ material: glowMat, kind: 'glow' });
    } else {
      // A single tap becomes a small glowing bead rather than an error.
      const coreMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.2,
        toneMapped: false,
      });
      group.add(new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.02, radius * 2), 12, 10), coreMat));
      materials.push({ material: coreMat, kind: 'core' });
    }

    return { group, materials };
  }

  sync(world) {
    const alive = new Set();

    for (const drawing of world.drawings) {
      alive.add(drawing.id);
      let entry = this.entries.get(drawing.id);
      if (!entry) {
        const built = this.build(drawing);
        entry = { ...built, selected: false };
        this.root.add(entry.group);
        this.entries.set(drawing.id, entry);
      }

      entry.group.position.set(drawing.position.x, drawing.position.y, drawing.position.z);
      entry.group.rotation.set(drawing.rotation.x, drawing.rotation.y, drawing.rotation.z);
      entry.group.scale.setScalar(drawing.scale);

      if (entry.selected !== drawing.selected) {
        entry.selected = drawing.selected;
        for (const { material, kind } of entry.materials) {
          if (kind === 'core') material.emissiveIntensity = drawing.selected ? SELECTED_BOOST : 1.15;
          if (kind === 'glow') material.opacity = drawing.selected ? 0.3 : GLOW_OPACITY;
        }
      }
    }

    for (const [id, entry] of this.entries) {
      if (alive.has(id)) continue;
      this.root.remove(entry.group);
      this.dispose(entry);
      this.entries.delete(id);
    }
  }

  dispose(entry) {
    entry.group.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of mats) m.dispose();
      }
    });
  }

  clear() {
    for (const [, entry] of this.entries) {
      this.root.remove(entry.group);
      this.dispose(entry);
    }
    this.entries.clear();
  }
}
