/**
 * Builds synthetic 21-landmark hands so the gesture logic can be tested
 * deterministically without a camera.
 *
 * `bend` is the per-finger joint bend in degrees:
 *   0  -> perfectly straight (extension 1.0)
 *   90 -> strongly curled   (extension 0.0)
 *   45 -> genuinely ambiguous, which classifies as the neutral 'none' state
 */

import { LM } from '../../src/gestures/landmarks.js';

function rot(v, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function norm(v) {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

const FINGERS = [
  { name: 'thumb', ids: [LM.THUMB_CMC, LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP], offset: { x: -0.1, y: -0.04 }, lens: [0.04, 0.035, 0.03] },
  { name: 'index', ids: [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP], offset: { x: -0.065, y: -0.145 }, lens: [0.055, 0.038, 0.03] },
  { name: 'middle', ids: [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP], offset: { x: -0.005, y: -0.16 }, lens: [0.06, 0.042, 0.032] },
  { name: 'ring', ids: [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP], offset: { x: 0.05, y: -0.15 }, lens: [0.055, 0.038, 0.03] },
  { name: 'pinky', ids: [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP], offset: { x: 0.1, y: -0.115 }, lens: [0.045, 0.03, 0.026] },
];

export function makeHand({
  bend = {},
  pinchRatio = 1.15,
  origin = { x: 0.5, y: 0.86 },
  handedness = 'Right',
} = {}) {
  const lm = [];
  for (let i = 0; i < 21; i++) lm.push({ x: 0, y: 0, z: 0 });
  lm[LM.WRIST] = { x: origin.x, y: origin.y, z: 0 };

  for (const f of FINGERS) {
    const b = bend[f.name] ?? 0;
    const base = { x: origin.x + f.offset.x, y: origin.y + f.offset.y };
    const d1 = norm(f.offset);
    const d2 = rot(d1, b);
    const d3 = rot(d2, b);
    const [L1, L2, L3] = f.lens;
    const p0 = base;
    const p1 = { x: p0.x + d1.x * L1, y: p0.y + d1.y * L1 };
    const p2 = { x: p1.x + d2.x * L2, y: p1.y + d2.y * L2 };
    const p3 = { x: p2.x + d3.x * L3, y: p2.y + d3.y * L3 };
    const pts = [p0, p1, p2, p3];
    f.ids.forEach((id, i) => {
      lm[id] = { x: pts[i].x, y: pts[i].y, z: 0 };
    });
  }

  // Place the thumb tip at exactly `pinchRatio * handScale` from the index tip
  // so pinch behaviour is directly controllable.
  const scale = Math.hypot(
    lm[LM.MIDDLE_MCP].x - lm[LM.WRIST].x,
    lm[LM.MIDDLE_MCP].y - lm[LM.WRIST].y,
  );
  const idxTip = lm[LM.INDEX_TIP];
  const target = pinchRatio * scale;
  const away = norm({ x: lm[LM.THUMB_MCP].x - idxTip.x, y: lm[LM.THUMB_MCP].y - idxTip.y });
  lm[LM.THUMB_TIP] = {
    x: idxTip.x + away.x * target,
    y: idxTip.y + away.y * target,
    z: 0,
  };

  return { landmarks: lm, handedness };
}

/** Finger bend presets used across the tests. */
export const BEND = {
  straight: 0,
  curled: 90,
  neutral: 45,
};
