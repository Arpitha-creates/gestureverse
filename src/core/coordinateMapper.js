/**
 * GestureVerse - coordinate mapping.
 *
 * Turns MediaPipe's normalized image-space landmarks into (a) canvas pixels
 * for the 2D drawing surface and (b) world units for the 3D scene.
 *
 * Mirroring is handled in exactly one place here. Because the recognizer
 * always emits *raw image* coordinates, the mirror flag is applied on the way
 * out and never twice - that is what keeps object movement from reversing.
 */

import { clamp, clamp01, lerp, remap } from './math.js';

export class CoordinateMapper {
  constructor(config) {
    this.config = config;
    this.viewport = { width: 1, height: 1 };
  }

  setViewport(width, height) {
    this.viewport.width = Math.max(1, width);
    this.viewport.height = Math.max(1, height);
  }

  /** Apply mirroring to a raw normalized x. */
  applyMirror(nx) {
    return this.config.mirror ? 1 - nx : nx;
  }

  /**
   * Raw normalized image coords -> canvas pixels (CSS pixels of the overlay).
   * @param {{x:number,y:number}} n
   */
  toCanvas(n) {
    const { width, height } = this.viewport;
    const x = clamp01(this.applyMirror(n.x)) * width;
    const y = clamp01(n.y) * height;
    return { x, y };
  }

  /**
   * Raw normalized image coords -> 2D canvas coords inside a padded rect,
   * so the drawing area does not run under the UI chrome.
   * @param {{x:number,y:number}} n
   * @param {{x:number,y:number,width:number,height:number}} rect
   */
  toCanvasInRect(n, rect) {
    const m = this.config.world.margin;
    const x = remap(this.applyMirror(n.x), m, 1 - m, rect.x, rect.x + rect.width);
    const y = remap(n.y, m, 1 - m, rect.y, rect.y + rect.height);
    return { x, y };
  }

  /**
   * Estimate a depth value in [0,1] (0 = far, 1 = near) from hand size.
   * A hand closer to the camera occupies more of the frame, so its normalized
   * scale is larger. This is far more stable than MediaPipe's z estimate.
   * @param {number} handScale wrist->middleMCP distance in normalized units
   */
  depthFromHandScale(handScale) {
    const { sizeReference, sizeGain } = this.config.world;
    const ratio = handScale / Math.max(sizeReference, 1e-6);
    // ratio 1.0 -> mid depth (0.5)
    return clamp01(0.5 + (ratio - 1) * 0.5 * sizeGain * 0.5);
  }

  /**
   * Raw normalized coords + depth -> world position.
   * @param {{x:number,y:number,z?:number}} n
   * @param {number} handScale
   */
  toWorld(n, handScale) {
    const w = this.config.world;
    const m = w.margin;
    const x = remap(this.applyMirror(n.x), m, 1 - m, -w.width / 2 + w.wallPadding, w.width / 2 - w.wallPadding);
    // Image y grows downward, world y grows upward.
    const y = remap(n.y, m, 1 - m, w.height / 2 - w.wallPadding, -w.height / 2 + w.wallPadding);

    let depth01;
    if (w.depthFromSize && typeof handScale === 'number') {
      depth01 = this.depthFromHandScale(handScale);
    } else {
      depth01 = clamp01(0.5 - (n.z || 0) * 6);
    }
    const z = lerp(-w.depth / 2 + w.wallPadding, w.depth / 2 - w.wallPadding, depth01);

    return { x, y, z, depth01 };
  }

  /** World position -> normalized image coords (for drawing the overlay). */
  worldToNormalized(p) {
    const w = this.config.world;
    const m = w.margin;
    let nx = remap(p.x, -w.width / 2 + w.wallPadding, w.width / 2 - w.wallPadding, m, 1 - m);
    const ny = remap(p.y, w.height / 2 - w.wallPadding, -w.height / 2 + w.wallPadding, m, 1 - m);
    if (this.config.mirror) nx = 1 - nx;
    return { x: clamp01(nx), y: clamp01(ny) };
  }

  /** Keep a world point inside the interaction volume. */
  clampToWorld(p, inset = 0) {
    const w = this.config.world;
    return {
      x: clamp(p.x, -w.width / 2 + inset, w.width / 2 - inset),
      y: clamp(p.y, w.floorY + inset, w.height / 2 - inset),
      z: clamp(p.z, -w.depth / 2 + inset, w.depth / 2 - inset),
    };
  }
}
