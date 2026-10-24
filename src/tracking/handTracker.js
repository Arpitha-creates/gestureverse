/**
 * GestureVerse - MediaPipe hand tracking.
 *
 * Wraps the MediaPipe Tasks Vision HandLandmarker: camera acquisition,
 * permission handling, the detection loop, and graceful failure. Emits raw
 * normalized landmarks; all interpretation lives in the gesture module.
 *
 * Detection runs in the requestAnimationFrame loop, but the renderer is never
 * blocked on it - the loop reads the most recent result and keeps drawing.
 */

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class TrackingError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'TrackingError';
    this.kind = kind; // 'permission' | 'no-camera' | 'model' | 'unknown'
  }
}

export class HandTracker {
  constructor(config) {
    this.config = config;
    this.landmarker = null;
    this.video = null;
    this.stream = null;
    this.running = false;
    this.lastResult = null;
    this.lastVideoTime = -1;
    this.frameCount = 0;
    this.fps = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._rafId = null;
    this.onResult = null;
    this.onError = null;
  }

  /** Create the landmarker. Safe to call once; repeated calls are no-ops. */
  async init({ wasmRoot = WASM_ROOT, modelUrl = MODEL_URL } = {}) {
    if (this.landmarker) return this.landmarker;
    const t = this.config.tracking;
    try {
      const fileset = await FilesetResolver.forVisionTasks(wasmRoot);
      const options = {
        baseOptions: { modelAssetPath: modelUrl, delegate: t.delegate },
        runningMode: 'VIDEO',
        numHands: t.numHands,
        minHandDetectionConfidence: t.minDetectionConfidence,
        minHandPresenceConfidence: t.minPresenceConfidence,
        minTrackingConfidence: t.minTrackingConfidence,
      };
      try {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
      } catch (gpuErr) {
        // GPU delegate is unavailable on some drivers; fall back to CPU.
        console.warn('[GestureVerse] GPU delegate failed, retrying on CPU:', gpuErr);
        this.landmarker = await HandLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
        });
      }
      return this.landmarker;
    } catch (err) {
      throw new TrackingError(
        `Could not load the hand-tracking model. Check your network connection, or place the model file in assets/ and point config at it. (${err.message})`,
        'model',
      );
    }
  }

  /** Acquire the webcam and start the detection loop. */
  async start(videoEl, { onResult, onError } = {}) {
    this.video = videoEl;
    this.onResult = onResult || null;
    this.onError = onError || null;

    await this.init();

    const cam = this.config.camera;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: cam.width },
          height: { ideal: cam.height },
          frameRate: { ideal: cam.fps },
          facingMode: cam.facingMode,
        },
        audio: false,
      });
    } catch (err) {
      const kind =
        err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
          ? 'permission'
          : 'no-camera';
      throw new TrackingError(
        kind === 'permission'
          ? 'Camera access was blocked. Allow camera permission in your browser and reload.'
          : `No usable camera was found. (${err && err.name ? err.name : 'unknown error'})`,
        kind,
      );
    }

    videoEl.srcObject = this.stream;
    videoEl.setAttribute('playsinline', '');
    videoEl.muted = true;
    await videoEl.play();

    this.running = true;
    this._loop();
    return true;
  }

  stop() {
    this.running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  }

  /** Release the MediaPipe resources entirely. */
  dispose() {
    this.stop();
    if (this.landmarker) {
      try {
        this.landmarker.close();
      } catch {
        /* already closed */
      }
      this.landmarker = null;
    }
  }

  _loop() {
    if (!this.running) return;
    this._rafId = requestAnimationFrame(() => this._loop());

    const video = this.video;
    if (!video || video.readyState < 2 || !this.landmarker) return;

    // Skip inference on the configured cadence to save CPU/GPU.
    this.frameCount++;
    if (this.frameCount % this.config.performance.trackingEveryNthFrame !== 0) {
      if (this.lastResult && this.onResult) this.onResult(this.lastResult, this.stats());
      return;
    }

    // MediaPipe needs a strictly increasing timestamp, and rejects a repeated
    // video frame, so gate on currentTime changing.
    if (video.currentTime === this.lastVideoTime) {
      if (this.lastResult && this.onResult) this.onResult(this.lastResult, this.stats());
      return;
    }
    this.lastVideoTime = video.currentTime;

    const now = performance.now();
    this._tickFps(now);

    let result;
    try {
      result = this.landmarker.detectForVideo(video, now);
    } catch (err) {
      // A single bad frame should never kill the session.
      console.warn('[GestureVerse] detection frame failed:', err);
      return;
    }

    this.lastResult = result;
    if (this.onResult) this.onResult(result, this.stats());
  }

  _tickFps(now) {
    if (this._lastTick === undefined) this._lastTick = now;
    this._fpsFrames++;
    if (now - this._lastTick >= 500) {
      this.fps = Math.round((this._fpsFrames * 1000) / (now - this._lastTick));
      this._lastTick = now;
      this._fpsFrames = 0;
    }
  }

  stats() {
    return { fps: this.fps, running: this.running };
  }

  /**
   * Convert a MediaPipe result into a simple array of hands.
   * @returns {Array<{landmarks:Array, handedness:string}>}
   */
  static toHands(result) {
    if (!result || !result.landmarks || !result.landmarks.length) return [];
    return result.landmarks.map((landmarks, i) => {
      let handedness = null;
      const h = result.handedness && result.handedness[i];
      if (h && h.length) handedness = h[0].categoryName || null;
      return { landmarks, handedness };
    });
  }
}
