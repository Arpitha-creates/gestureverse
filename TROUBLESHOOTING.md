# Troubleshooting

Most problems are lighting, framing, or the browser. Work through this list in order.

---

## The camera won't start

**"Camera access was blocked"**

Your browser is refusing camera permission. Click the camera icon in the address bar, set it to
Allow, and reload. If the site is embedded in an iframe, the parent page must grant
`allow="camera"`.

**"No usable camera was found"**

Another application is holding the camera. Close Zoom, Teams, OBS, or any other app using the
webcam, then press **Retry**.

**Nothing happens at all**

Make sure you opened the app over `http://` and not as a `file://` path. Browsers block both module
imports and camera access on `file://`. Run `npm run serve` (or `python3 -m http.server 8080`) and
open `http://localhost:8080`.

---

## The model won't load

**"Could not load the hand-tracking model"**

The app fetches Three.js, MediaPipe's WASM runtime, and the hand landmark model (~8 MB) from a CDN
on first load. If you are offline or behind a restrictive network:

1. Check that `https://cdn.jsdelivr.net` and `https://storage.googleapis.com` are reachable.
2. Or download `hand_landmarker.task` yourself and pass a local path:

   ```js
   // in src/tracking/handTracker.js, or pass options into tracker.init()
   const MODEL_URL = './assets/hand_landmarker.task';
   ```

   Place the file in `assets/` and serve it alongside the app.

---

## The cursor is jumpy, shaky or jittery

1. **Improve the lighting.** This is the single biggest factor. A bright, even, front-facing light
   source beats any amount of smoothing.
2. **Move the Sensitivity slider left**, or pick the **Relaxed** preset. That increases the One Euro
   filter's smoothing.
3. **Get your hand further from the background.** A busy or high-contrast background confuses the
   detector.
4. **Move closer to the camera** (but keep the whole hand in frame) — landmarks are more precise.

## The cursor feels laggy or delayed

Move the Sensitivity slider right, or pick the **Responsive** preset. Also check the FPS counter in
the top bar: below 25 FPS, smoothing is not the problem — see [Performance](#performance-is-poor).

---

## Drawing problems

**Strokes are connected by unwanted lines**

Strokes end when you stop pointing. If you are seeing connectors, you may be drifting between the
point pose and the open-palm pose, which ends the stroke. Make the pose change deliberate: curl your
other fingers clearly, or open your hand fully.

**I can't draw at all**

You are probably not in **Air Drawing** mode. Strokes can be drawn in any mode, but check the mode
indicator. Also confirm the gesture readout says *Pointing* — if it says *Neutral*, your index
finger is not extended enough or your other fingers are not curled enough.

**My drawing isn't recognised as the shape I meant**

Recognition is conservative on purpose. Check the shape dropdown and press **Create** (or **Space**)
to force it. Drawing more slowly and closing the loop cleanly helps a lot — the shape must actually
close, with the end point near the start point.

---

## Grab and move problems

**The object jumps when I grab it**

It shouldn't — the grab preserves the offset between your hand and the object. If it does jump, you
may have started the pinch while the cursor was already moving quickly. Pinch deliberately, then
move.

**The object won't attach**

The cursor must be within the grab radius of the object (about half a world unit). Watch for the
selection outline — if the object is not glowing, it is not in range. Move closer, then pinch.

**The object flies away when I didn't throw it**

Check that **Allow throwing** is off if you are doing a controlled demo. Otherwise this is usually a
tracking dropout: the app deliberately drops rather than throws when the hand is lost, but a
genuinely fast hand movement followed by a release *is* a throw by design.

**The object won't rotate or resize**

Two-hand scale and rotate need **both** hands clearly visible and reasonably far apart (more than
about 8% of the frame width). Hold the object with one hand and bring your other hand into frame.

---

## Performance is poor

Try these in order:

1. **Lower the camera resolution** in `src/core/config.js`:
   ```js
   camera: { width: 640, height: 480, fps: 30 }
   ```
2. **Run detection every other frame**:
   ```js
   performance: { trackingEveryNthFrame: 2 }
   ```
   This halves inference cost with barely any perceptible difference.
3. **Reduce the pixel ratio cap**:
   ```js
   performance: { pixelRatioCap: 1 }
   ```
4. **Fewer particles**:
   ```js
   effects: { particles: 300, glow: false }
   ```
5. **Close other tabs.** MediaPipe and WebGL both want GPU time.
6. **Use Chrome or Edge.** Firefox's WebGL performance here is noticeably worse.

The app also auto-falls back from the GPU delegate to the CPU delegate if your driver rejects the
GPU path; you'll see a warning in the browser console.

---

## The preview is mirrored — is that a bug?

No, it is intentional. A mirrored preview is far more intuitive: your hand moves right, the cursor
moves right. The coordinate mapping is handled separately and consistently, so object movement is
never accidentally reversed. Set `mirror: false` in the config to turn it off.

---

## Still stuck?

Open the browser console (`F12`). GestureVerse logs a warning for any detection frame that fails but
recovers, and the error banner shows anything fatal. The app is designed to survive a bad frame,
a dropped hand, and a lost camera without crashing — so a persistent error usually means the
problem is at the camera or network level.
