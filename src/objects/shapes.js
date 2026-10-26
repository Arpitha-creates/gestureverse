/**
 * The catalogue of exact primitives.
 *
 * Deliberately free of Three.js so the UI can import it without pulling the
 * renderer in. `drawingView` maps each id to real geometry.
 */
export const SHAPES = [
  { id: 'cube', label: 'Cube' },
  { id: 'sphere', label: 'Sphere' },
  { id: 'cone', label: 'Cone' },
  { id: 'cylinder', label: 'Cylinder' },
  { id: 'pyramid', label: 'Pyramid' },
  { id: 'torus', label: 'Torus' },
  { id: 'star', label: 'Star' },
  { id: 'diamond', label: 'Diamond' },
];

export const SHAPE_IDS = SHAPES.map((s) => s.id);

export function shapeLabel(id) {
  const found = SHAPES.find((s) => s.id === id);
  return found ? found.label : id;
}

export function isShapeId(id) {
  return SHAPE_IDS.includes(id);
}
