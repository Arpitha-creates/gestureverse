/**
 * Synthetic 21-landmark hands for tests.
 *
 * Coordinates are image space (unmirrored). Every helper can be given a target
 * for the point the app cares about - the index tip, or the thumb/index pinch
 * midpoint - and the whole hand is translated so that point lands exactly
 * there in *mirrored* (screen) space.
 */

function base() {
  return [
    { x: 0.5, y: 0.85, z: 0 }, // 0 wrist
    { x: 0.455, y: 0.79, z: 0 }, // 1
    { x: 0.42, y: 0.755, z: 0 }, // 2
    { x: 0.395, y: 0.735, z: 0 }, // 3
    { x: 0.38, y: 0.72, z: 0 }, // 4 thumb tip
    { x: 0.45, y: 0.67, z: 0 }, // 5 index mcp
    { x: 0.45, y: 0.55, z: 0 }, // 6 index pip
    { x: 0.45, y: 0.45, z: 0 }, // 7 index dip
    { x: 0.45, y: 0.35, z: 0 }, // 8 index tip
    { x: 0.5, y: 0.65, z: 0 }, // 9 middle mcp
    { x: 0.5, y: 0.52, z: 0 }, // 10 middle pip
    { x: 0.5, y: 0.42, z: 0 }, // 11 middle dip
    { x: 0.5, y: 0.32, z: 0 }, // 12 middle tip
    { x: 0.55, y: 0.67, z: 0 }, // 13 ring mcp
    { x: 0.55, y: 0.55, z: 0 }, // 14 ring pip
    { x: 0.55, y: 0.45, z: 0 }, // 15 ring dip
    { x: 0.55, y: 0.36, z: 0 }, // 16 ring tip
    { x: 0.6, y: 0.7, z: 0 }, // 17 pinky mcp
    { x: 0.6, y: 0.6, z: 0 }, // 18 pinky pip
    { x: 0.6, y: 0.51, z: 0 }, // 19 pinky dip
    { x: 0.6, y: 0.43, z: 0 }, // 20 pinky tip
  ];
}

function curl(lm, tip, dip, tipPos, dipPos) {
  lm[tip] = { ...lm[tip], ...tipPos };
  lm[dip] = { ...lm[dip], ...dipPos };
}

export function makeHand(kind = 'point', target = null) {
  const lm = base();

  if (kind === 'point') {
    curl(lm, 8, 7, { x: 0.45, y: 0.35 }, { x: 0.45, y: 0.45 });
    curl(lm, 12, 11, { x: 0.5, y: 0.7 }, { x: 0.5, y: 0.63 });
    curl(lm, 16, 15, { x: 0.55, y: 0.72 }, { x: 0.55, y: 0.65 });
    curl(lm, 20, 19, { x: 0.6, y: 0.75 }, { x: 0.6, y: 0.68 });
  } else if (kind === 'pinch') {
    // Thumb and index tips meet; the rest stays closed.
    lm[8] = { x: 0.42, y: 0.62, z: 0 };
    lm[7] = { x: 0.44, y: 0.66, z: 0 };
    lm[4] = { x: 0.42, y: 0.62, z: 0 };
    curl(lm, 12, 11, { x: 0.5, y: 0.7 }, { x: 0.5, y: 0.63 });
    curl(lm, 16, 15, { x: 0.55, y: 0.72 }, { x: 0.55, y: 0.65 });
    curl(lm, 20, 19, { x: 0.6, y: 0.75 }, { x: 0.6, y: 0.68 });
  } else if (kind === 'fist') {
    curl(lm, 8, 7, { x: 0.45, y: 0.72 }, { x: 0.45, y: 0.64 });
    curl(lm, 12, 11, { x: 0.5, y: 0.7 }, { x: 0.5, y: 0.63 });
    curl(lm, 16, 15, { x: 0.55, y: 0.72 }, { x: 0.55, y: 0.65 });
    curl(lm, 20, 19, { x: 0.6, y: 0.75 }, { x: 0.6, y: 0.68 });
    lm[4] = { x: 0.47, y: 0.73, z: 0 };
  } else if (kind === 'palm') {
    lm[4] = { x: 0.32, y: 0.6, z: 0 };
  }

  if (target) {
    const ref =
      kind === 'pinch'
        ? { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 }
        : { x: lm[8].x, y: lm[8].y };
    const dx = 1 - target.x - ref.x;
    const dy = target.y - ref.y;
    for (const p of lm) {
      p.x += dx;
      p.y += dy;
    }
  }

  return lm;
}

/** Build the slot object the Interaction layer expects. */
export function slot(index, state, pose, holdMs = 0) {
  return {
    index,
    pose,
    result: { state, previous: state, changed: false, pose, holdMs },
  };
}
