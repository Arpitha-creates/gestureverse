/**
 * Collects fingertip positions into a stroke.
 *
 * Points are already in world space when they arrive, so a finished stroke is
 * resolution independent and survives a window resize or camera change.
 */

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
    if (length < this.config.draw.minLength) return null;
    return { points: pts, color: this.color, width: this.width, length };
  }

  cancel() {
    this.points = [];
    this.active = false;
  }
}
