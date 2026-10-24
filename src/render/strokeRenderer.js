/**
 * GestureVerse - 2D stroke renderer.
 *
 * Draws the ink: committed strokes, the live stroke, parametric shape
 * previews, the hand skeleton and the fingertip cursor. Lives on a 2D canvas
 * stacked over the WebGL scene, which keeps drawing cheap and crisp.
 */

import { TOOL } from '../drawing/strokeManager.js';

export class StrokeRenderer {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = config;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = 1;
    this.height = 1;

    // Committed strokes are rasterised once into an offscreen canvas and then
    // blitted. Re-tracing every stroke on every frame is the single most
    // expensive thing this app could do - a busy canvas is tens of thousands
    // of curve segments per frame - and it is entirely redundant, because
    // committed strokes never change.
    this.cache = document.createElement('canvas');
    this.cacheCtx = this.cache.getContext('2d');
    this.cachedVersion = -1;
    this._lastOverlayVersion = -1;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.cache.width = this.canvas.width;
    this.cache.height = this.canvas.height;
    this.cacheCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Force a rebuild at the new size, and make sure the next frame actually
    // paints - otherwise a resize would leave the overlay blank until the
    // user happened to change something.
    this.cachedVersion = -1;
    this._lastOverlayVersion = -1;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.cacheCtx.clearRect(0, 0, this.width, this.height);
    this.cachedVersion = -1;
    this._lastOverlayVersion = -1;
  }

  /** Rebuild the offscreen raster of committed strokes if it is stale. */
  _refreshCache(strokeManager) {
    if (this.cachedVersion === strokeManager.version) return;
    const ctx = this.cacheCtx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const saved = this.ctx;
    this.ctx = ctx;
    for (const s of strokeManager.strokes) this._drawStroke(s, false);
    this.ctx = saved;
    this.cachedVersion = strokeManager.version;
  }

  /**
   * Draw every committed stroke plus the in-progress one.
   * @param {boolean} [force] redraw even if nothing appears to have changed
   * @returns {boolean} whether anything was actually drawn
   */
  render(strokeManager, activeStroke, force = false) {
    const idle = !activeStroke && strokeManager.version === this._lastOverlayVersion;
    if (idle && !force) return false;

    this._refreshCache(strokeManager);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.cache, 0, 0, this.width, this.height);

    if (activeStroke) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this._drawStroke(activeStroke, true);
    }
    this._lastOverlayVersion = strokeManager.version;
    return true;
  }

  _drawStroke(stroke, live) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.shadowColor = stroke.color;
    ctx.shadowBlur = live ? 18 : 12;
    ctx.globalAlpha = live ? 0.95 : 0.9;

    if (stroke.kind === 'shape') {
      this._drawShape(stroke);
    } else {
      this._drawPath(stroke.points);
    }
    ctx.restore();
  }

  _drawPath(points) {
    if (!points || points.length < 2) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    // Quadratic smoothing through midpoints gives a natural ink feel.
    for (let i = 1; i < points.length - 1; i++) {
      const mx = (points[i].x + points[i + 1].x) / 2;
      const my = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  _drawShape(stroke) {
    const ctx = this.ctx;
    const { start, end, tool } = stroke;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;

    ctx.beginPath();
    switch (tool) {
      case TOOL.LINE:
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        break;
      case TOOL.RECT:
        ctx.rect(x, y, w, h);
        break;
      case TOOL.SQUARE: {
        const s = Math.max(w, h);
        ctx.rect(x, y, s, s);
        break;
      }
      case TOOL.CIRCLE: {
        const r = Math.max(w, h) / 2;
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        break;
      }
      case TOOL.ELLIPSE:
        ctx.ellipse(cx, cy, Math.max(w / 2, 1), Math.max(h / 2, 1), 0, 0, Math.PI * 2);
        break;
      case TOOL.TRIANGLE:
        ctx.moveTo(cx, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        break;
      case TOOL.STAR:
        this._starPath(cx, cy, Math.max(w, h) / 2, 5);
        break;
      default:
        break;
    }
    ctx.stroke();
  }

  _starPath(cx, cy, outer, points) {
    const ctx = this.ctx;
    const inner = outer * 0.45;
    const n = points * 2;
    for (let i = 0; i < n; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  /**
   * Overlay: hand skeleton + fingertip cursor.
   *
   * Deliberately uses the SAME mapping as the ink (toCanvasInRect, not
   * toCanvas). Drawing the skeleton with the un-padded mapping put the glowing
   * fingertip dot somewhere other than where strokes actually appeared.
   */
  drawHand(landmarks, mapper, rect, { pinchStrength = 0, color = '#22d3ee' } = {}) {
    if (!landmarks || landmarks.length < 21) return;
    const ctx = this.ctx;
    const pt = (i) => mapper.toCanvasInRect(landmarks[i], rect);

    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12],
      [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20],
      [0, 17],
    ];

    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a, b] of connections) {
      const pa = pt(a);
      const pb = pt(b);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();

    ctx.globalAlpha = 0.75;
    ctx.fillStyle = color;
    for (let i = 0; i < 21; i++) {
      const p = pt(i);
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === 8 ? 3.5 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Glowing fingertip cursor.
    const tip = pt(8);
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 8 - pinchStrength * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Transient on-canvas toast, e.g. "Circle detected". */
  drawLabel(x, y, text, color = '#22d3ee') {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 20;
    ctx.fillStyle = 'rgba(6,10,24,0.82)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    this._roundRect(x - w / 2, y - 34, w, 26, 13);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y - 21);
    ctx.restore();
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
