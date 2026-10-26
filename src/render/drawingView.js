/**
 * Renders the data layer.
 *
 * Two kinds of object share one renderer:
 *   - 'stroke' drawings become neon tubes that keep their own path
 *   - 'shape' objects become exact primitives (cube, sphere, cone...)
 *
 * Geometry is built once per object and only transforms change per frame;
 * anything removed from the world is disposed properly.
 */

import * as THREE from 'three';

const GLOW_OPACITY = 0.14;
const SELECTED_BOOST = 2.4;

/** Exact primitive geometry, sized so its extent is roughly `size`. */
export function geometryFor(primitive, size) {
  const s = Math.max(0.05, size);
  switch (primitive) {
    case 'cube':
      return new THREE.BoxGeometry(s * 1.5, s * 1.5, s * 1.5);
    case 'sphere':
      return new THREE.SphereGeometry(s, 32, 24);
    case 'cone':
      return new THREE.ConeGeometry(s * 0.85, s * 1.9, 32);
    case 'cylinder':
      return new THREE.CylinderGeometry(s * 0.75, s * 0.75, s * 1.7, 32);
    case 'pyramid':
      return new THREE.ConeGeometry(s, s * 1.7, 4);
    case 'torus':
      return new THREE.TorusGeometry(s * 0.7, s * 0.3, 18, 48);
    case 'star':
      return extrudeStar(s);
    case 'diamond':
      return new THREE.OctahedronGeometry(s);
    default:
      return new THREE.IcosahedronGeometry(s);
  }
}

function extrudeStar(size) {
  const shape = new THREE.Shape();
  const inner = size * 0.45;
  const arms = 5;
  for (let i = 0; i < arms * 2; i++) {
    const r = i % 2 === 0 ? size : inner;
    const a = (i / (arms * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const depth = size * 0.45;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: size * 0.04,
    bevelThickness: size * 0.04,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

export class DrawingView {
  constructor(sceneView) {
    this.sceneView = sceneView;
    this.root = new THREE.Group();
    sceneView.scene.add(this.root);
    this.entries = new Map(); // id -> {group, materials, selected}

    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    sceneView.scene.add(this.ghost);
    this.ghostPrimitive = null;
    this.ghostSize = 0;
  }

  buildShape(drawing) {
    const group = new THREE.Group();
    const color = new THREE.Color(drawing.color);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.55,
      roughness: 0.28,
      metalness: 0.5,
      toneMapped: false,
    });
    group.add(new THREE.Mesh(geometryFor(drawing.primitive, drawing.size), mat));
    return { group, materials: [{ material: mat, kind: 'core' }] };
  }

  buildStroke(drawing) {
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
      group.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(curve, Math.max(12, segments >> 1), radius * 3.2, 6, false),
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
        const built = drawing.isShape ? this.buildShape(drawing) : this.buildStroke(drawing);
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
          if (kind === 'core') {
            if (drawing.isShape) {
              material.emissiveIntensity = drawing.selected ? 1.5 : 0.55;
            } else {
              material.emissiveIntensity = drawing.selected ? SELECTED_BOOST : 1.15;
            }
          }
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

  /**
   * Preview of the primitive that will be stamped.
   * Pass null to hide it.
   */
  setGhost(primitive, color, position) {
    if (!primitive || !position) {
      this.ghost.visible = false;
      return;
    }
    const size = this.ghostSize || 0.85;
    if (this.ghostPrimitive !== primitive) {
      this.clearGhost();
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color || '#38f0ff'),
        emissive: new THREE.Color(color || '#38f0ff'),
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        toneMapped: false,
      });
      this.ghost.add(new THREE.Mesh(geometryFor(primitive, size), mat));
      this.ghostPrimitive = primitive;
    }
    this.ghost.position.set(position.x, position.y, position.z);
    this.ghost.visible = true;
  }

  clearGhost() {
    for (const child of [...this.ghost.children]) {
      this.ghost.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
    this.ghostPrimitive = null;
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
