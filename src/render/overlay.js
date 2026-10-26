/**
 * The 2D layer: hand skeleton, glowing cursor, live stroke, and the progress
 * rings for the two deliberate gestures (delete and undo).
 *
 * Everything here is decoration - it never feeds back into the gesture logic,
 * so it can never cause an interaction to stick.
 */

import { HAND_CONNECTIONS } from '../gestures/handPose.js';
import { clamp01 } from '../core/util.js';

export class Overlay {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.ctx = canvas.getContext('2d');
    this.width = 1;
    this.height = 1;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  px(point) {
    return { x: point.x * this.width, y: point.y * this.height };
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /**
   * @param {object} f frame description built by main.js
   */
  draw(f) {
    const ctx = this.ctx;
    this.clear();

    this.drawSkeletons(f.hands);

    if (f.stroke && f.stroke.length > 1) this.drawLiveStroke(f.stroke, f.brushColor);

    if (f.twoHandPoints) this.drawTwoHand(f);

    if (f.cursor) this.drawCursor(f);

    if (f.hoverRing) this.drawRing(f.hoverRing, '#38f0ff', 0.35);

    if (f.deleteRing && f.deleteProgress > 0) {
      this.drawRing(f.deleteRing, '#ff3b5c', 1, f.deleteProgress);
    }

    if (f.palmRing && f.palmProgress > 0) {
      this.drawRing(f.palmRing, '#ffd93d', 1, f.palmProgress);
    }
  }

  drawSkeletons(hands) {
    const ctx = this.ctx;
    for (const hand of hands || []) {
      if (!hand.pose) continue;
      const lm = hand.pose.landmarks;
      const active = hand.result && hand.result.state !== 'lost';

      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = active ? 'rgba(120, 220, 255, 0.5)' : 'rgba(120, 160, 200, 0.2)';
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        const p = this.px(lm[a]);
        const q = this.px(lm[b]);
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();

      ctx.fillStyle = active ? 'rgba(150, 240, 255, 0.75)' : 'rgba(120, 160, 200, 0.3)';
      for (const p of lm) {
        const q = this.px(p);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawLiveStroke(points, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color || '#38f0ff';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = color || '#38f0ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const p = this.px(points[i]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawTwoHand(f) {
    const ctx = this.ctx;
    const [a, b] = f.twoHandPoints;
    const pa = this.px(a);
    const pb = this.px(b);

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 61, 240, 0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const p of [pa, pb]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 61, 240, 0.85)';
      ctx.fill();
    }

    if (f.twoHandLabel) {
      const mx = (pa.x + pb.x) / 2;
      const my = (pa.y + pb.y) / 2 - 16;
      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 200, 255, 0.95)';
      ctx.fillText(f.twoHandLabel, mx, my);
    }
    ctx.restore();
  }

  drawCursor(f) {
    const ctx = this.ctx;
    const p = this.px(f.cursor);
    const pinching = f.pinching;
    const radius = pinching ? 5 : 9;

    ctx.save();
    ctx.shadowColor = pinching ? '#ff3df0' : '#38f0ff';
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = pinching ? 'rgba(255, 61, 240, 0.95)' : 'rgba(56, 240, 255, 0.9)';
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius + 7, 0, Math.PI * 2);
    ctx.strokeStyle = pinching ? 'rgba(255, 61, 240, 0.45)' : 'rgba(56, 240, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  drawRing(ring, color, alpha = 1, progress = 0) {
    const ctx = this.ctx;
    const { x, y, radius } = ring;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    if (progress > 0) {
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, radius + 5, -Math.PI / 2, -Math.PI / 2 + clamp01(progress) * Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
