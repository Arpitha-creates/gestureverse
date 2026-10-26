# Try GestureVerse 2

This is the new version. Your live site is untouched — this runs on your own machine.

## The one rule

**Open it through a local server, not by double-clicking `index.html`.**
Browsers block the camera on `file://` URLs. That single detail is the difference
between "it works" and "the camera button does nothing".

## Start it

Pick whichever you have. Any of these works.

**Python** (already installed on most Macs and Linux; on Windows, from python.org):

```bash
python3 -m http.server 5173
```

On Windows use `python` instead of `python3` if that is what you have.

**Node** (if you have Node 18+):

```bash
npm run serve
```

Then open:

    http://localhost:5173

Click **Enable camera & begin** and allow the camera when the browser asks.

## First 30 seconds

1. Hold your hand up, palm to the camera, about an arm's length away.
2. Point with **only your index finger** — curl the other three. A cyan dot appears
   and follows your fingertip.
3. Move it around: you are drawing.
4. Open your hand to finish the stroke. The drawing stays where you left it.
5. **Pinch** your thumb and index together over the drawing. It lifts and follows you.
6. Release to leave it floating.
7. Pinch with **both** hands, then move them apart — it resizes. Twist them — it rotates.

## Want exact shapes instead of freehand?

Click **Shapes** in the top bar. The left panel becomes a palette of exact primitives —
cube, sphere, cone, cylinder, pyramid, torus, star, diamond. Pick one, point where you
want it, and pinch to drop it. A translucent preview follows your hand the whole time, so
you see exactly what you will get. Once placed it behaves like any drawing: grab it,
move it, resize it with two hands, or delete it with a fist.

## If something feels wrong

Everything is tunable in `src/config.js`, and `TROUBLESHOOTING.md` covers the usual
problems. The two settings you are most likely to want:

- `gesture.pinchOn` (0.42) — lower it if grabbing feels hard, raise it if grabs happen
  by accident.
- `smoothing.pen.minCutoff` (2.6) — lower it for smoother but laggier lines, raise it if
  the pen feels like it is trailing your hand.

## Run the tests

```bash
npm test
node scripts/check.js
```

## What I could not verify

I built this without a browser or a camera, so the geometry, gesture thresholds and
timing are all reasoned and unit-tested but never seen on a real webcam. The logic is
covered by 45 tests including a 4000-frame randomised fuzz run — but if a threshold
feels wrong in your hand, tell me the number and the symptom and I will tune it.
