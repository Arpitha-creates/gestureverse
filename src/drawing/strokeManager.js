/**
 * GestureVerse - stroke / drawing model.
 *
 * Owns the list of strokes, the in-progress stroke, and undo/redo. Pure data
 * and logic: the renderer reads from here, nothing here touches the canvas.
 */

import { dist2 } from '../core/math.js';

export const TOOL = {
  FREEHAND: 'freehand',
  LINE: 'line',
  RECT: 'rect',
  SQUARE: 'square',
  CIRCLE: 'circle',
  ELLIPSE: 'ellipse',
  TRIANGLE: 'triangle',
  STAR: 'star',
};

/** Tools that are drawn by dragging from a start point to an end point. */
export const PARAMETRIC_TOOLS = new Set([
  TOOL.LINE, TOOL.RECT, TOOL.SQUARE, TOOL.CIRCLE, TOOL.ELLIPSE, TOOL.TRIANGLE, TOOL.STAR,
]);

let strokeCounter = 0;

export function nextStrokeId() {
  strokeCounter += 1;
  return `s${strokeCounter}_${Math.random().toString(36).slice(2, 7)}`;
}

export class StrokeManager {
  constructor(config) {
    this.config = config;
    this.strokes = [];
    this.active = null;
    this.undoStack = [];
    this.redoStack = [];
    // Bumped on every mutation. The renderer uses it to know when its cached
    // raster of the committed strokes is stale, so it can blit instead of
    // re-tracing every stroke on every frame.
    this.version = 0;
  }

  /** Start a new stroke at a canvas point. */
  begin(x, y, { tool = TOOL.FREEHAND, color, width } = {}) {
    const cfg = this.config.drawing;
    this.active = {
      id: nextStrokeId(),
      tool,
      points: [{ x, y }],
      start: { x, y },
      end: { x, y },
      color: color || cfg.defaultColor,
      width: width || cfg.defaultWidth,
      kind: PARAMETRIC_TOOLS.has(tool) ? 'shape' : 'freehand',
      createdAt: Date.now(),
    };
    return this.active;
  }

  get isDrawing() {
    return this.active !== null;
  }

  /**
   * Append a point to the active stroke.
   * Returns true when the point was accepted (not filtered as too close).
   */
  addPoint(x, y) {
    if (!this.active) return false;
    const minD = this.config.drawing.minPointDistance;
    const pts = this.active.points;

    if (this.active.kind === 'shape') {
      this.active.end = { x, y };
      return true;
    }

    const last = pts[pts.length - 1];
    if (last && dist2(last.x, last.y, x, y) < minD) return false;
    if (pts.length >= this.config.drawing.maxPointsPerStroke) return false;
    pts.push({ x, y });
    this.active.end = { x, y };
    return true;
  }

  /**
   * Finish the active stroke.
   * @returns {object|null} the committed stroke, or null if it was empty.
   */
  end() {
    const stroke = this.active;
    this.active = null;
    if (!stroke) return null;

    // Reject degenerate strokes (a tap, or a shape that never moved).
    const moved = dist2(stroke.start.x, stroke.start.y, stroke.end.x, stroke.end.y);
    if (stroke.kind === 'freehand' && stroke.points.length < 2) return null;
    if (stroke.kind === 'shape' && moved < this.config.drawing.minPointDistance * 4) return null;

    this.strokes.push(stroke);
    this.undoStack.push({ type: 'add', stroke });
    this.redoStack.length = 0;
    this.version++;
    return stroke;
  }

  /** Discard the active stroke without committing it. */
  cancel() {
    this.active = null;
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    this._apply(cmd, 'undo');
    this.redoStack.push(cmd);
    return true;
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    this._apply(cmd, 'redo');
    this.undoStack.push(cmd);
    return true;
  }

  _apply(cmd, dir) {
    this.version++;
    if (cmd.type === 'add') {
      if (dir === 'undo') {
        const i = this.strokes.findIndex((s) => s.id === cmd.stroke.id);
        if (i !== -1) this.strokes.splice(i, 1);
      } else {
        this.strokes.push(cmd.stroke);
      }
    } else if (cmd.type === 'remove') {
      if (dir === 'undo') {
        this.strokes.splice(cmd.index, 0, cmd.stroke);
      } else {
        const i = this.strokes.findIndex((s) => s.id === cmd.stroke.id);
        if (i !== -1) this.strokes.splice(i, 1);
      }
    } else if (cmd.type === 'clear') {
      if (dir === 'undo') {
        this.strokes = cmd.strokes.slice();
      } else {
        this.strokes = [];
      }
    }
  }

  remove(id) {
    const i = this.strokes.findIndex((s) => s.id === id);
    if (i === -1) return false;
    const [stroke] = this.strokes.splice(i, 1);
    this.undoStack.push({ type: 'remove', stroke, index: i });
    this.redoStack.length = 0;
    this.version++;
    return true;
  }

  clear() {
    if (!this.strokes.length) return false;
    const snapshot = this.strokes.slice();
    this.strokes = [];
    this.undoStack.push({ type: 'clear', strokes: snapshot });
    this.redoStack.length = 0;
    this.version++;
    return true;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  /** Hit-test strokes in canvas space, newest first. */
  hitTest(x, y, radius = 14) {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i];
      if (this._strokeHit(s, x, y, radius)) return s;
    }
    return null;
  }

  _strokeHit(stroke, x, y, radius) {
    if (stroke.kind === 'shape') {
      const { start, end } = stroke;
      const minX = Math.min(start.x, end.x) - radius;
      const maxX = Math.max(start.x, end.x) + radius;
      const minY = Math.min(start.y, end.y) - radius;
      const maxY = Math.max(start.y, end.y) + radius;
      return x >= minX && x <= maxX && y >= minY && y <= maxY;
    }
    const pts = stroke.points;
    for (let i = 0; i < pts.length; i++) {
      if (dist2(pts[i].x, pts[i].y, x, y) <= radius + stroke.width) return true;
    }
    return false;
  }

  toJSON() {
    return { version: 1, strokes: this.strokes };
  }

  loadJSON(data) {
    if (!data || !Array.isArray(data.strokes)) return false;
    this.strokes = data.strokes;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.version++;
    return true;
  }
}
