/** The canonical vocabulary shared by the gesture layer and the UI. */
export const HandStateName = Object.freeze({
  LOST: 'lost',
  IDLE: 'idle',
  POINT: 'point',
  PINCH: 'pinch',
  FIST: 'fist',
  PALM: 'palm',
});

/** What the *app* is doing, which is a level above any single hand. */
export const AppStateName = Object.freeze({
  IDLE: 'idle',
  DRAW: 'draw',
  HOVER: 'hover',
  GRAB: 'grab',
  MOVE: 'move',
  TWO_HAND: 'two-hand',
  RESIZE: 'resize',
  ROTATE: 'rotate',
  DELETE: 'delete',
});
