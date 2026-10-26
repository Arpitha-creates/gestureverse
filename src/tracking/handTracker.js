/**
 * Camera + MediaPipe Hand Landmarker.
 *
 * All processing stays in the browser: the video never leaves the page and no
 * frame is uploaded anywhere.
 */

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

export class HandTracker {
  constructor(config) {
    this.config = config;
    this.landmarker = null;
    this.video = null;
    this.stream = null;
    this.ready = false;
    this.lastError = null;
    this._lastTs = 0;
    this._last = [];
    this.delegate = null;
  }

  async start(video) {
    this.video = video;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('This browser cannot access the camera. Try Chrome, Edge or Safari on https:// or localhost.');
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: this.config.camera.width,
          height: this.config.camera.height,
          facingMode: 'user',
        },
        audio: false,
      });
    } catch (err) {
      const name = err && err.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new Error('Camera permission was denied. Allow camera access in your browser, then reload.');
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw new Error('No camera was found. Plug one in or pick another device, then reload.');
      }
      throw new Error(`Camera could not start (${name || 'unknown error'}).`);
    }

    video.srcObject = this.stream;
    await new Promise((resolve) => {
      if (video.readyState >= 2) return resolve();
      video.onloadedmetadata = () => resolve();
      setTimeout(resolve, 4000);
    });
    try {
      await video.play();
    } catch {
      /* autoplay may be blocked; the stream is still live */
    }

    await this.loadModel();
    this.ready = true;
    return true;
  }

  async loadModel() {
    const cfg = this.config.tracking;
    const fileset = await FilesetResolver.forVisionTasks(cfg.wasmUrl);

    const build = (delegate) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: cfg.modelUrl, delegate },
        runningMode: 'VIDEO',
        numHands: cfg.numHands,
        minHandDetectionConfidence: cfg.minHandDetectionConfidence,
        minHandPresenceConfidence: cfg.minHandPresenceConfidence,
        minTrackingConfidence: cfg.minTrackingConfidence,
      });

    try {
      this.landmarker = await build('GPU');
      this.delegate = 'GPU';
    } catch {
      // GPU delegate is unavailable on plenty of machines; CPU is slower but
      // always works, and silently falling back beats a dead app.
      this.landmarker = await build('CPU');
      this.delegate = 'CPU';
    }
  }

  /** @returns {Array<{landmarks:Array,handedness:string|null}>} */
  detect(nowMs) {
    if (!this.landmarker || !this.video || this.video.readyState < 2) return [];
    const ts = Math.max(this._lastTs + 1, Math.round(nowMs));
    this._lastTs = ts;

    let result;
    try {
      result = this.landmarker.detectForVideo(this.video, ts);
    } catch (err) {
      this.lastError = err;
      return this._last;
    }

    const landmarks = result.landmarks || [];
    const handedness = result.handednesses || result.handedness || [];
    const hands = [];
    for (let i = 0; i < landmarks.length; i++) {
      const cat = handedness[i] && handedness[i][0] ? handedness[i][0] : null;
      hands.push({
        landmarks: landmarks[i],
        handedness: cat ? cat.categoryName : null,
        score: cat ? cat.score : 0,
      });
    }
    this._last = hands;
    return hands;
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
    this.ready = false;
    this._last = [];
  }
}
