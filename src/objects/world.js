/**
 * The scene graph's data layer: what drawings exist and where they are.
 *
 * Deliberately free of Three.js. Rendering subscribes to this list; gestures
 * mutate it. Keeping the two apart is what makes undo/redo and hit-testing
 * simple.
 */

import { centroid } from '../core/util.js';

let sequence = 0;

export class Drawing {
  constructor({
    id = null,
    points = [],
    color = '#38f0ff',
    width = 0.02,
    position = { x: 0, y: 0, z: 0 },
    rotation = { x: 0, y: 0, z: 0 },
    scale = 1,
    createdAt = 0,
  } = {}) {
    this.id = id || `d${++sequence}`;
    // Points are stored relative to the drawing's own origin so a single group
    // transform (position / rotation / scale) moves the whole artwork.
    this.points = points.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }));
    this.color = color;
    this.width = width;
    this.position = { ...position };
    this.rotation = { ...rotation };
    this.scale = scale;
    this.createdAt = createdAt;
    this.selected = false;
    this.radius = this.points.reduce((max, p) => Math.max(max, Math.hypot(p.x, p.y)), 0.01);
  }

  /** Build a drawing from a finished stroke, centred on its own centroid. */
  static fromStroke(stroke, createdAt) {
    const c = centroid(stroke.points);
    const local = stroke.points.map((p) => ({ x: p.x - c.x, y: p.y - c.y, z: p.z || 0 }));
    return new Drawing({
      points: local,
      color: stroke.color,
      width: stroke.width,
      position: { x: c.x, y: c.y, z: 0 },
      createdAt,
    });
  }

  toJSON() {
    return {
      id: this.id,
      points: this.points,
      color: this.color,
      width: this.width,
      position: { ...this.position },
      rotation: { ...this.rotation },
      scale: this.scale,
      createdAt: this.createdAt,
    };
  }

  static fromJSON(obj) {
    return new Drawing(obj);
  }
}

/**
 * Undo/redo over whole-scene snapshots.
 *
 * Snapshots are cheap (a few thousand small objects) and they make every action
 * - draw, grab, move, resize, delete - undoable for free, which a command log
 * would not without far more code.
 */
export class History {
  constructor(limit = 60) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Record the state as it is *before* a mutation. */
  mark(snapshot) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(current) {
    if (!this.undoStack.length) return null;
    this.redoStack.push(current);
    return this.undoStack.pop();
  }

  redo(current) {
    if (!this.redoStack.length) return null;
    this.undoStack.push(current);
    return this.redoStack.pop();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

export class DrawingWorld {
  constructor(config) {
    this.config = config;
    this.drawings = [];
    this.history = new History(60);
  }

  add(drawing) {
    this.drawings.push(drawing);
    return drawing;
  }

  removeById(id) {
    const i = this.drawings.findIndex((d) => d.id === id);
    if (i < 0) return null;
    return this.drawings.splice(i, 1)[0];
  }

  clear() {
    const removed = this.drawings.slice();
    this.drawings.length = 0;
    return removed;
  }

  get count() {
    return this.drawings.length;
  }

  serialize() {
    return this.drawings.map((d) => d.toJSON());
  }

  restore(snapshot) {
    this.drawings = snapshot.map((o) => Drawing.fromJSON(o));
  }

  /** Call immediately before any mutation you want to be undoable. */
  mark() {
    this.history.mark(this.serialize());
  }

  undo() {
    const snap = this.history.undo(this.serialize());
    if (!snap) return false;
    this.restore(snap);
    return true;
  }

  redo() {
    const snap = this.history.redo(this.serialize());
    if (!snap) return false;
    this.restore(snap);
    return true;
  }
}
