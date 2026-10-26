/**
 * Collects fingertip positions into a stroke.
 *
 * Points are already in world space when they arrive, so a finished stroke is
 * resolution independent and survives a window resize or camera change.
 */

import { smoothPolyline, simplifyRDP } from '../core/util.js';

export class StrokeBuilder {
  constructor(config) {
    this.config = config;
    this.points = [];
    this.active = false;
    this.color = null;
    this.width = null;
  }

  begin(point, { color, width }) {
    this.points = [{ x: point.x, y: point.y, z: point.z || 0 }];
    this.active = true;
    this.color = color;
    this.width = width;
    return true;
  }

  /** @returns {boolean} true when the point was actually appended. */
  add(point) {
    if (!this.active) return false;
    const last = this.points[this.points.length - 1];
    // Reject micro-jitter: without this a held-still finger builds thousands of
    // near-identical points and the tube geometry explodes.
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < this.config.draw.minStep) {
      return false;
    }
    if (this.points.length >= this.config.draw.maxPoints) return false;
    this.points.push({ x: point.x, y: point.y, z: point.z || 0 });
    return true;
  }

  /**
   * Close the stroke.
   * @returns {{points:Array,color:string,width:number}|null} null if too short
   */
  end() {
    this.active = false;
    const pts = this.points;
    this.points = [];
    if (pts.length < 2) return null;
    let length = 0;
    for (let i = 1; i < pts.length; i++) {
      length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }

    // Judge the stroke by how far it actually spans, not by how far the pen
    // travelled. A hand held still under noise accumulates plenty of path
    // length while covering no ground - that is a blob, not a drawing.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const extent = Math.hypot(maxX - minX, maxY - minY);
    if (extent < this.config.draw.minExtent) return null;

    // Clean up before this becomes artwork. The live filter cannot remove every
    // last wobble without making the pen feel laggy, so the committed stroke is
    // smoothed and simplified here instead. This is what makes a drawn shape
    // hold its shape.
    const draw = this.config.draw;
    let clean = smoothPolyline(pts, draw.smoothPasses, draw.smoothWeight);
    clean = simplifyRDP(clean, draw.simplifyTolerance);
    if (clean.length < 2) clean = pts;

    return { points: clean, color: this.color, width: this.width, length };
  }

  cancel() {
    this.points = [];
    this.active = false;
  }
}
