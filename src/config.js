/**
 * GestureVerse - the single tuning table.
 *
 * Every magic number lives here so behaviour can be adjusted without touching
 * logic. Values are tuned for a 30-60 fps webcam feed at arm's length.
 *
 * A note on units, because mixing them is the easiest bug to write here:
 *   - landmark / cursor values are NORMALISED screen units (0..1)
 *   - stroke and object values are WORLD units (roughly a 12 x 7 space)
 *   - every duration is in MILLISECONDS
 */
export const CONFIG = {
  version: '2.0.0',

  camera: { width: { ideal: 1280 }, height: { ideal: 720 } },

  tracking: {
    modelUrl:
      'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    wasmUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  },

  // One Euro filter settings: heavy smoothing when slow, almost none when fast.
  // `pen` smooths the drawing tip hardest - a shaky line is the worst failure
  // mode this app has - while `grab` keeps the pinch point snappy.
  smoothing: {
    pen: { minCutoff: 2.6, beta: 0.1, dCutoff: 1.0 },
    grab: { minCutoff: 5.0, beta: 0.05, dCutoff: 1.0 },
  },

  gesture: {
    // A finger counts as extended when tip-to-wrist is this much longer than
    // pip-to-wrist. Scale invariant, so it works near or far from the camera.
    extendRatio: 1.16,
    // Pinch hysteresis: engages below `on`, releases above `off`. The gap is
    // what stops a held pinch chattering on and off.
    pinchOn: 0.42,
    pinchOff: 0.66,
    // A pinch only counts when the index tip is held out in front of the palm.
    // Without this a closed fist reads as a pinch, because in a fist the thumb
    // and index tips are already touching.
    pinchMinReach: 1.15,
    pinchConfirmFrames: 2,
    pinchReleaseFrames: 2,
    // Frames of agreement before a posture is committed.
    pointConfirmFrames: 3,
    fistConfirmFrames: 4,
    palmConfirmFrames: 4,
    // Frames of agreement before leaving a posture. Without this a single
    // noisy frame ends the current stroke mid-line.
    idleConfirmFrames: 5,
    // A fingertip jump larger than this (normalised units) in one frame is
    // treated as a tracking glitch rather than a movement.
    maxJump: 0.28,
    // Deliberate actions: how long a posture must be held to count.
    deleteHoldMs: 900,
    palmHoldMs: 1500,
  },

  twoHand: {
    // Both hands must be pinching at once. If one drops out, the grab survives
    // this long before releasing - long enough to ride out a tracking blip,
    // short enough that nothing ever feels stuck.
    exitGraceMs: 300,
    minScale: 0.35,
    maxScale: 2.8,
    // MediaPipe z is small and noisy; this scales it into world depth units.
    depthRange: 1.8,
    // Hard safety: no grab may outlive this, ever.
    maxHoldMs: 120000,
  },

  grab: {
    // Picking happens in screen space, so depth never makes a target
    // unpickable. This is the extra reach beyond the drawing's own radius.
    radiusPx: 190,
  },

  draw: {
    // World units. Below `minStep` the fingertip counts as stationary, so a
    // held hand does not scribble. ~5px on a 1000px-tall viewport, which is
    // just above the residual noise the pen filter leaves behind.
    minStep: 0.022,
    // A stroke must span at least this much (bounding-box diagonal, world
    // units) to count as a drawing. This is what stops a held hand scribbling.
    minExtent: 0.35,
    minLength: 0.3,
    maxPoints: 1200,
    // Cleanup applied to a finished stroke: Laplacian passes, then simplification.
    smoothPasses: 2,
    smoothWeight: 0.25,
    simplifyTolerance: 0.008,
    // Oldest drawings are recycled past this, to keep the GPU honest.
    maxDrawings: 60,
  },

  colors: ['#38f0ff', '#ff3df0', '#a6ff3d', '#ffd93d', '#ff6b3d', '#ffffff'],
};

export default CONFIG;
