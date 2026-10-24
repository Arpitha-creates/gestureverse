/**
 * GestureVerse - central, runtime-tunable configuration.
 *
 * Every threshold that governs gesture behaviour lives here so that a demo
 * operator can adjust sensitivity without touching algorithm code. The UI
 * writes into `config` live; modules read from the same object.
 */

export const DEFAULT_CONFIG = {
  /** Master toggles -------------------------------------------------- */
  mirror: true, // mirror the camera feed so movement feels natural
  showCamera: true, // hide for public "virtual scene only" demos
  handedness: 'any', // 'any' | 'left' | 'right'
  throwEnabled: true, // disable for kids / controlled demos

  /** Camera ---------------------------------------------------------- */
  // 960x540 rather than 720p: MediaPipe's cost scales with input pixels, and
  // the extra resolution buys nothing for hand landmarks. This is the single
  // biggest frame-rate win available.
  camera: {
    width: 960,
    height: 540,
    fps: 60,
    facingMode: 'user',
  },

  /** Tracking -------------------------------------------------------- */
  tracking: {
    minDetectionConfidence: 0.6,
    minPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
    numHands: 2,
    delegate: 'GPU', // falls back to CPU automatically
    // One Euro filter parameters for the fingertip cursor.
    // NOTE ON UNITS: beta is speed-coupled, so it must be tuned to the units
    // of the signal. Landmarks are normalized (0..1), where a brisk hand move
    // is only a few units per second - far smaller than pixel-space speeds.
    // A pixel-tuned beta (~0.007) would make the cursor feel frozen here.
    smoothing: { minCutoff: 1.5, beta: 0.6, dCutoff: 1.0 },
    // Reject landmarks that jump further than this per frame (normalized units)
    maxJump: 0.35,
    lostTimeoutMs: 350, // hand considered lost after this gap
  },

  /** Gesture recognition -------------------------------------------- */
  gestures: {
    // Pinch = distance(thumbTip, indexTip) / handScale.
    // Activation threshold is stricter than release to avoid flicker.
    pinchOn: 0.42,
    pinchOff: 0.6,
    pinchConfirmFrames: 2,
    pinchReleaseFrames: 1,

    // Finger extension uses the joint angle at the PIP. >= extendedAngle
    // means "straight enough to count as extended".
    extendedAngle: 150,
    curledAngle: 100,
    extensionConfirmFrames: 2,

    // Open palm / fist need to be held a moment before they fire.
    palmConfirmFrames: 6,
    fistConfirmFrames: 6,

    // Milliseconds a gesture stays locked out after firing.
    cooldownMs: 350,
    fistCooldownMs: 1200, // fists are destructive-ish: extra slow

    // Neutral dead-band: below this the recognizer reports 'none'
    minConfidence: 0.5,
  },

  /** Two-hand scale / rotate ---------------------------------------- */
  twoHand: {
    minSeparation: 0.08, // normalized; below this the pair is ignored
    scaleGain: 1.0,
    rotateGain: 1.0,
    smoothing: 0.25, // 0 = frozen, 1 = raw
    confirmFrames: 4,
  },

  /** Drawing --------------------------------------------------------- */
  drawing: {
    minPointDistance: 0.004, // normalized; drop jitter points closer than this
    maxPointsPerStroke: 4000,
    defaultColor: '#22d3ee',
    defaultWidth: 6,
    palette: [
      '#22d3ee', '#38bdf8', '#a78bfa', '#e879f9',
      '#f472b6', '#facc15', '#4ade80', '#f8fafc',
    ],
    brushSizes: [3, 6, 10, 16],
    // Shape recognition
    shape: {
      minPoints: 10,
      closednessRatio: 0.28, // end/start gap relative to bbox diagonal
      simplifyRatio: 0.035, // RDP epsilon relative to bbox diagonal
      // A square scores 0.785 and a circle ~0.99, so the circle test also
      // requires >= 6 simplified vertices to avoid swallowing quadrilaterals.
      circleCircularity: 0.84,
      // A 2:1 ellipse only scores ~0.79, so ellipses get a looser bound.
      ellipseCircularity: 0.62,
      starMinPoints: 5,
      minConfidence: 0.55,
    },
  },

  /** Virtual world --------------------------------------------------- */
  world: {
    width: 9, // x span
    height: 5.4, // y span
    depth: 7, // z span
    floorY: -2.7,
    wallPadding: 0.4,
    // Hand -> world mapping
    margin: 0.12, // fraction of the frame treated as dead space at the edges
    depthFromSize: true, // use hand size for depth when true, else landmark z
    sizeReference: 0.16, // hand scale that maps to the mid-depth plane
    sizeGain: 2.2, // how strongly hand size modulates depth
    pointerRadius: 0.16, // world units, cursor sphere
  },

  /** Objects --------------------------------------------------------- */
  objects: {
    grabRadius: 0.55, // world units: how close the cursor must be to select
    hoverRadius: 0.9,
    followStiffness: 14, // spring constant for held objects
    followDamping: 8,
    gravity: -9.8,
    restitution: 0.45, // bounce
    friction: 0.86, // tangential damping on floor contact
    linearDamping: 0.12, // air drag per second
    restSpeed: 0.35, // below this a resting object stops
    throwMinSpeed: 2.6, // hand speed (world units/s) required to throw
    throwGain: 1.35,
    minScale: 0.35,
    maxScale: 3.2,
    sampleObjects: 4, // seeded at startup in Creative Playground
  },

  /** Effects --------------------------------------------------------- */
  effects: {
    particles: 500,
    trailLength: 42,
    glow: true,
    sound: false,
  },

  /** Performance ----------------------------------------------------- */
  performance: {
    targetFps: 60,
    trackingEveryNthFrame: 1, // raise to 2 to halve inference cost
    // Render at 1.5x device pixels rather than 2x. On a retina display this
    // roughly halves the fragment work with almost no visible difference at
    // the distances people actually view this from.
    pixelRatioCap: 1.5,
    // Automatically drop to every-other-frame detection if the frame rate
    // sags, and restore it when there is headroom again.
    adaptive: true,
  },
};

/** Deep clone helper so presets never mutate the defaults. */
export function cloneConfig(cfg = DEFAULT_CONFIG) {
  return JSON.parse(JSON.stringify(cfg));
}

/** Create a live config object, optionally overriding defaults. */
export function createConfig(overrides = {}) {
  const cfg = cloneConfig();
  return deepMerge(cfg, overrides);
}

export function deepMerge(target, source) {
  for (const key of Object.keys(source || {})) {
    const sv = source[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
      target[key] = deepMerge(target[key] || {}, sv);
    } else {
      target[key] = Array.isArray(sv) ? sv.slice() : sv;
    }
  }
  return target;
}

/** Sensitivity presets surfaced in the calibration screen. */
export const PRESETS = {
  relaxed: {
    gestures: { pinchOn: 0.5, pinchOff: 0.68, pinchConfirmFrames: 3 },
    tracking: { smoothing: { minCutoff: 1.0, beta: 0.3, dCutoff: 1.0 } },
  },
  balanced: {},
  responsive: {
    gestures: { pinchOn: 0.36, pinchOff: 0.52, pinchConfirmFrames: 1 },
    tracking: { smoothing: { minCutoff: 2.5, beta: 0.9, dCutoff: 1.0 } },
  },
};
