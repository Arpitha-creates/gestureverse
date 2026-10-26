# GestureVerse

**Draw in the air with your index finger. Pinch it. Lift it off the canvas and move it
around a 3D workspace with your hands.**

No mouse, no keyboard, no controller — a webcam and your hands. Everything runs in the
browser: MediaPipe tracks 21 landmarks per hand, Three.js renders the workspace, and no
video frame ever leaves your machine.

---

## What it does

- **Draw.** Raise your index finger and it becomes a glowing pen. Strokes follow your
  fingertip smoothly (One Euro filtered, so lines are not shaky) and stay exactly where
  you drew them after your hand moves away.
- **Lift.** Pinch over a drawing to grab it. It keeps its original shape, colour and
  stroke thickness — a drawing is never replaced by a generic 3D primitive.
- **Move.** Carry it anywhere in the workspace, including in depth, with no snap-to-cursor
  jump when you grab. Release and it stays floating right where you left it.
- **Resize and rotate.** Pinch with both hands: move them apart to scale, twist them to
  rotate. The HUD tells you which one you are doing.
- **Delete.** Hold a fist over a drawing, or hold it with one hand and fist the other.
  A red ring fills for 0.9 s first, so nothing dies from one bad frame.
- **Undo anything.** Every draw, move, resize and delete is undoable.

---

## Quick start

No build step, no install. The app is plain ES modules behind an import map, so any
static server will do.

```bash
# either
npm run serve          # http://localhost:5173

# or
python3 -m http.server 5173
```

Then open <http://localhost:5173>, allow the camera, and raise your index finger.

> Camera access requires `localhost` or `https://`. Opening `index.html` directly from
> the filesystem will not work — browsers block `getUserMedia` on `file://`.

---

## Gestures

| Gesture | What happens |
|---|---|
| Index finger up, others folded | The cursor tracks your fingertip |
| Point, in **Draw** mode | Draw a stroke |
| Open your hand | Finish the stroke |
| Thumb + index pinch | Grab the drawing under the cursor |
| Pinch, then move | Carry it — left, right, up, down and in depth |
| Release the pinch | Leave it floating there |
| Pinch with **both** hands | Grab with two hands |
| Hands apart / together | Resize the drawing |
| Twist both hands | Rotate the drawing |
| Fist held over a drawing | Delete it (after a 0.9 s charge) |
| Hold with one hand, fist the other | Delete the held drawing |
| Open palm held 1.5 s | Undo the last action |

Keyboard: `U` undo · `R` redo · `C` clear · `E` eraser · `G` guide · `Esc` release
everything · `1`/`2` switch mode.

A printable one-pager lives in [GESTURES.md](GESTURES.md).

---

## How it works

Four layers, each with one job, so a bug has exactly one place to live.

```
webcam ─▶ HandTracker ─▶ analyzeHand ─▶ HandState ─▶ Interaction ─▶ DrawingWorld
         (MediaPipe)     (metrics)      (per hand)   (decisions)     (data)
                                                                        │
                                            SceneView + DrawingView ◀───┘
                                            Overlay (2D HUD)
```

| Module | Responsibility |
|---|---|
| `src/tracking/handTracker.js` | Camera, MediaPipe Hand Landmarker, GPU→CPU fallback |
| `src/gestures/handPose.js` | 21 landmarks → palm size, finger extension, pinch ratio, cursors |
| `src/gestures/handState.js` | One state machine per hand: hysteresis + temporal confirmation |
| `src/gestures/interaction.js` | The brain. Draw / grab / carry / resize / rotate / delete |
| `src/drawing/strokeBuilder.js` | Collects a stroke, rejects jitter and twitches |
| `src/objects/world.js` | Drawings, selection, undo/redo snapshots |
| `src/render/scene.js` | Camera, lights, floor, and the two coordinate conversions |
| `src/render/drawingView.js` | Drawings → neon tubes, with proper disposal |
| `src/render/overlay.js` | Skeleton, cursor, live stroke, progress rings |
| `src/ui/ui.js` | All DOM wiring |
| `src/main.js` | The single frame loop |

### Why it does not hang

A gesture UI that sticks is worse than one that does nothing, so release is guaranteed
four ways over:

1. A carried object is dropped the instant its hand stops pinching.
2. A hand that vanishes releases after 240 ms.
3. A two-hand grab that loses either hand releases after 300 ms.
4. No grab can outlive `twoHand.maxHoldMs`, whatever happens.

Positions are clamped to a sane box, so a bad projection cannot fling an object out of
the world, and `Esc` force-releases everything at any time. A 4000-frame randomised
fuzz test asserts all of this on every run.

### Two coordinate conversions

Everything hinges on two functions in `scene.js`, both done by unprojection rather than
trigonometry so they stay exact at any camera angle or window size:

- `toWorld(point, depth)` — normalised screen point → world position on a given depth plane
- `project(position)` — world position → canvas pixels

Picking is done in **screen space**, not world space, so an object's depth can never make
it unpickable.

---

## Tuning

Every number lives in [`src/config.js`](src/config.js). The ones you are most likely to
want:

| Setting | Default | Effect |
|---|---|---|
| `gesture.pinchOn` / `pinchOff` | `0.42` / `0.66` | How closed a pinch must be. Widen the gap if grabbing is twitchy |
| `gesture.pinchMinReach` | `1.15` | Stops a closed fist registering as a pinch |
| `gesture.deleteHoldMs` | `900` | How deliberate the delete gesture is |
| `twoHand.exitGraceMs` | `300` | How long a two-hand grab survives a dropped hand |
| `smoothing.cursor` | `minCutoff 1.6` | Lower = smoother but laggier lines |
| `draw.minStep` | `0.02` | Jitter rejection, in world units |
| `draw.maxDrawings` | `60` | Oldest artwork is recycled past this |

---

## Testing

```bash
npm test          # 45 unit + integration tests, including a 4000-frame fuzz run
node scripts/check.js   # every import resolves; every DOM id exists
```

The suite covers the things that actually break a gesture app:

- **Fist ≠ pinch.** In a fist the thumb and index tips already touch, so a naive pinch
  test fires on every closed hand. `pinchMinReach` is the fix, and there is a test for it.
- **No flicker.** Hysteresis plus confirmation frames; flickering postures never commit.
- **No sticking.** Randomised 4000-frame fuzz asserts nothing stays grabbed without a
  pinch, and no position, scale or rotation ever goes `NaN`.
- **No jump on grab.** A test asserts the object does not move on the frame it is grabbed.

---

## Browser support

Chrome, Edge and Safari 16+ on desktop or laptop. Needs WebGL and a webcam. The MediaPipe
GPU delegate is used when available and falls back to CPU automatically.

---

## Privacy

The camera stream is processed entirely in the page. No frame is uploaded, stored or
transmitted — there is no backend at all. Closing the tab stops the camera.

---

## Licence

MIT. See [LICENSE](LICENSE).
