# Troubleshooting

## The camera will not start

**"Camera permission was denied."**
Allow camera access for the site in your browser's address-bar permission settings, then
reload. The permission prompt only appears once — a dismissal sticks until you reset it.

**"No camera was found."**
Another application may be holding the camera (Zoom, Teams, OBS). Quit it and try again.
On Windows also check Settings → Privacy → Camera.

**Nothing happens at all / the button does nothing.**
You are probably on `file://`. Browsers block `getUserMedia` outside `localhost` and
`https://`. Run a static server:

```bash
npm run serve
# or
python3 -m http.server 5173
```

## The hand is detected but nothing is drawn

- You must be in **Draw** mode (top bar) and pointing with **only your index finger**
  extended. Curl the other three.
- A stroke shorter than `draw.minLength` is discarded on purpose, so a tap draws nothing.
- Very dim light is the most common cause. Face a light source.

## Grabbing feels unreliable

- A pinch needs the index tip held **out in front of the palm** — think "OK sign", not
  "closed fist". If you pinch with the tips tucked into the palm it will not register.
- Loosen or tighten `gesture.pinchOn` / `gesture.pinchOff` in `src/config.js`. Widening
  the gap makes it more forgiving, narrowing it makes it more precise.
- `grab.radiusPx` controls how close the cursor must be to a drawing.

## Two hands work, then let go by themselves

That is the safety release doing its job. A two-hand grab releases if either hand stops
pinching or drops out of frame for `twoHand.exitGraceMs` (300 ms by default). If your
second hand keeps leaving the frame at the edges, move back from the camera or raise
`exitGraceMs`.

## It deleted something I did not mean to delete

Press `U`, or hold an open palm for 1.5 s. Deletion requires a fist held for 0.9 s with a
visible red ring, so this should be rare — if it is not, raise `gesture.deleteHoldMs`.

## It is slow / the frame rate drops

- MediaPipe falls back to the CPU delegate automatically when the GPU one is unavailable.
  Check the browser console: `HandTracker` records which delegate it used.
- Each drawing is two tube meshes. `draw.maxDrawings` (default 60) recycles the oldest.
- Close other GPU-heavy tabs.

## Lines look shaky

Raise the smoothing in `src/config.js`:

```js
smoothing: { cursor: { minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 } }
```

Lower `minCutoff` means smoother but slightly laggier. `beta` controls how much fast
movement is allowed through unfiltered.

## The scene is empty after reload

Nothing is persisted — there is no backend and no storage. Drawings live in memory for
the session only.
