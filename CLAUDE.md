# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file Phantom-style spherical Three.js gallery (`index5.html`). 48 textured card meshes are arranged on the inside of a sphere; the camera sits at the origin and the world rotates around it. Inspired by phantom.land — the goal is the inside-out infinite-gallery feel, not a flat grid.

Self-contained: no build step, no package manager. Three.js (0.160.0 via unpkg importmap) and GSAP (3.12.5 via cdnjs) load from CDN. Card preview images come from `picsum.photos`.

## Run + verify

```bash
# serve (any static server works; needs to be HTTP, not file://, for ES module imports)
python3 -m http.server 8765
# then open http://localhost:8765/index5.html
```

For headless verification with Chrome on macOS, WebGL requires SwiftShader flags:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --enable-unsafe-swiftshader --use-angle=swiftshader \
  --remote-debugging-port=9333 --user-data-dir=$(mktemp -d) about:blank
```

Without `--use-angle=swiftshader`, headless Chrome can't create a WebGL context and Three throws at construction.

## Architecture notes worth knowing before editing

**Inside-out sphere orientation.** Each card plane is positioned on a sphere of `RADIUS` and oriented with `mesh.lookAt(0,0,0)` so its FrontSide faces the camera at origin. The earlier `lookAt(position*2)` form points the front face *outward* — camera sees back faces, FrontSide culls them, scene renders black. If cards stop appearing after a layout change, this is almost always the cause.

**Lenis-style easing model.** `drag` object holds two pairs of rotation state: `tRotX/tRotY` (target, updated by input) and `rotX/rotY` (applied to `group.rotation`, chasing target each frame at `EASE = 0.085`). Release inertia is `vX/vY` decaying by `FRICTION = 0.93` each frame and re-feeding the target. Don't write directly to `group.rotation` — write to the target.

**Click vs drag disambiguation.** `pointerdown` resets `drag.moved`; `pointermove` accumulates pixel distance; `pointerup` calls `handleClick` only if `moved < 6`. Pointer is captured on down so a release outside the canvas still ends the drag.

**Detail page animation.** `openDetail` tweens the clicked mesh forward (z≈-220) and scales it up, fades the other 47 meshes to opacity 0, then delays 0.55s before populating + fading in the DOM detail panel. `closeDetail` reverses by restoring from `originals[i]` (recorded at construction time) — do not mutate `originals`. Sets `drag.locked` for the duration to suppress input.

**Card textures.** Each card is a `CanvasTexture` painted in `makeCardTexture`. The painter runs twice per card: once synchronously with a placeholder, again when the `picsum.photos` image loads. `texture.needsUpdate = true` after each paint is required. If you add new fields, repaint inside both paths.

**Debug hooks.** `window.__three = { scene, group, meshes, camera, renderer, drag }` is exposed at the bottom of the module script for DevTools inspection. Safe to keep — adds no perf cost.

## Layout knobs

- `COLS`, `ROWS`, `RADIUS`, `CARD_W`, `CARD_H` at the top of the module script.
- `phi` is clamped to `0.30π–0.70π` (middle band, no pole pinch). Widening this packs more rows; narrowing tightens the band.
- `EASE`, `DRAG_K`, `FRICTION`, `TILT_LIMIT` control feel.
