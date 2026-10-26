/**
 * Turns 21 raw MediaPipe landmarks into the handful of numbers the rest of the
 * app cares about. Pure functions only - no DOM, no timers - so it is testable
 * in plain node.
 */

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

/** Skeleton edges for the overlay. */
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const FINGER_JOINTS = {
  index: [INDEX_PIP, INDEX_TIP],
  middle: [MIDDLE_PIP, MIDDLE_TIP],
  ring: [RING_PIP, RING_TIP],
  pinky: [PINKY_PIP, PINKY_TIP],
};

/**
 * The webcam preview is mirrored so it behaves like a mirror. Landmarks come
 * back in unmirrored image space, so flip x once here and every downstream
 * consumer agrees with what the user sees.
 */
export function mirrorLandmarks(landmarks) {
  return landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z || 0 }));
}

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * @param {Array<{x:number,y:number,z:number}>} rawLandmarks 21 points
 * @param {object} config CONFIG
 */
export function analyzeHand(rawLandmarks, config) {
  if (!rawLandmarks || rawLandmarks.length < 21) return null;
  const lm = mirrorLandmarks(rawLandmarks);
  const wrist = lm[WRIST];

  // Palm size is the scale reference. Averaging three spans makes it far less
  // jumpy than any single bone, which matters because every threshold below is
  // expressed relative to it.
  const palmSize = Math.max(
    1e-4,
    (d2(wrist, lm[INDEX_MCP]) + d2(wrist, lm[PINKY_MCP]) + d2(lm[INDEX_MCP], lm[PINKY_MCP])) / 3,
  );

  const ratio = config.gesture.extendRatio;
  const extended = {};
  for (const [name, [pip, tip]] of Object.entries(FINGER_JOINTS)) {
    // Compare tip-to-wrist against pip-to-wrist: a curled finger folds its tip
    // back toward the palm, so the ratio collapses well under 1.
    extended[name] = d2(lm[tip], wrist) > d2(lm[pip], wrist) * ratio;
  }

  const pinchDist = d2(lm[THUMB_TIP], lm[INDEX_TIP]);
  const pinchRatio = pinchDist / palmSize;
  // How far the index tip is held from the wrist, in palm units. A fist folds
  // it back toward the palm (well under 1); a real pinch holds it out front.
  const indexReach = d2(lm[INDEX_TIP], wrist) / palmSize;

  const tip = { x: lm[INDEX_TIP].x, y: lm[INDEX_TIP].y, z: lm[INDEX_TIP].z };
  const thumbTip = { x: lm[THUMB_TIP].x, y: lm[THUMB_TIP].y, z: lm[THUMB_TIP].z };
  const pinch = {
    x: (tip.x + thumbTip.x) / 2,
    y: (tip.y + thumbTip.y) / 2,
    z: (tip.z + thumbTip.z) / 2,
  };

  const palmIds = [WRIST, INDEX_MCP, MIDDLE_MCP, 13, PINKY_MCP];
  const palm = { x: 0, y: 0, z: 0 };
  for (const id of palmIds) {
    palm.x += lm[id].x;
    palm.y += lm[id].y;
    palm.z += lm[id].z;
  }
  palm.x /= palmIds.length;
  palm.y /= palmIds.length;
  palm.z /= palmIds.length;

  const extendedCount = Object.values(extended).filter(Boolean).length;

  return {
    landmarks: lm,
    palmSize,
    extended,
    extendedCount,
    pinchRatio,
    pinchDistance: pinchDist,
    indexReach,
    tip,
    thumbTip,
    pinch,
    palm,
    // Relative depth of the hand, normalised by hand size so it does not change
    // when the user leans in or out.
    depth: lm[MIDDLE_MCP].z / palmSize,
  };
}

/** Cheap helper for drawing: the index finger chain, wrist to tip. */
export function indexChain(pose) {
  return pose ? [0, 5, 6, 7, 8].map((i) => pose.landmarks[i]) : [];
}
