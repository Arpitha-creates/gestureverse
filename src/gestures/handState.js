/**
 * One gesture state machine per hand.
 *
 * Feed it a pose (or null when the hand is gone) once per frame; it returns the
 * committed state. Two mechanisms keep it from flickering:
 *
 *   1. Hysteresis on the pinch ratio - it engages low and releases high, so a
 *      held pinch never chatters.
 *   2. Temporal confirmation on every other posture - a state only commits
 *      after N consecutive frames agree.
 *
 * This module decides *what the hand is doing*. It never touches objects,
 * strokes or the DOM.
 */

import { HandStateName } from './states.js';

const { LOST, IDLE, POINT, PINCH, FIST, PALM } = HandStateName;

export class HandState {
  constructor(config) {
    this.config = config;
    this.reset();
  }

  reset() {
    this.state = LOST;
    this.pinch = false;
    this.pinchFrames = 0;
    this.candidate = null;
    this.candidateFrames = 0;
    this.pose = null;
    this.lastSeen = 0;
    this.holdSince = null;
  }

  /** Frames of agreement required before `raw` may commit. */
  requiredFrames(raw) {
    const g = this.config.gesture;
    if (raw === PINCH) return 1; // hysteresis already did the confirming
    if (raw === POINT) return g.pointConfirmFrames;
    if (raw === FIST) return g.fistConfirmFrames;
    if (raw === PALM) return g.palmConfirmFrames;
    // Leaving a posture needs agreement too, or one bad frame ends a stroke.
    if (raw === IDLE) return g.idleConfirmFrames;
    return 1;
  }

  classify(pose) {
    if (this.pinch) return PINCH;
    const e = pose.extended;
    const indexOnly = e.index && !e.middle && !e.ring && !e.pinky;
    const allClosed = !e.index && !e.middle && !e.ring && !e.pinky;
    const allOpen = e.index && e.middle && e.ring && e.pinky;
    if (indexOnly) return POINT;
    if (allClosed) return FIST;
    if (allOpen) return PALM;
    return IDLE;
  }

  updatePinch(pose) {
    const g = this.config.gesture;
    const r = pose.pinchRatio;
    const reachOk = pose.indexReach === undefined || pose.indexReach > g.pinchMinReach;
    if (!this.pinch) {
      if (r < g.pinchOn && reachOk) {
        this.pinchFrames++;
        if (this.pinchFrames >= g.pinchConfirmFrames) {
          this.pinch = true;
          this.pinchFrames = 0;
        }
      } else {
        this.pinchFrames = 0;
      }
    } else if (r > g.pinchOff || !reachOk) {
      this.pinchFrames++;
      if (this.pinchFrames >= g.pinchReleaseFrames) {
        this.pinch = false;
        this.pinchFrames = 0;
      }
    } else {
      this.pinchFrames = 0;
    }
  }

  /**
   * @param {object|null} pose result of analyzeHand, or null when no hand
   * @param {number} nowMs monotonic clock in milliseconds
   */
  update(pose, nowMs) {
    const previous = this.state;

    if (!pose) {
      this.state = LOST;
      this.pose = null;
      this.pinch = false;
      this.pinchFrames = 0;
      this.candidate = null;
      this.candidateFrames = 0;
      this.holdSince = null;
      return this.result(previous, nowMs);
    }

    this.lastSeen = nowMs;
    this.pose = pose;
    // A hand that has just arrived starts from neutral rather than from LOST,
    // so it still has to earn its posture like any other transition.
    if (this.state === LOST) this.state = IDLE;
    this.updatePinch(pose);

    const raw = this.classify(pose);

    // Releasing a pinch is immediate: the hysteresis already confirmed it, and
    // making the user wait more frames would leave an object stuck to their
    // fingers after they let go.
    if (!this.pinch && this.state === PINCH) {
      this.state = IDLE;
      this.candidate = null;
      this.candidateFrames = 0;
    }

    if (raw === this.state) {
      this.candidate = null;
      this.candidateFrames = 0;
    } else {
      if (raw === this.candidate) this.candidateFrames++;
      else {
        this.candidate = raw;
        this.candidateFrames = 1;
      }
      if (this.candidateFrames >= this.requiredFrames(raw)) {
        this.state = raw;
        this.candidate = null;
        this.candidateFrames = 0;
      }
    }

    // Track how long a palm has been held, for the deliberate undo gesture.
    if (this.state === PALM) {
      if (this.holdSince === null) this.holdSince = nowMs;
    } else {
      this.holdSince = null;
    }

    return this.result(previous, nowMs);
  }

  result(previous, nowMs) {
    return {
      state: this.state,
      previous,
      changed: this.state !== previous,
      pinch: this.pinch,
      pose: this.pose,
      holdMs: this.holdSince === null ? 0 : nowMs - this.holdSince,
    };
  }
}
