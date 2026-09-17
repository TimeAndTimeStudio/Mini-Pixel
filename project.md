# Pixel Draw — Minimal Pixel Drawing App

A minimal pixel drawing application built with only HTML, CSS, and Vanilla JavaScript.
No build tools, no dependencies, no backend.

## Project Structure

```
pixel-draw/
├── index.html
├── style.css
└── app.js
```

## How to Run

Open `pixel-draw/index.html` directly in a web browser.
No server required.

---

## Phases

### Phase 1 — Project Setup

- Minimal static web application.
- Three files only: `index.html`, `style.css`, `app.js`.
- No Node.js, no npm, no backend, no build system, no external dependencies.
- Runs by opening `index.html` in a browser.

### Phase 2 — Canvas

- Uses `canvas.getContext("2d")` for rendering.
- No WebGL, WebGL2, or WebGPU.
- `imageSmoothingEnabled` set to `false` for sharp pixels.
- Artwork pixel dimensions are separate from display dimensions.
- Pixel data stored in a `Uint8Array` buffer, separate from the display canvas.

### Phase 3 — Canvas Size

- Custom width and height input fields.
- Supports different width and height values (e.g., 16x16, 64x64, 320x180).
- Rejects zero, negative, and non-numeric values.
- Pixel buffer created with the selected dimensions.
- Maximum size enforced at 2048x2048.

### Phase 4 — Pencil

- Draws individual pixels.
- Supports continuous drawing while dragging (Bresenham line interpolation).
- Uses Pointer Events for unified mouse/touch handling.
- Converts pointer coordinates into pixel coordinates via zoom and pan transform.
- Draws using the currently selected color.

### Phase 5 — Color

- Native HTML `<input type="color">` for color selection.
- Colors stored internally as RGBA objects `{r, g, b, a}`.
- Color picker value parsed to RGBA using hex conversion.
- Selected color used by the Pencil tool.

### Phase 6 — Eraser

- Makes selected pixels transparent (alpha set to 0).
- Supports clicking and continuous erasing while dragging.
- Supports mouse and touch via Pointer Events.
- Eraser mode sets pixel RGBA to `(0, 0, 0, 0)`.

### Phase 7 — Mirror X

- Reflects drawing across the vertical center axis.
- Mirror X coordinate: `mirrorX = width - 1 - x`.
- When enabled, drawing at `(x, y)` also draws at `(mirrorX, y)`.
- Works with both Pencil and Eraser.
- Avoids duplicate drawing when `x` equals `mirrorX` (center column).

### Phase 8 — Mirror Y

- Reflects drawing across the horizontal center axis.
- Mirror Y coordinate: `mirrorY = height - 1 - y`.
- When enabled, drawing at `(x, y)` also draws at `(x, mirrorY)`.
- Works with both Pencil and Eraser.
- Avoids duplicate drawing when `y` equals `mirrorY` (center row).

### Phase 9 — Combined Mirror

- Mirror X and Mirror Y can be enabled simultaneously.
- Drawing at `(x, y)` affects up to four positions:
  - `(x, y)`
  - `(mirrorX, y)`
  - `(x, mirrorY)`
  - `(mirrorX, mirrorY)`
- Duplicate coordinates are avoided (center axis drawing).
- Works correctly with both Pencil and Eraser.

### Phase 10 — Zoom

- Zoom levels: 1x, 2x, 4x, 8x, 16x, 32x, 64x.
- Zoom changes only the display size, not artwork dimensions.
- Uses CSS `transform: scale()` for rendering.
- CSS `image-rendering: pixelated` ensures sharp nearest-neighbor rendering.
- Pixels remain sharp at all zoom levels.

### Phase 11 — Pan

- Middle-click (button 1) drag to pan the canvas.
- Panning does not modify pixel data.
- Panning works correctly with zoom (pan offset is in screen pixels).
- CSS `transform: translate()` handles pan offset.
- Cursor changes to `grabbing` during pan.

### Phase 12 — Undo / Redo

- Undo stack stores snapshots of the pixel buffer (`Uint8Array`).
- Redo stack stores undone states.
- Maximum 100 history entries to limit memory.
- New canvas creation clears history.
- Keyboard shortcuts: `Ctrl+Z` (undo), `Ctrl+Y` (redo).
- Works with Pencil, Eraser, and Mirror operations.

### Phase 13 — PNG Import

- User selects a PNG file via file input.
- Image read in browser using `FileReader`.
- Image drawn to a temporary canvas to extract pixel data.
- Artwork dimensions set to the imported image dimensions.
- RGBA data preserved, including transparent pixels.
- Canvas size inputs updated to match imported image.
- History cleared on import.

### Phase 14 — PNG Export

- Exports the actual artwork dimensions (not display size).
- Pixel data copied to a temporary canvas via `ImageData`.
- Uses `canvas.toBlob()` with `image/png` MIME type.
- Preserves RGBA data and transparent pixels.
- No background color added.
- No editor UI, zoom, pan, or pixel grid included.
- Downloads as `pixel-art.png`.

### Phase 15 — Minimal UI

**Tools:**
- Pencil — draw pixels
- Eraser — erase pixels (make transparent)
- Color picker — select drawing color
- Mirror X — vertical axis mirroring toggle
- Mirror Y — horizontal axis mirroring toggle

**Controls:**
- New — create new canvas with custom dimensions
- Width / Height — input fields for canvas size
- Zoom — dropdown selector (1x to 64x)
- Undo / Redo — history navigation
- Import — load PNG file
- Export — save PNG file

**Keyboard Shortcuts:**
- `P` — Pencil tool
- `E` — Eraser tool
- `M` — Toggle Mirror X
- `N` — Toggle Mirror Y
- `Ctrl+Z` — Undo
- `Ctrl+Y` — Redo

### Phase 16 — Mobile / Touch

- Pointer Events used for all drawing input (unified mouse/touch).
- Touch drawing enabled on canvas.
- Page scrolling prevented during touch drawing via `touch-action: none` and `e.preventDefault()`.
- Eraser works with touch input.
- Mirror operations work with touch.
- Zoom and pan usable with touch (pan via middle-click only, touch drawing for pixels).
- `user-scalable=no` viewport meta prevents accidental zoom.

### Phase 17 — Performance

- Pixel data stored in a single `Uint8Array` (compact, typed array).
- No DOM elements created for individual pixels.
- No unnecessary full-state copies — only pixel buffer snapshots on draw end.
- Canvas redraw only when pixel data changes.
- `Uint8Array.set()` used for fast pixel copying.
- Memory bounded by 100 undo entries.
- Canvas 2D only — no WebGL/WebGPU overhead.
- Startup is fast — no initialization beyond canvas setup.

### Phase 18 — Final Cleanup

**Verified:**
- Only HTML, CSS, and JavaScript used.
- No external dependencies.
- No Node.js code.
- No backend code.
- Canvas uses only 2D context.
- Pencil works with mouse and touch.
- Color picker works.
- Eraser works with mouse and touch.
- Mirror X works with Pencil and Eraser.
- Mirror Y works with Pencil and Eraser.
- Combined mirroring works correctly.
- Custom canvas sizes work (with validation).
- Mouse input works.
- Touch input works.
- Zoom works (1x to 64x, sharp pixels).
- Pan works (middle-click, with zoom).
- Undo/Redo works (up to 100 steps).
- PNG import works (preserves RGBA, transparency, dimensions).
- Transparent PNG export works (no background, no UI).

**Removed:**
- No unused code.
- No unnecessary abstractions.
- No external libraries.
- No animation, layers, timelines, or shape tools.

---

## Out of Scope (Explicitly Not Implemented)

- Animation, timelines, animation frames
- Layers, onion skin
- Shape tools, line tool, rectangle tool, circle tool
- Fill tool, selection tool
- Audio, shaders, post-processing, bloom
- WebGL, WebGL2, WebGPU
- Node.js, npm, backend, build tools
- React, Vue, Svelte, external frameworks, external rendering libraries
- Pen/stylus input

---

## Technical Details

### Pixel Buffer Format

- Format: `Uint8Array` with RGBA channels per pixel.
- Layout: `[r0, g0, b0, a0, r1, g1, b1, a1, ...]`
- Index for pixel at `(x, y)`: `(y * width + x) * 4`

### Coordinate System

- Pixel coordinates: `(0, 0)` at top-left, `(width-1, height-1)` at bottom-right.
- Screen coordinates: transformed by zoom scale and pan offset.
- Conversion: `pixelX = Math.floor((screenX - panX) / zoom)`

### Mirror Math

- Mirror X: `mirrorX = width - 1 - x`
- Mirror Y: `mirrorY = height - 1 - y`
- Combined: four symmetric positions drawn simultaneously.

### History System

- Each drawing action (pointer up) pushes a copy of the pixel buffer onto the undo stack.
- Redo stack cleared on new drawing action.
- Max 100 entries; oldest removed when exceeded.

---

## Browser Compatibility

- Requires a modern browser with Pointer Events support.
- Works in Chrome, Firefox, Safari, Edge.
- Works on desktop and mobile browsers.
