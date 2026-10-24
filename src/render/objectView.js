/**
 * GestureVerse - object meshes.
 *
 * Bridges the renderer-free ObjectManager to Three.js: builds geometry from a
 * shape descriptor, keeps a mesh per object, and syncs transforms each frame.
 */

import * as THREE from 'three';
import { GEOMETRY } from '../objects/objectFactory.js';

const NEON = { emissiveIntensity: 0.55, roughness: 0.32, metalness: 0.45 };

/** Star outline used by the extruded star geometry. */
function starShape(outer, inner, points = 5) {
  const shape = new THREE.Shape();
  const n = points * 2;
  for (let i = 0; i < n; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/** Classic parametric heart, as an extruded Shape. */
function heartShape(size) {
  const shape = new THREE.Shape();
  const s = size / 17;
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    const px = x * s;
    const py = y * s;
    if (i === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  }
  shape.closePath();
  return shape;
}

/**
 * Build a Three.js geometry for a descriptor.
 * @param {{geometry:string, size:number, squash?:number, sides?:number}} desc
 * @param {Array<{x:number,y:number}>} [points] stroke points, for tubes
 */
export function buildGeometry(desc, points) {
  const size = desc.size ?? 1;
  const r = size * 0.5;

  switch (desc.geometry) {
    case GEOMETRY.BOX:
      return new THREE.BoxGeometry(size, size, size, 2, 2, 2);
    case GEOMETRY.CONE:
      return new THREE.ConeGeometry(r, size * 1.15, 32);
    case GEOMETRY.CYLINDER:
      return new THREE.CylinderGeometry(r, r, size * 1.1, desc.sides || 24);
    case GEOMETRY.TORUS:
      return new THREE.TorusGeometry(r * 0.85, r * 0.3, 20, 48);
    case GEOMETRY.STAR:
      return new THREE.ExtrudeGeometry(starShape(r * 1.2, r * 0.5), {
        depth: size * 0.24,
        bevelEnabled: true,
        bevelThickness: size * 0.03,
        bevelSize: size * 0.03,
        bevelSegments: 2,
      }).center();
    case GEOMETRY.HEART:
      return new THREE.ExtrudeGeometry(heartShape(size * 1.05), {
        depth: size * 0.28,
        bevelEnabled: true,
        bevelThickness: size * 0.03,
        bevelSize: size * 0.03,
        bevelSegments: 2,
      }).center();
    case GEOMETRY.OCTAHEDRON:
      return new THREE.OctahedronGeometry(r * 1.1, 0);
    case GEOMETRY.PLANE:
      return new THREE.PlaneGeometry(size, size);
    case GEOMETRY.TUBE:
      return buildTube(points, size);
    case GEOMETRY.SPHERE:
    default: {
      const geo = new THREE.SphereGeometry(r, 32, 24);
      if (desc.squash) geo.scale(desc.squash, 1, 1);
      return geo;
    }
  }
}

/** Sweep a glowing tube along the user's drawn path. */
function buildTube(points, size) {
  if (!points || points.length < 2) {
    return new THREE.TorusKnotGeometry(size * 0.3, size * 0.1, 64, 12);
  }
  // Down-sample to keep the curve cheap.
  const step = Math.max(1, Math.floor(points.length / 32));
  const pts = [];
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    // Canvas points are in pixels; normalise around the stroke's own centre.
    pts.push(new THREE.Vector3(p.x, -p.y, 0));
  }
  const centre = pts.reduce((a, p) => a.add(p.clone()), new THREE.Vector3()).divideScalar(pts.length);
  for (const p of pts) p.sub(centre);
  const maxLen = pts.reduce((m, p) => Math.max(m, p.length()), 0.001);
  const norm = (size * 0.5) / maxLen;
  for (const p of pts) p.multiplyScalar(norm);

  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, Math.min(96, pts.length * 3), size * 0.09, 10, false);
}

export class ObjectViewManager {
  constructor(sceneView) {
    this.sceneView = sceneView;
    this.views = new Map(); // object id -> { mesh, material, glow }
  }

  /** Create the mesh for an object if it does not exist yet. */
  ensure(obj) {
    if (this.views.has(obj.id)) return this.views.get(obj.id);
    const geometry = buildGeometry(obj, obj.points);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(obj.color),
      emissive: new THREE.Color(obj.color),
      emissiveIntensity: NEON.emissiveIntensity,
      roughness: NEON.roughness,
      metalness: NEON.metalness,
      transparent: true,
      opacity: 0.96,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
    mesh.scale.setScalar(obj.scale || 1);

    // Soft contact shadow blob under the object.
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(obj.size * 0.55, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = this.sceneView.config.world.floorY + 0.01;
    this.sceneView.add(shadow);

    // Selection outline.
    const outline = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(obj.color),
        transparent: true,
        opacity: 0,
        side: THREE.BackSide,
      }),
    );
    outline.scale.setScalar(1.08);
    mesh.add(outline);

    this.sceneView.add(mesh);
    const view = { mesh, material, shadow, outline, obj };
    this.views.set(obj.id, view);
    return view;
  }

  /** Push the object's current transform into its mesh. */
  sync(obj, elapsed) {
    const view = this.views.get(obj.id);
    if (!view) return;
    const { mesh, shadow, outline, material } = view;

    mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
    mesh.scale.setScalar(obj.scale || 1);
    mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);

    // Idle float + selection pulse.
    const selectable = obj.selectable || obj.state === 'held';
    if (obj.state === 'idle' || obj.state === 'hovered') {
      mesh.position.y += Math.sin(elapsed * 1.6 + obj.position.x) * 0.035;
    }
    outline.material.opacity = selectable ? 0.5 + Math.sin(elapsed * 6) * 0.2 : 0;
    material.emissiveIntensity = selectable ? 0.95 : NEON.emissiveIntensity;

    const world = this.sceneView.config.world;
    const floorY = world.floorY + 0.01;
    const height = Math.max(0, obj.position.y - floorY);
    shadow.position.set(obj.position.x, floorY, obj.position.z);
    shadow.scale.setScalar(Math.max(0.35, 1 - height * 0.09));
    shadow.material.opacity = Math.max(0.05, 0.3 - height * 0.02);
  }

  /** Remove meshes for objects that no longer exist. */
  prune(liveIds) {
    for (const [id, view] of this.views) {
      if (!liveIds.has(id)) {
        this.sceneView.remove(view.mesh);
        this.sceneView.remove(view.shadow);
        view.mesh.geometry.dispose();
        view.material.dispose();
        view.shadow.geometry.dispose();
        view.shadow.material.dispose();
        view.outline.material.dispose();
        this.views.delete(id);
      }
    }
  }

  /** Quick scale-pop when an object is first created. */
  pop(id) {
    const view = this.views.get(id);
    if (!view) return;
    view.mesh.scale.setScalar(0.01);
    view.popT = 0;
  }

  updatePops(dt) {
    for (const view of this.views.values()) {
      if (view.popT === undefined) continue;
      view.popT += dt;
      const t = Math.min(1, view.popT / 0.35);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic
      view.mesh.scale.setScalar(eased * (view.obj.scale || 1));
      if (t >= 1) view.popT = undefined;
    }
  }

  clear() {
    this.prune(new Set());
  }
}
