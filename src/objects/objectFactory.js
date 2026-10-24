/**
 * GestureVerse - shape -> 3D object descriptors.
 *
 * Pure mapping from a recognised 2D shape to a geometry the renderer knows how
 * to build, plus sensible default size and colour. Keeps shape semantics out
 * of the Three.js layer.
 */

import { SHAPE } from '../drawing/shapeRecognizer.js';

/** Every geometry the renderer can build. */
export const GEOMETRY = {
  SPHERE: 'sphere',
  BOX: 'box',
  CONE: 'cone',
  CYLINDER: 'cylinder',
  TORUS: 'torus',
  STAR: 'star',
  HEART: 'heart',
  TUBE: 'tube',
  PLANE: 'plane',
  OCTAHEDRON: 'octahedron',
};

const MAP = {
  [SHAPE.CIRCLE]: { geometry: GEOMETRY.SPHERE, size: 0.9 },
  [SHAPE.ELLIPSE]: { geometry: GEOMETRY.SPHERE, size: 0.9, squash: 1.5 },
  [SHAPE.SQUARE]: { geometry: GEOMETRY.BOX, size: 1.0 },
  [SHAPE.RECTANGLE]: { geometry: GEOMETRY.BOX, size: 1.0 },
  [SHAPE.TRIANGLE]: { geometry: GEOMETRY.CONE, size: 1.1 },
  [SHAPE.PENTAGON]: { geometry: GEOMETRY.CYLINDER, size: 1.0, sides: 5 },
  [SHAPE.POLYGON]: { geometry: GEOMETRY.OCTAHEDRON, size: 0.9 },
  [SHAPE.STAR]: { geometry: GEOMETRY.STAR, size: 1.2 },
  [SHAPE.HEART]: { geometry: GEOMETRY.HEART, size: 1.1 },
  [SHAPE.LINE]: { geometry: GEOMETRY.TUBE, size: 0.9 },
  [SHAPE.CURVE]: { geometry: GEOMETRY.TUBE, size: 0.9 },
  [SHAPE.UNKNOWN]: { geometry: GEOMETRY.SPHERE, size: 0.8 },
};

/**
 * @param {string} shape a SHAPE value
 * @param {string} [color]
 * @returns {{geometry:string, size:number, color:string}}
 */
export function descriptorForShape(shape, color) {
  const base = MAP[shape] || MAP[SHAPE.UNKNOWN];
  return { ...base, color };
}

/** Descriptor for a free-floating sample object in the playground. */
export function sampleObject(index, color) {
  const kinds = [
    { geometry: GEOMETRY.SPHERE, size: 0.9 },
    { geometry: GEOMETRY.BOX, size: 1.0 },
    { geometry: GEOMETRY.STAR, size: 1.1 },
    { geometry: GEOMETRY.TORUS, size: 1.0 },
    { geometry: GEOMETRY.CONE, size: 1.0 },
    { geometry: GEOMETRY.OCTAHEDRON, size: 0.9 },
  ];
  const k = kinds[index % kinds.length];
  return { ...k, color };
}

/** Human-readable label for the HUD. */
export function shapeLabel(shape) {
  return String(shape || 'object').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
