/**
 * GestureVerse - hand landmark geometry.
 *
 * Pure functions over the 21 MediaPipe hand landmarks. Nothing here touches
 * the DOM or the renderer, so it is fully unit-testable.
 *
 * Landmark index map (MediaPipe Hands):
 *   0  wrist
 *   1..4   thumb  (CMC, MCP, IP, TIP)
 *   5..8   index  (MCP, PIP, DIP, TIP)
 *   9..12  middle
 *   13..16 ring
 *   17..20 pinky
 */

import { angleAt, clamp01, dist2, dist3, remap, mean } from '../core/math.js';

export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
};

/** [mcp, pip, dip, tip] per finger. The thumb chain is CMC/MCP/IP/TIP. */
export const FINGER_JOINTS = {
  thumb: [LM.THUMB_CMC, LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP],
  index: [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
  middle: [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  ring: [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
  pinky: [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
};

export const FINGER_TIPS = {
  thumb: LM.THUMB_TIP,
  index: LM.INDEX_TIP,
  middle: LM.MIDDLE_TIP,
  ring: LM.RING_TIP,
  pinky: LM.PINKY_TIP,
};

/** Reference scale: wrist -> middle-finger MCP. Rotation/zoom invariant-ish. */
export function handScale(landmarks) {
  return Math.max(dist2(
    landmarks[LM.WRIST].x,
    landmarks[LM.WRIST].y,
    landmarks[LM.MIDDLE_MCP].x,
    landmarks[LM.MIDDLE_MCP].y,
  ), 1e-6);
}

/**
 * Joint "straightness" in degrees for one finger (180 = perfectly straight).
 * For the four long fingers we take the mean of the PIP and DIP angles; for
 * the thumb we blend the IP and MCP angles, which is the only reliable pair
 * given the thumb's different bone layout.
 */
export function fingerAngle(landmarks, finger) {
  const [mcp, pip, dip, tip] = FINGER_JOINTS[finger];
  if (finger === 'thumb') {
    const atIp = angleAt(landmarks[mcp], landmarks[pip], landmarks[tip]);
    const atMcp = angleAt(landmarks[LM.THUMB_CMC], landmarks[mcp], landmarks[tip]);
    return (atIp + atMcp) / 2;
  }
  const atPip = angleAt(landmarks[mcp], landmarks[pip], landmarks[tip]);
  const atDip = angleAt(landmarks[pip], landmarks[dip], landmarks[tip]);
  return (atPip + atDip) / 2;
}

/**
 * Continuous extension score in [0,1] per finger.
 * 0 = fully curled, 1 = fully extended.
 */
export function fingerExtension(landmarks, finger, cfg) {
  const { curledAngle, extendedAngle } = cfg.gestures;
  const a = fingerAngle(landmarks, finger);
  return clamp01(remap(a, curledAngle, extendedAngle, 0, 1));
}

/** All five extension scores plus booleans. */
export function handMetrics(landmarks, cfg) {
  const scale = handScale(landmarks);
  const ext = {
    thumb: fingerExtension(landmarks, 'thumb', cfg),
    index: fingerExtension(landmarks, 'index', cfg),
    middle: fingerExtension(landmarks, 'middle', cfg),
    ring: fingerExtension(landmarks, 'ring', cfg),
    pinky: fingerExtension(landmarks, 'pinky', cfg),
  };

  const indexTip = landmarks[LM.INDEX_TIP];
  const thumbTip = landmarks[LM.THUMB_TIP];

  // Pinch is measured relative to hand size so it works at any distance.
  const pinchRatio = dist2(thumbTip.x, thumbTip.y, indexTip.x, indexTip.y) / scale;

  // Cursor: the index fingertip. When the user pinches, the thumb and index
  // tips coincide, so this stays continuous through a grab.
  const cursor = { x: indexTip.x, y: indexTip.y, z: indexTip.z || 0 };

  // Pinch point: midpoint of the two tips. Slightly nicer feel for dragging.
  const pinchPoint = {
    x: (thumbTip.x + indexTip.x) / 2,
    y: (thumbTip.y + indexTip.y) / 2,
    z: ((thumbTip.z || 0) + (indexTip.z || 0)) / 2,
  };

  const longFingers = [ext.index, ext.middle, ext.ring, ext.pinky];

  return {
    scale,
    extensions: ext,
    pinchRatio,
    cursor,
    pinchPoint,
    openness: mean(longFingers),
    extendedCount: longFingers.filter((v) => v > 0.6).length,
    curledCount: longFingers.filter((v) => v < 0.4).length,
    palmCenter: palmCenter(landmarks),
  };
}

export function palmCenter(landmarks) {
  const ids = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const i of ids) {
    x += landmarks[i].x;
    y += landmarks[i].y;
    z += landmarks[i].z || 0;
  }
  return { x: x / ids.length, y: y / ids.length, z: z / ids.length };
}

/** Euclidean distance between two landmarks in 3D. */
export function landmarkDistance(landmarks, a, b) {
  return dist3(landmarks[a], landmarks[b]);
}

/** How "open palm"-like a hand is, 0..1. Used by the UI for feedback. */
export function opennessScore(landmarks, cfg) {
  const m = handMetrics(landmarks, cfg);
  return m.openness;
}
