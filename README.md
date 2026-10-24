# GestureVerse

**Draw it in the air → turn it into an object → grab it → lift it → move it → throw it or place it.**

GestureVerse is a real-time, browser-based interactive experience where your hands are the only
input device. You draw shapes in mid-air with your index finger, the app recognises them and turns
them into solid 3D objects, and then you pick those objects up with a pinch, carry them around the
workspace, spin and resize them with two hands, flick them across the room, and put them down
wherever you like.

No mouse. No keyboard. No controller. Just a webcam and your hands.

---

## Table of contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Interaction modes](#interaction-modes)
- [Gesture reference](#gesture-reference)
- [Drawing tools](#drawing-tools)
- [Tuning and configuration](#tuning-and-configuration)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Acceptance criteria](#acceptance-criteria)
- [Browser support](#browser-support)
- [Privacy](#privacy)
- [Further reading](#further-reading)

---

## What it does

**Air Drawing.** Your index fingertip becomes a glowing pen. Point to move the cursor, and strokes
appear as you move. Choose freehand or a parametric tool (line, rectangle, square, circle, ellipse,
triangle, star), pick from a neon palette, and set the brush size.

**Draw-to-object.** Finish a closed shape and GestureVerse analyses the contour, classifies it, and
extrudes it into a 3D object — a circle becomes a sphere, a square a cube, a triangle a cone, a star
a star, a heart a heart, a freehand line a glowing tube. High-confidence shapes convert automatically;
anything ambiguous waits for you to confirm with the **Create** button (or press **Space**), so the
app never claims to recognise a doodle it isn't sure about.

**Object Playground.** Every object is grabbable. Move your cursor near one and it lights up with a
selection outline. Pinch your thumb and index finger together and it attaches to your hand — no
jump, because the grab preserves the offset between your hand and the object. Carry it anywhere in
the workspace. Release and it stays exactly where you left it.

**Creative Playground.** A sandbox seeded with floating shapes you can stack, arrange and throw.

**Physics.** Thrown objects obey gravity, air drag, a floor with restitution and friction, and wall
bounces. A fast flick sends an object flying; a slow release places it gently.

**Effects.** Glowing fingertip cursor, neon trails, particle bursts on grab/release/impact, a
magnetic selection outline, soft contact shadows, idle floating, and a scale-pop when an object is
created.

---

## Quick start

### Requirements

- A laptop with a webcam and reasonable lighting
- **Chrome or Edge** (recommended). Safari 17+ mostly works. Firefox is not recommended — its
  WebGL and MediaPipe support is less predictable.
- Node.js 18+ *only* to run the dev server and the test suite. The app itself is plain ES modules.
- An internet connection on first load, to fetch Three.js, MediaPipe, and the hand-tracking model
  (about 8 MB). Everything then runs locally.

### Run it

```bash
# 1. Get the code
cd gestureverse

# 2. Serve it (any static server works; the app must be on http://, not file://)
npm run serve
#   → http://localhost:8080
```

Or with Python instead of Node:

```bash
python3 -m http.server 8080
#   → http://localhost:8080
```

Open the URL, allow camera access, and follow the on-screen onboarding. Hold your hand about an
arm's length from the camera, palm towards it, whole hand in frame. A glowing dot appears on your
index fingertip — you're in.

> **Why not just open `index.html`?** Browsers block ES module imports and camera access on
> `file://` URLs. It has to be served over HTTP.

### First 60 seconds

1. **Draw a circle.** Point with your index finger and trace a circle in the air. Watch the neon
   trail follow you.
2. **Open your hand** to end the stroke. A circle appears, is recognised, and pops into a 3D sphere.
3. **Move your cursor onto the sphere.** It glows.
4. **Pinch** thumb and index together. The sphere attaches to your hand.
5. **Move your hand.** The sphere follows, smoothly.
6. **Release the pinch.** The sphere is placed where you left it, with a spark burst.
7. **Grab it again and flick.** It flies, bounces, and settles on the floor.

---

## How it works

### Architecture: why there is no Python

The brief allowed a browser-based implementation, and for this interaction it is clearly the right
call. MediaPipe Tasks Vision and Three.js both run natively in the browser at 30–60 FPS, so there is
no reason to split the app across a Python process and a frontend and pay a WebSocket round-trip on
every landmark. One process, one render loop, lowest possible latency, and installation is
"serve a folder".

The Python/OpenCV/MediaPipe stack remains a perfectly good choice for an offline or embedded
variant; the gesture logic here is deliberately written as pure, DOM-free modules so it could be
ported to Python behind the same state machine.

### Frame model

Two `requestAnimationFrame` loops run side by side, which is the point:

```
┌──────────────────────────┐        ┌──────────────────────────────────────┐
│  Tracking loop           │        │  Render loop                         │
│  (MediaPipe inference)   │        │  (gestures → state → physics → draw) │
│                          │        │                                      │
│  video frame             │        │  read latestHands                    │
│    → HandLandmarker      │        │    → GestureRecognizer.update()      │
│    → latestHands ────────┼───────▶│    → events (draw/grab/release/…)    │
│                          │        │    → StrokeManager / ObjectManager   │
│  never blocks rendering  │        │    → Three.js + 2D overlay render    │
└──────────────────────────┘        └──────────────────────────────────────┘
```

If inference takes 30 ms, rendering keeps going at full rate and simply reuses the previous
landmarks for a frame. The renderer is never waiting on the camera.

### Module map

| Layer | Module | Responsibility |
|---|---|---|
| Core | `core/config.js` | Every tunable threshold, in one place |
| Core | `core/math.js` | Geometry, RDP simplification, convex hull |
| Core | `core/oneEuroFilter.js` | Adaptive landmark smoothing + velocity estimation |
| Core | `core/coordinateMapper.js` | Image → canvas → world coordinates, mirroring in one place |
| Gestures | `gestures/landmarks.js` | Pure geometry over the 21 MediaPipe landmarks |
| Gestures | `gestures/gestureRecognizer.js` | The gesture state machine |
| Gestures | `gestures/twoHandController.js` | Two-hand scale and rotation |
| Drawing | `drawing/strokeManager.js` | Strokes, tools, undo/redo |
| Drawing | `drawing/shapeRecognizer.js` | Contour classification |
| Objects | `objects/objectManager.js` | Grab / lift / move / place / throw state |
| Objects | `objects/physics.js` | Gravity, bounce, friction, settle |
| Objects | `objects/objectFactory.js` | Shape → geometry descriptors |
| Tracking | `tracking/handTracker.js` | MediaPipe wrapper, camera, errors |
| Render | `render/scene.js` | Three.js world, lights, floor, loop |
| Render | `render/objectView.js` | Meshes, shadows, selection outlines |
| Render | `render/effects.js` | Pooled particles, cursor, trails |
| Render | `render/strokeRenderer.js` | The 2D ink layer |
| UI | `ui/ui.js` | DOM, HUD, onboarding |
| — | `main.js` | Orchestration; the only module that knows everything |

Everything down to `objects/` is **pure**: no DOM, no WebGL, no camera. That is what makes the
behaviour testable in Node, and it is why the test suite can drive the entire signature interaction
without a browser.

### Three design decisions worth knowing

**Mirroring is applied in exactly one place.** The recognizer always emits *raw image* coordinates.
The `CoordinateMapper` applies the mirror on the way out, once. Mirroring a webcam preview feels
natural, but applying it twice is the classic bug that silently reverses your object movement. It
cannot happen here.

**The jump guard cannot latch.** A single teleport-sized landmark jump is treated as a tracking
glitch and the cursor holds. But if the jump persists for four frames, the app concludes the hand
genuinely moved (or tracking re-acquired elsewhere) and snaps to the new position. Without this, one
bad frame freezes the cursor permanently.

**Throws are judged on peak recent speed, not instantaneous speed.** When you flick and release, your
hand naturally stalls for a frame or two while the pinch release is confirmed. Reading the
instantaneous velocity at that moment loses the throw entirely. GestureVerse keeps a ~140 ms window
of hand velocity and uses the peak — which is what your hand actually did.

---

## Interaction modes

| Mode | What it is for |
|---|---|
| **Air Drawing** | Draw strokes freely. Point to draw, open your hand or pinch to stop. |
| **Object Playground** | Manipulate what you have drawn. Grab, lift, move, rotate, resize, throw, place. |
| **Creative Playground** | A seeded sandbox of floating shapes for stacking, arranging and throwing. |

Switch modes with the buttons in the top bar. You can draw in any mode, but strokes only become
objects automatically while in Air Drawing.

---

## Gesture reference

The full guide is also available in-app via the **Gesture guide** button (or press **G**).

| Gesture | Action |
|---|---|
| Index extended, other fingers curled | Move the cursor |
| Point while in Air Drawing | Draw a stroke |
| Thumb + index pinched | Grab / hold an object |
| Pinch maintained while moving | Lift and carry the object |
| Release the pinch | Place it — or throw it if you were moving fast |
| Two hands apart / together | Scale the held object |
| Two hands twisting | Rotate the held object |
| Open palm | End the current stroke (hold ~1 s to pause) |
| Closed fist | Erase whatever the cursor is over |
| Fast movement, then release | Throw the object |

> **Why the palm does two things.** In Air Drawing you finish a stroke by opening your hand, so a
> palm that also paused the app would pause it after every single stroke. Instead a brief palm just
> ends the stroke, and *holding* the palm for about a second toggles pause. Pausing is a deliberate
> act; lifting your pen should not be.

### How gesture stability is achieved

Naive gesture detection flickers, and flicker in a grab/release system is miserable. GestureVerse
uses:

- **Separate activation and release thresholds.** A pinch starts below `pinchOn` (0.42) and only ends
  above `pinchOff` (0.60). Wobbling between the two changes nothing.
- **Temporal confirmation.** Open palm and fist must be held for six frames before they fire; the
  point gesture needs two.
- **Cooldowns.** A gesture cannot re-fire immediately. The fist — the one destructive gesture — has a
  long 1.2 s cooldown on top.
- **A neutral state.** A hand that is neither clearly pointing, pinching, open nor closed resolves to
  `none`, so nothing fires on the way between poses.
- **Deliberate non-destructiveness.** A fist erases *only* the object already under the cursor. It
  can never wipe the scene. There is no gesture in this app that clears everything.
- **Graceful loss.** When the hand leaves the frame the recognizer emits the end event for whatever
  was in progress, so a held object is always released and a stroke is always finished cleanly.

---

## Drawing tools

Freehand, line, rectangle, square, circle, ellipse, triangle and star. Eight neon colours, four
brush sizes, undo, redo, clear, and a PNG snapshot of the scene.

### What can be recognised

| You draw | You get |
|---|---|
| Circle | Sphere |
| Ellipse | Squashed sphere |
| Square / rectangle | Cube |
| Triangle | Cone |
| Pentagon | Cylinder |
| Five-point star | Star |
| Heart | Heart (best-effort, always low confidence) |
| Freehand line / curve | Glowing 3D tube |
| Anything else closed | Generic polyhedron |

Recognition is **conservative by design**. Every verdict carries a confidence; shapes above 0.75
convert automatically, anything below that waits for you to confirm with the **Create** button or the
**Space** key, and you can override the guess with the shape dropdown. The app does not pretend to
recognise arbitrary doodles.

Two pieces of geometry make this work:

- **Circularity alone cannot tell a square from a circle.** A perfect square scores 0.785 on
  $$4\pi A / P^2$$, and a circle scores ~0.99. So the circle test also requires at least six
  simplified vertices, which rules out a quadrilateral. Without that guard, every square becomes a
  sphere.
- **A star and a heart both have concave regions.** They are separated by counting deep concavity
  *clusters*: a star has one per point (five for a five-point star), a heart has exactly one.

---

## Tuning and configuration

Everything lives in `src/core/config.js` and can be changed live from the UI.

### Sensitivity

The **Sensitivity** slider (and the Relaxed / Balanced / Responsive presets) shifts three things at
once: the One Euro filter's baseline cutoff, its speed coupling, and the pinch thresholds.

| Preset | Feel |
|---|---|
| Relaxed | Heavier smoothing, larger pinch thresholds. Good for shaky hands or a distant camera. |
| Balanced | The default. |
| Responsive | Near-raw tracking, tight pinch thresholds. Good for a close, steady hand. |

### Key settings

```js
tracking.smoothing    // One Euro filter: { minCutoff, beta, dCutoff }
tracking.maxJump      // teleport rejection distance, normalized units
gestures.pinchOn      // pinch activation threshold
gestures.pinchOff     // pinch release threshold (must be > pinchOn)
gestures.cooldownMs   // gesture lockout after firing
objects.grabRadius    // how close the cursor must be to select
objects.throwMinSpeed // hand speed required to throw
throwEnabled          // master switch for throwing (turn off for kids' events)
handedness            // 'any' | 'left' | 'right'
mirror                // mirror the preview
showCamera            // hide the preview for public demos
```

> **A note on the filter.** `beta` is speed-coupled, so it must be tuned to the *units* of the
> signal. Landmarks are normalized (0–1), where a brisk hand movement is only a few units per
> second. The widely-copied pixel-space value (~0.007) would make the cursor feel frozen here. The
> defaults are 1.5 / 0.6.

### Presentation options

- **Hide panels** (or press **H**) clears the UI for a clean public demo.
- **Full screen** for exhibitions.
- Turn off **Show camera preview** to show only the virtual scene.
- Turn off **Allow throwing** for younger audiences or controlled demos.

---

## Performance

The target is a steady 30–60 FPS on an ordinary laptop, and the design is built around that.

**What the app does to stay fast**

| Technique | Why it matters |
|---|---|
| Detection on its own `requestAnimationFrame` loop | A slow inference frame never stalls rendering; the renderer reuses the last landmarks |
| 960×540 capture | MediaPipe's cost scales with input pixels, and 720p buys nothing for hand landmarks |
| Offscreen stroke cache | Committed strokes are rasterised **once** and blitted. Re-tracing them every frame is the most expensive thing this app could do — a busy canvas is tens of thousands of curve segments — and it is entirely redundant, because committed strokes never change |
| Idle overlay short-circuit | With no hand on screen and no live stroke, the 2D layer is not touched at all |
| Live particle list | The particle update is O(alive), not O(pool) |
| Adaptive detection cadence | If the average frame rate drops below ~42 FPS, detection drops to every other frame automatically (barely perceptible, since the cursor is smoothed anyway) and is restored when headroom returns |
| Pixel-ratio cap of 1.5 | Roughly halves fragment work on a retina display with almost no visible difference |
| Antialiasing only at ≤1.5× DPR | The extra device pixels already hide the jaggies |
| Pooled particles | Effects never allocate during interaction, so there is no GC hitch mid-gesture |
| Auto GPU→CPU delegate fallback | A driver that rejects the GPU path degrades instead of failing |
| One Euro smoothing | Removes jitter without adding the lag a fixed low-pass would |

The frame-rate counter in the top bar is live, so you can see the effect of any change immediately.
If you need more headroom, `TROUBLESHOOTING.md` lists the knobs in order of impact.

## Project structure

```
gestureverse/
├── index.html                 # Entry point, import map, full UI markup
├── styles.css                 # Dark futuristic theme
├── package.json
├── README.md
├── GESTURES.md                # Printable gesture card for the booth
├── TROUBLESHOOTING.md
├── DEMO.md                    # Scripted demo walkthrough
├── src/
│   ├── main.js                # Orchestration
│   ├── core/
│   │   ├── config.js
│   │   ├── math.js
│   │   ├── oneEuroFilter.js
│   │   └── coordinateMapper.js
│   ├── gestures/
│   │   ├── landmarks.js
│   │   ├── gestureRecognizer.js
│   │   └── twoHandController.js
│   ├── drawing/
│   │   ├── strokeManager.js
│   │   └── shapeRecognizer.js
│   ├── objects/
│   │   ├── objectManager.js
│   │   ├── physics.js
│   │   └── objectFactory.js
│   ├── tracking/
│   │   └── handTracker.js
│   ├── render/
│   │   ├── scene.js
│   │   ├── objectView.js
│   │   ├── effects.js
│   │   └── strokeRenderer.js
│   └── ui/
│       └── ui.js
├── tests/                     # Node test-runner suite, no browser needed
│   ├── core.test.js
│   ├── coordinateMapper.test.js
│   ├── gestureRecognizer.test.js
│   ├── twoHandController.test.js
│   ├── shapeRecognizer.test.js
│   ├── strokeManager.test.js
│   ├── objectManager.test.js
│   ├── integration.test.js
│   └── helpers/syntheticHand.js
└── scripts/
    ├── serve.js               # Zero-dependency static server
    └── check-syntax.js        # Parse every module
```

---

## Testing

The test suite runs entirely in Node — no browser, no webcam, no mocks of the rendering layer,
because the logic under test genuinely has no dependency on any of them. Synthetic 21-landmark hands
drive the real recognizer.

```bash
npm test          # 110 tests
npm run check     # parse every module + verify every import and DOM id
```

### What is covered

- **Gesture state transitions** — point/pinch/palm/fist detection, hysteresis, confirmation delays,
  cooldowns, the neutral state, hand loss and recovery, jump rejection (and that it cannot latch).
- **Object manipulation** — grab, offset preservation (no jump on grab), smooth monotonic follow,
  place-and-stay, throw, throw-disabled, bounce/settle, re-grab, two-hand scale and rotation,
  serialisation.
- **Shape recognition** — circle vs square (the circularity trap), rectangle, triangle, star,
  ellipse, heart, line, curve, low-confidence reporting.
- **Coordinates and filters** — mirroring applied exactly once, world mapping, depth from hand size,
  One Euro smoothing and speed coupling.
- **Boot and wiring** — the real module graph is loaded against a fake DOM built from the real
  `index.html`, then booted and driven through `GestureVerse.frame()`: draw → object → grab → carry →
  place. This is what catches a renamed DOM id or a handler wired to the wrong subsystem.
- **End-to-end** — the full signature flow, frame by frame: draw a circle in the air, recognise it,
  create the object, pinch to grab, lift and carry, release and place, verify it stays put, pick it
  up again, flick to throw, and let physics settle it on the floor. Plus: tracking loss mid-carry
  leaves the object exactly where it was, and an open palm never draws or grabs.
- **Performance and cache correctness** — that the stroke cache genuinely avoids work (60 strokes
  over 60 frames traces ~60 times, not 3600), and that it is invalidated by every mutation and by a
  resize. A cache that silently stops updating would be far worse than no cache.
- **Regressions** — one test per bug listed below, each written so that it fails on the buggy code
  rather than merely passing on the fixed code.

### Bugs the tests caught

All of these were real, and all were found by tests rather than by reading the code:

| Bug | Symptom |
|---|---|
| A thrown object was re-tagged `hovered` in the same frame | Objects froze mid-air instead of flying |
| The recognizer emitted `pinch_end` before `hand_lost` on a dropout | Tracking loss *threw* objects it should have dropped |
| The jump guard latched after a large hand movement | One bad frame froze the cursor permanently |
| Throws used instantaneous hand velocity | The hand stalls while the pinch release confirms, so most throws were lost |
| `Color.setHex()` called with a CSS string | The 3D fingertip cursor rendered pure black |
| The `rect` tool id never matched the `rectangle` shape key | A drawn rectangle became a sphere |
| The shape dropdown defaulted to its first option | Manual **Create** silently forced a circle every time |
| The hand skeleton used the un-padded mapping | The glowing cursor dot sat somewhere other than where strokes appeared |
| `capture()` read the WebGL canvas after compositing | Snapshots came out with an empty 3D layer |
| A resize did not reset the overlay's idle flag | The canvas went blank until something changed |
| Pausing did not freeze physics | Thrown objects kept flying while paused |
| Pinch carried a 350 ms cooldown | A quick grab-release-grab swallowed the second pinch |
| A brief palm to end a stroke also paused the app | The app paused after every single stroke |
| `selectHands` had no stickiness | The cursor leapt to a second hand the moment it entered frame |

> One of those is worth calling out as a testing lesson. The colour bug was first asserted with a
> "is the channel finite?" check, which **passed on the broken code** — `setHex('#22d3ee')` yields
> black, not `NaN`, because `Math.floor('#22d3ee')` is `NaN` and `NaN >> 16` is `0`. The assertion
> now checks the exact colour. A test that cannot fail is not a test.

---

## Acceptance criteria

| # | Criterion | Where it is met |
|---|---|---|
| 1 | Webcam detects a hand and shows a stable fingertip cursor | `handTracker` + One Euro smoothing |
| 2 | Draw a continuous stroke by moving the finger | `strokeManager` + `strokeRenderer` |
| 3 | End a stroke without connecting lines | `POINT_END` / `PINCH_START` end the stroke cleanly |
| 4 | At least one drawn shape or sample object is selectable | `objectManager.updateHover` |
| 5 | Grab the object with a defined gesture | Pinch → `objectManager.grab` |
| 6 | The object follows the hand smoothly | Exponential spring follow, `followStiffness` |
| 7 | Lift and move it to a different position | Full 3D drag with depth from hand size |
| 8 | Releasing places it at the new position | `objectManager.release` |
| 9 | The object stays in place after release | Covered by tests |
| 10 | Pick up and reposition the same object again | Covered by tests |
| 11 | Tracking loss does not make the object fly | `drop()` on `HAND_LOST` and on `pinch_end reason:lost` |
| 12 | Gesture changes do not repeatedly trigger actions | Hysteresis, confirmation frames, cooldowns |
| 13 | Runs locally with documented setup | `npm run serve` |
| 14 | Core interaction works with no mouse or keyboard | All interaction is gesture-driven |
| 15 | A polished, engaging experience, not a landmark demo | Effects, UI, physics, modes |

---

## Browser support

| Browser | Status |
|---|---|
| Chrome / Edge 100+ | Recommended. GPU delegate, 45–60 FPS on a modern laptop. |
| Safari 17+ | Works. Occasionally falls back to the CPU delegate. |
| Firefox | Not recommended. MediaPipe and WebGL behaviour is inconsistent. |

Roughly 30–60 FPS on a normal laptop, depending on CPU and lighting. If it feels sluggish, see
`TROUBLESHOOTING.md` — lowering the camera resolution or raising
`performance.trackingEveryNthFrame` to 2 are the two biggest wins.

---

## Privacy

Video never leaves your machine. Hand tracking runs entirely in your browser via WebGL/WASM. There
is no backend, no upload, and no telemetry. Nothing is recorded unless you press **Save snapshot**,
which writes a PNG of the scene to your own downloads folder.

---

## Further reading

- [`GESTURES.md`](GESTURES.md) — the one-page gesture card
- [`DEMO.md`](DEMO.md) — a scripted demo walkthrough for events
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — when it doesn't work

## Licence

MIT.
