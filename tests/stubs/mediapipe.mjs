/**
 * Stand-in for `@mediapipe/tasks-vision` used by the boot smoke test.
 */

import { stub } from './autoStub.mjs';

export const FilesetResolver = {
  forVisionTasks: async () => stub('fileset'),
};

export const HandLandmarker = {
  createFromOptions: async () => ({
    detectForVideo: () => ({ landmarks: [], handedness: [], worldLandmarks: [] }),
    close: () => {},
  }),
};

export default { FilesetResolver, HandLandmarker };
