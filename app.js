(function () {
  "use strict";

  // ==================== STATE ====================
  const state = {
    width: 64,
    height: 64,
    pixels: null,
    frames: [],
    currentFrame: 0,
    tool: "pencil",
    lastPaintTool: "pencil", // remembers pencil/eraser so the eyedropper can hand control back
    color: { r: 94, g: 234, b: 212, a: 255 },
    mirrorX: false,
    mirrorY: false,
    zoom: 4,
    brushSize: 1, // shared by pencil and eraser
    rotation: 0, // degrees, view-only (does not touch pixel data)
    panX: 0,
    panY: 0,
    undoStack: [],
    redoStack: [],
    isDrawing: false,
    lastPixel: null,
    activePointerId: null,
    showGrid: true,
    onionSkin: false,
    hoverPixel: null, // {x, y} last hovered cell, or null when pointer is off-canvas
    selection: null, // {x, y, w, h} in pixel coords, or null
    selecting: null, // {startX, startY} while a marquee drag is in progress
    floating: null, // {data, x, y, w, h} the picked-up selection while it's being moved
    movingSelection: null, // {startX, startY, origX, origY} while dragging a floating selection
    resizing: null, // {handle, origRect, origData, origW, origH} while dragging a resize handle
  };

  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 64;

  // ==================== DOM REFS ====================
  const displayCanvas = document.getElementById("display-canvas");
  const ctx = displayCanvas.getContext("2d");
  const overlayCanvas = document.getElementById("overlay-canvas");
  const overlayCtx = overlayCanvas.getContext("2d");
  const btnSelect = document.getElementById("btn-select");
  const btnGrid = document.getElementById("btn-grid");
  const btnOnion = document.getElementById("btn-onion");
  const inputWidth = document.getElementById("input-width");
  const inputHeight = document.getElementById("input-height");
  const colorWheel = document.getElementById("color-wheel");
  const wheelCtx = colorWheel.getContext("2d");
  const wheelDot = document.getElementById("wheel-dot");
  const valueSlider = document.getElementById("value-slider");
  const colorSwatch = document.getElementById("color-swatch");
  const hexInput = document.getElementById("hex-input");
  const btnPencil = document.getElementById("btn-pencil");
  const btnEraser = document.getElementById("btn-eraser");
  const btnEyedropper = document.getElementById("btn-eyedropper");
  const brushSizeNumber = document.getElementById("brush-size-number");
  const toolbar = document.getElementById("toolbar");
  const toolbarToggle = document.getElementById("toolbar-toggle");
  const frameLabel = document.getElementById("frame-label");
  const btnFramePrev = document.getElementById("btn-frame-prev");
  const btnFrameNext = document.getElementById("btn-frame-next");
  const btnFrameAdd = document.getElementById("btn-frame-add");
  const btnFrameCopy = document.getElementById("btn-frame-copy");
  const btnFrameDelete = document.getElementById("btn-frame-delete");
  const btnFrameExport = document.getElementById("btn-frame-export");
  const btnFramePlay = document.getElementById("btn-frame-play");
  const fpsInput = document.getElementById("fps-input");
  const btnMirrorX = document.getElementById("btn-mirror-x");
  const btnMirrorY = document.getElementById("btn-mirror-y");
  const btnNew = document.getElementById("btn-new");
  const sizeGroup = document.getElementById("size-group");
  const sizeGroupEndDivider = document.getElementById("size-group-end-divider");
  const topbarCanvasAnchor = document.getElementById("topbar-canvas-anchor");
  const topbarCanvasAnchorDivider = document.getElementById("topbar-canvas-anchor-divider");
  const zoomSelect = document.getElementById("zoom-select");
  const btnRotateLeft = document.getElementById("btn-rotate-left");
  const btnRotateRight = document.getElementById("btn-rotate-right");
  const btnResetView = document.getElementById("btn-reset-view");
  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");
  const btnImport = document.getElementById("btn-import");
  const btnExport = document.getElementById("btn-export");
  const exportFilenameInput = document.getElementById("export-filename");
  const fileInput = document.getElementById("file-input");
  const projectSelect = document.getElementById("project-select");
  const projectName = document.getElementById("project-name");
  const btnProjectSave = document.getElementById("btn-project-save");
  const btnProjectLoad = document.getElementById("btn-project-load");
  const btnProjectDelete = document.getElementById("btn-project-delete");
  const canvasWrapper = document.getElementById("canvas-wrapper");
  const statusSize = document.getElementById("status-size");
  const statusPixel = document.getElementById("status-pixel");
  const statusZoom = document.getElementById("status-zoom");

  // ==================== PIXEL BUFFER ====================
  function createPixels(w, h) {
    return new Uint8Array(w * h * 4);
  }

  function setPixel(data, w, x, y, r, g, b, a) {
    const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  }

  function copyPixels(src, dst) {
    dst.set(src);
  }

  // ==================== CANVAS SETUP ====================
  // The canvas element's own CSS box always stays at 1 CSS px per
  // pixel. Panning, zooming and rotating are all pure view transforms
  // applied via a single CSS transform, so they never touch pixel
  // data and getCanvasCoords() only has to invert one matrix.
  function setupCanvas(framesOverride) {
    stopPlayback();
    const w = state.width;
    const h = state.height;
    if (framesOverride && framesOverride.length) {
      state.frames = framesOverride;
      state.pixels = state.frames[0];
    } else {
      state.pixels = createPixels(w, h);
      state.frames = [state.pixels];
    }
    state.currentFrame = 0;

    displayCanvas.width = w;
    displayCanvas.height = h;
    displayCanvas.style.width = w + "px";
    displayCanvas.style.height = h + "px";

    resizeOverlayCanvas();

    ctx.imageSmoothingEnabled = false;

    state.rotation = 0;
    centerCanvas();
    clearSelection();

    state.undoStack = [];
    state.redoStack = [];
    saveState();

    statusSize.innerHTML = "Canvas: <b>" + w + " \u00d7 " + h + "</b>";
    updateFrameLabel();
    render();
  }

  // The overlay canvas (grid / hover / selection) is drawn straight in
  // screen space rather than riding the display canvas's own CSS
  // transform: at small canvas sizes (e.g. 64x64) a hairline drawn into
  // that tiny raster and then scaled up by the transform becomes a
  // fraction of a raster pixel wide and all but disappears. Sizing the
  // overlay to the actual on-screen viewport (with a devicePixelRatio
  // scale for crispness on high-DPI screens) means every line is drawn
  // at full screen resolution and stays a clean, constant CSS-pixel
  // width no matter how far zoomed in or out we are.
  function resizeOverlayCanvas() {
    const rect = canvasWrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    overlayCanvas.width = Math.max(1, Math.round(cssW * dpr));
    overlayCanvas.height = Math.max(1, Math.round(cssH * dpr));
    overlayCanvas.style.width = cssW + "px";
    overlayCanvas.style.height = cssH + "px";
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Positions pan so the canvas's own center sits at the middle of the
  // workspace, honoring whatever zoom/rotation is currently set.
  function centerCanvas() {
    const rect = canvasWrapper.getBoundingClientRect();
    const offset = toScreenOffset(state.width / 2, state.height / 2, state.zoom, state.rotation);
    state.panX = rect.width / 2 - offset.x;
    state.panY = rect.height / 2 - offset.y;
  }

  // ==================== RENDER ====================
  // Scratch canvas reused for onion-skin layers and for compositing
  // the current frame itself, so drawImage() (which respects alpha,
  // unlike putImageData) can layer everything with correct transparency.
  const scratchCanvas = document.createElement("canvas");
  const scratchCtx = scratchCanvas.getContext("2d");

  function drawFrameLayer(pixels, w, h, alpha, tint, dx, dy) {
    scratchCanvas.width = w;
    scratchCanvas.height = h;
    scratchCtx.clearRect(0, 0, w, h);
    const imgData = scratchCtx.createImageData(w, h);
    imgData.data.set(pixels);
    scratchCtx.putImageData(imgData, 0, 0);
    if (tint) {
      scratchCtx.globalCompositeOperation = "source-atop";
      scratchCtx.fillStyle = tint;
      scratchCtx.fillRect(0, 0, w, h);
      scratchCtx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = alpha;
    ctx.drawImage(scratchCanvas, dx || 0, dy || 0);
    ctx.globalAlpha = 1;
  }

  function render() {
    const w = state.width;
    const h = state.height;

    ctx.clearRect(0, 0, w, h);

    if (state.onionSkin) {
      const prev = state.frames[state.currentFrame - 1];
      const next = state.frames[state.currentFrame + 1];
      if (prev) drawFrameLayer(prev, w, h, 0.35, "#3b82f6"); // previous frame, blue
      if (next) drawFrameLayer(next, w, h, 0.35, "#f97316"); // next frame, orange
    }

    drawFrameLayer(state.pixels, w, h, 1, null);

    // A selection currently picked up and being dragged floats on top
    // of the (already-cleared) pixel buffer underneath it.
    if (state.floating) {
      drawFrameLayer(state.floating.data, state.floating.w, state.floating.h, 1, null, state.floating.x, state.floating.y);
    }

    applyTransform();
    updateHistoryButtons();
    renderOverlay();
  }

  // ==================== OVERLAY (grid, hover cell, selection) ====================
  // Drawn on a separate canvas stacked on top of the display canvas so
  // none of it ever touches the actual pixel data. It shares the exact
  // same CSS transform as the display canvas (see applyTransform), so
  // line widths are given in "1 / zoom" units to stay a crisp ~1 CSS
  // pixel wide on screen no matter how far zoomed in or out we are.
  // Returns the rect (in pixel coords) that the current tool's brush
  // would actually stamp if you clicked at (cx, cy) — mirrors
  // stampBrush()'s own centering math so the hover highlight always
  // matches what pencil/eraser would draw. Always a square.
  function brushHighlightRect(cx, cy) {
    if ((state.tool === "pencil" || state.tool === "eraser") && state.brushSize > 1) {
      const size = state.brushSize;
      const half = Math.floor(size / 2);
      return { x: cx - half, y: cy - half, w: size, h: size };
    }
    return { x: cx, y: cy, w: 1, h: 1 };
  }

  function renderOverlay() {
    const rect = canvasWrapper.getBoundingClientRect();
    overlayCtx.clearRect(0, 0, rect.width, rect.height);

    const w = state.width, h = state.height;
    const rad = (state.rotation * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    // Local canvas-pixel coords -> screen coords, matching
    // toScreenOffset()'s math (rotate then scale, plus pan).
    function toScreen(lx, ly) {
      return {
        x: state.panX + state.zoom * (lx * cosR - ly * sinR),
        y: state.panY + state.zoom * (lx * sinR + ly * cosR),
      };
    }

    function pathForLocalRect(r) {
      const c0 = toScreen(r.x, r.y);
      const c1 = toScreen(r.x + r.w, r.y);
      const c2 = toScreen(r.x + r.w, r.y + r.h);
      const c3 = toScreen(r.x, r.y + r.h);
      overlayCtx.beginPath();
      overlayCtx.moveTo(c0.x, c0.y);
      overlayCtx.lineTo(c1.x, c1.y);
      overlayCtx.lineTo(c2.x, c2.y);
      overlayCtx.lineTo(c3.x, c3.y);
      overlayCtx.closePath();
    }

    if (state.showGrid && state.zoom >= 2) {
      overlayCtx.beginPath();
      for (let x = 0; x <= w; x++) {
        const p1 = toScreen(x, 0), p2 = toScreen(x, h);
        overlayCtx.moveTo(p1.x, p1.y);
        overlayCtx.lineTo(p2.x, p2.y);
      }
      for (let y = 0; y <= h; y++) {
        const p1 = toScreen(0, y), p2 = toScreen(w, y);
        overlayCtx.moveTo(p1.x, p1.y);
        overlayCtx.lineTo(p2.x, p2.y);
      }
      // Stroke the same path twice — a darker, slightly wider line
      // first, then a lighter, thinner one on top of it — so a thin
      // contrasting rim is left on both sides. That keeps the grid
      // readable over both light and dark pixel colors, instead of
      // disappearing against a light theme or light artwork.
      overlayCtx.strokeStyle = "rgba(0,0,0,0.45)";
      overlayCtx.lineWidth = 2;
      overlayCtx.stroke();
      overlayCtx.strokeStyle = "rgba(255,255,255,0.55)";
      overlayCtx.lineWidth = 1;
      overlayCtx.stroke();
    }

    if (state.hoverPixel && !state.isDrawing) {
      const hr = brushHighlightRect(state.hoverPixel.x, state.hoverPixel.y);
      // A dark outline under the light one keeps the highlight visible
      // against both light and dark pixel colors underneath it.
      pathForLocalRect(hr);
      overlayCtx.strokeStyle = "rgba(0,0,0,0.65)";
      overlayCtx.lineWidth = 3.5;
      overlayCtx.stroke();
      pathForLocalRect(hr);
      overlayCtx.strokeStyle = "rgba(255,255,255,0.95)";
      overlayCtx.lineWidth = 1.5;
      overlayCtx.stroke();
    }

    const sel = state.floating
      ? { x: state.floating.x, y: state.floating.y, w: state.floating.w, h: state.floating.h }
      : state.selection;
    if (sel) {
      pathForLocalRect(sel);
      overlayCtx.fillStyle = "rgba(94,234,212,0.15)";
      overlayCtx.fill();
      pathForLocalRect(sel);
      overlayCtx.strokeStyle = "rgba(94,234,212,0.95)";
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([5, 4]);
      overlayCtx.stroke();
      overlayCtx.setLineDash([]);

      // Resize handles: small filled squares at each corner/edge
      // midpoint, only once there's a settled selection to grab (not
      // while a fresh marquee is still being dragged out).
      if (state.tool === "select" && !state.selecting) {
        const pts = handlePoints(sel);
        const hs = 6; // handle square half-size, in screen px
        for (let i = 0; i < HANDLE_NAMES.length; i++) {
          const p = toScreen(pts[HANDLE_NAMES[i]].x, pts[HANDLE_NAMES[i]].y);
          overlayCtx.fillStyle = "#0f172a";
          overlayCtx.fillRect(p.x - hs / 2 - 1, p.y - hs / 2 - 1, hs + 2, hs + 2);
          overlayCtx.fillStyle = "#5eead4";
          overlayCtx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
        }
      }
    }
  }

  function normalizeRect(x0, y0, x1, y1) {
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    const w = Math.abs(x1 - x0) + 1;
    const h = Math.abs(y1 - y0) + 1;
    return { x: x, y: y, w: w, h: h };
  }

  function pointInRect(px, py, r) {
    return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
  }

  // Lifts the pixels inside `rect` off the buffer into a floating
  // layer (clearing them from state.pixels underneath), so they can be
  // dragged around without touching the rest of the drawing.
  function liftSelectionToFloating(rect) {
    const w = state.width, h = state.height;
    const data = new Uint8Array(rect.w * rect.h * 4);
    for (let y = 0; y < rect.h; y++) {
      const sy = rect.y + y;
      if (sy < 0 || sy >= h) continue;
      for (let x = 0; x < rect.w; x++) {
        const sx = rect.x + x;
        if (sx < 0 || sx >= w) continue;
        const si = (sy * w + sx) * 4;
        const di = (y * rect.w + x) * 4;
        data[di] = state.pixels[si];
        data[di + 1] = state.pixels[si + 1];
        data[di + 2] = state.pixels[si + 2];
        data[di + 3] = state.pixels[si + 3];
        state.pixels[si] = 0; state.pixels[si + 1] = 0; state.pixels[si + 2] = 0; state.pixels[si + 3] = 0;
      }
    }
    state.floating = { data: data, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }

  // Stamps a floating selection back into the pixel buffer at its
  // current position, clipping anything that's been dragged off-canvas.
  function commitFloating() {
    if (!state.floating) return;
    const f = state.floating;
    const w = state.width, h = state.height;
    for (let y = 0; y < f.h; y++) {
      const dy = f.y + y;
      if (dy < 0 || dy >= h) continue;
      for (let x = 0; x < f.w; x++) {
        const dx = f.x + x;
        if (dx < 0 || dx >= w) continue;
        const si = (y * f.w + x) * 4;
        if (f.data[si + 3] === 0) continue; // don't paint transparent gaps over existing pixels
        const di = (dy * w + dx) * 4;
        state.pixels[di] = f.data[si];
        state.pixels[di + 1] = f.data[si + 1];
        state.pixels[di + 2] = f.data[si + 2];
        state.pixels[di + 3] = f.data[si + 3];
      }
    }
    state.selection = { x: f.x, y: f.y, w: f.w, h: f.h };
    state.floating = null;
  }

  function clearSelection() {
    const hadFloating = !!state.floating;
    if (state.floating) commitFloating();
    state.selection = null;
    state.selecting = null;
    state.movingSelection = null;
    state.resizing = null;
    if (hadFloating) saveState();
  }

  // ---- Resize handles ----
  // Handle names use compass points: corner handles ("nw","ne","sw","se")
  // resize both axes, edge handles ("n","s","e","w") resize one axis.
  const HANDLE_NAMES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const HANDLE_HIT_RADIUS_SCREEN = 7; // px, on screen, independent of zoom

  function handlePoints(rect) {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    return {
      nw: { x: rect.x, y: rect.y },
      n: { x: cx, y: rect.y },
      ne: { x: rect.x + rect.w, y: rect.y },
      e: { x: rect.x + rect.w, y: cy },
      se: { x: rect.x + rect.w, y: rect.y + rect.h },
      s: { x: cx, y: rect.y + rect.h },
      sw: { x: rect.x, y: rect.y + rect.h },
      w: { x: rect.x, y: cy },
    };
  }

  // Hit-tests the resize handles of `rect` against a point in *local*
  // (canvas-pixel) coordinates. The hit radius is specified in screen
  // pixels and converted through the current zoom so handles feel the
  // same size to grab regardless of zoom level.
  function hitTestHandle(px, py, rect) {
    const pts = handlePoints(rect);
    const radius = HANDLE_HIT_RADIUS_SCREEN / state.zoom;
    for (let i = 0; i < HANDLE_NAMES.length; i++) {
      const name = HANDLE_NAMES[i];
      const p = pts[name];
      if (Math.abs(px - p.x) <= radius && Math.abs(py - p.y) <= radius) return name;
    }
    return null;
  }

  // Computes the new selection rect while dragging `handle`, given the
  // rect it started from and the current pointer position (in local
  // pixel coords). When `symmetric` is true (Ctrl held) the rect grows
  // or shrinks equally in both directions around its original center,
  // instead of anchored at the opposite edge/corner.
  function computeResizedRect(handle, origRect, mx, my, symmetric) {
    const left = origRect.x, top = origRect.y;
    const right = origRect.x + origRect.w, bottom = origRect.y + origRect.h;
    const cx = origRect.x + origRect.w / 2, cy = origRect.y + origRect.h / 2;

    const affectsX = handle.indexOf("w") !== -1 || handle.indexOf("e") !== -1;
    const affectsY = handle.indexOf("n") !== -1 || handle.indexOf("s") !== -1;
    const isWest = handle.indexOf("w") !== -1;
    const isEast = handle.indexOf("e") !== -1;
    const isNorth = handle.indexOf("n") !== -1;
    const isSouth = handle.indexOf("s") !== -1;

    let nx = left, ny = top, nw = origRect.w, nh = origRect.h;

    if (affectsX) {
      if (symmetric) {
        const half = isWest ? (cx - mx) : (mx - cx);
        nw = Math.max(1, Math.round(half * 2));
        nx = Math.round(cx - nw / 2);
      } else if (isWest) {
        nw = Math.max(1, Math.round(right - mx));
        nx = right - nw;
      } else if (isEast) {
        nw = Math.max(1, Math.round(mx - left));
        nx = left;
      }
    }

    if (affectsY) {
      if (symmetric) {
        const half = isNorth ? (cy - my) : (my - cy);
        nh = Math.max(1, Math.round(half * 2));
        ny = Math.round(cy - nh / 2);
      } else if (isNorth) {
        nh = Math.max(1, Math.round(bottom - my));
        ny = bottom - nh;
      } else if (isSouth) {
        nh = Math.max(1, Math.round(my - top));
        ny = top;
      }
    }

    return { x: nx, y: ny, w: nw, h: nh };
  }

  // Nearest-neighbor resample of RGBA pixel data from one size to
  // another — keeps the crisp, blocky look pixel art needs (no
  // smoothing/blurring like a bilinear resize would introduce).
  function scalePixelData(src, sw, sh, dw, dh) {
    const out = new Uint8Array(dw * dh * 4);
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
        const si = (sy * sw + sx) * 4;
        const di = (y * dw + x) * 4;
        out[di] = src[si];
        out[di + 1] = src[si + 1];
        out[di + 2] = src[si + 2];
        out[di + 3] = src[si + 3];
      }
    }
    return out;
  }

  const HANDLE_CURSORS = {
    nw: "nwse-resize", se: "nwse-resize",
    ne: "nesw-resize", sw: "nesw-resize",
    n: "ns-resize", s: "ns-resize",
    e: "ew-resize", w: "ew-resize",
  };

  // Erases the pixels under the current selection (Delete/Backspace).
  function deleteSelectionContents() {
    if (state.floating) { state.floating = null; saveState(); render(); return; }
    if (!state.selection) return;
    const r = state.selection;
    const w = state.width, h = state.height;
    for (let y = 0; y < r.h; y++) {
      const py = r.y + y;
      if (py < 0 || py >= h) continue;
      for (let x = 0; x < r.w; x++) {
        const px = r.x + x;
        if (px < 0 || px >= w) continue;
        const i = (py * w + px) * 4;
        state.pixels[i] = 0; state.pixels[i + 1] = 0; state.pixels[i + 2] = 0; state.pixels[i + 3] = 0;
      }
    }
    saveState();
    render();
  }

  // Only updates the view transform + status text, skipping the
  // (relatively expensive) pixel buffer -> canvas upload. Used while
  // panning/zooming/rotating, where the pixel data itself never changes.
  function applyTransform() {
    const t =
      "translate(" + state.panX + "px," + state.panY + "px) " +
      "rotate(" + state.rotation + "deg) " +
      "scale(" + state.zoom + ")";
    displayCanvas.style.transform = t;
    displayCanvas.style.transformOrigin = "0 0";

    const zoomLabel = (Math.round(state.zoom * 100) / 100) + "\u00d7";
    const rotLabel = Math.round(((state.rotation % 360) + 360) % 360) + "\u00b0";
    statusZoom.innerHTML = "Zoom: <b>" + zoomLabel + "</b> \u00b7 Rotation: <b>" + rotLabel + "</b>";

    renderOverlay();
  }

  // ==================== COORDINATE CONVERSION ====================
  // Inverts translate -> rotate -> scale to turn a screen point into
  // a continuous (unfloored) local canvas-pixel coordinate.
  function toLocal(screenX, screenY, panX, panY, zoom, rotationDeg) {
    const rect = canvasWrapper.getBoundingClientRect();
    const dx = (screenX - rect.left) - panX;
    const dy = (screenY - rect.top) - panY;
    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      lx: (dx * cos + dy * sin) / zoom,
      ly: (-dx * sin + dy * cos) / zoom,
    };
  }

  // Forward-projects a local canvas point through rotate+scale only
  // (no pan), used to re-derive pan so a gesture's anchor point stays
  // fixed under the fingers/cursor.
  function toScreenOffset(lx, ly, zoom, rotationDeg) {
    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      x: zoom * (lx * cos - ly * sin),
      y: zoom * (lx * sin + ly * cos),
    };
  }

  function getCanvasCoords(clientX, clientY) {
    const { lx, ly } = toLocal(clientX, clientY, state.panX, state.panY, state.zoom, state.rotation);
    return { x: Math.floor(lx), y: Math.floor(ly) };
  }

  // ==================== DRAWING ====================
  function drawPixel(x, y, r, g, b, a) {
    if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;

    const w = state.width;
    setPixel(state.pixels, w, x, y, r, g, b, a);

    if (state.mirrorX) {
      const mx = w - 1 - x;
      if (mx !== x) setPixel(state.pixels, w, mx, y, r, g, b, a);
    }
    if (state.mirrorY) {
      const my = state.height - 1 - y;
      if (my !== y) setPixel(state.pixels, w, x, my, r, g, b, a);

      if (state.mirrorX) {
        const mx = w - 1 - x;
        if (mx !== x && my !== y) setPixel(state.pixels, w, mx, my, r, g, b, a);
      }
    }
  }

  function currentRGBA() {
    return state.tool === "eraser"
      ? { r: 0, g: 0, b: 0, a: 0 }
      : state.color;
  }

  // Stamps a square brush of state.brushSize centered on (cx, cy).
  // Shared by both pencil and eraser, since they only differ in the
  // RGBA value passed in (see currentRGBA()).
  function stampBrush(cx, cy, r, g, b, a) {
    const size = state.brushSize;
    if (size <= 1) {
      drawPixel(cx, cy, r, g, b, a);
      return;
    }
    const half = Math.floor(size / 2);
    const startX = cx - half;
    const startY = cy - half;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        drawPixel(startX + dx, startY + dy, r, g, b, a);
      }
    }
  }

  function drawLine(x0, y0, x1, y1, r, g, b, a) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      stampBrush(x0, y0, r, g, b, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dx) { err -= dy; x0 += sx; }
      if (e2 < dy) { err += dx; y0 += sy; }
    }
  }

  // Reads the pixel under (x, y) straight from the pixel buffer and
  // makes it the active color. Ignores fully transparent pixels so
  // sampling empty space doesn't wipe out the current color.
  function pickColorAt(x, y) {
    if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
    const w = state.width;
    const i = (y * w + x) * 4;
    const a = state.pixels[i + 3];
    if (a === 0) return;
    const rgb = { r: state.pixels[i], g: state.pixels[i + 1], b: state.pixels[i + 2] };
    syncWheelFromRgb(rgb);
    applyColor(rgb);
  }

  function startDraw(x, y) {
    stopPlayback();
    const c0 = getCanvasCoords(x, y);
    const px = c0.x, py = c0.y;
    const inBounds = px >= 0 && px < state.width && py >= 0 && py < state.height;

    if (state.tool === "select") {
      const activeRect = state.floating || state.selection;
      const handle = activeRect ? hitTestHandle(px, py, activeRect) : null;
      const insideActive = !!activeRect && pointInRect(px, py, activeRect);
      // Starting a brand-new marquee requires clicking on the canvas;
      // grabbing a handle or dragging the existing selection is fine
      // even if the pointer strays slightly past the edge.
      if (!handle && !insideActive && !inBounds) return;

      state.isDrawing = true;
      state.lastPixel = { x: px, y: py };
      state.hoverPixel = inBounds ? { x: px, y: py } : null;

      if (activeRect && handle) {
        // Grabbed a resize handle: lift the selection to floating (if
        // it isn't already) and remember its original pixels/rect so
        // every subsequent resize step resamples from a clean source
        // instead of compounding blur from repeated resizing.
        if (!state.floating) liftSelectionToFloating(state.selection);
        state.resizing = {
          handle: handle,
          origRect: { x: state.floating.x, y: state.floating.y, w: state.floating.w, h: state.floating.h },
          origData: state.floating.data,
          origW: state.floating.w,
          origH: state.floating.h,
        };
      } else if (insideActive) {
        // Clicked inside the existing selection: pick it up (lifting it
        // to a floating layer the first time) and start dragging it.
        if (!state.floating) liftSelectionToFloating(state.selection);
        state.movingSelection = { startX: px, startY: py, origX: state.floating.x, origY: state.floating.y };
      } else {
        // Clicked outside: drop any floating selection where it is and
        // start a brand-new marquee.
        if (state.floating) commitFloating();
        state.selecting = { startX: px, startY: py };
        state.selection = { x: px, y: py, w: 1, h: 1 };
      }
      if (inBounds) updatePixelStatus(px, py);
      render();
      return;
    }

    if (!inBounds) return;

    state.isDrawing = true;
    state.lastPixel = { x: px, y: py };
    state.hoverPixel = { x: px, y: py };

    if (state.tool === "eyedropper") {
      pickColorAt(px, py);
      updatePixelStatus(px, py);
      return;
    }

    const c = currentRGBA();
    stampBrush(px, py, c.r, c.g, c.b, c.a);
    updatePixelStatus(px, py);
    render();
  }

  function moveDraw(x, y, ctrlKey) {
    const c0 = getCanvasCoords(x, y);
    const px = c0.x, py = c0.y;
    const inBounds = px >= 0 && px < state.width && py >= 0 && py < state.height;
    state.hoverPixel = inBounds ? { x: px, y: py } : null;
    if (inBounds) updatePixelStatus(px, py);

    if (!state.isDrawing) {
      if (state.tool === "select") {
        const activeRect = state.floating || state.selection;
        const handle = activeRect ? hitTestHandle(px, py, activeRect) : null;
        canvasWrapper.style.cursor = handle
          ? HANDLE_CURSORS[handle]
          : (activeRect && pointInRect(px, py, activeRect) ? "move" : "crosshair");
      }
      renderOverlay();
      return;
    }

    if (state.tool === "select") {
      if (state.resizing) {
        const r = state.resizing;
        const newRect = computeResizedRect(r.handle, r.origRect, px, py, !!ctrlKey);
        state.floating = {
          data: scalePixelData(r.origData, r.origW, r.origH, newRect.w, newRect.h),
          x: newRect.x, y: newRect.y, w: newRect.w, h: newRect.h,
        };
        render();
      } else if (state.movingSelection) {
        const dx = px - state.movingSelection.startX;
        const dy = py - state.movingSelection.startY;
        state.floating.x = state.movingSelection.origX + dx;
        state.floating.y = state.movingSelection.origY + dy;
        render();
      } else if (state.selecting) {
        state.selection = normalizeRect(state.selecting.startX, state.selecting.startY, px, py);
        render();
      }
      return;
    }

    if (!inBounds) return;

    if (state.tool === "eyedropper") {
      pickColorAt(px, py);
      state.lastPixel = { x: px, y: py };
      return;
    }

    const c = currentRGBA();
    if (state.lastPixel) {
      drawLine(state.lastPixel.x, state.lastPixel.y, px, py, c.r, c.g, c.b, c.a);
    } else {
      stampBrush(px, py, c.r, c.g, c.b, c.a);
    }

    state.lastPixel = { x: px, y: py };
    render();
  }

  function endDraw() {
    if (!state.isDrawing) return;
    const wasEyedropper = state.tool === "eyedropper";
    const wasSelect = state.tool === "select";
    state.isDrawing = false;
    state.lastPixel = null;
    state.activePointerId = null;

    if (wasSelect) {
      if (state.resizing) {
        state.resizing = null;
        commitFloating();
        saveState();
        render();
      } else if (state.movingSelection) {
        state.movingSelection = null;
        commitFloating();
        saveState();
        render();
      } else if (state.selecting) {
        // A plain click with no drag (still a 1x1 rect) clears the
        // selection instead of leaving a single-pixel marquee behind.
        if (state.selection && state.selection.w <= 1 && state.selection.h <= 1) {
          state.selection = null;
        }
        state.selecting = null;
        render();
      }
      return;
    }

    if (wasEyedropper) {
      // Hand control back to whichever paint tool was active before
      // the eyedropper was picked up.
      selectTool(state.lastPaintTool || "pencil");
    } else {
      saveState();
    }
  }

  // Aborts an in-progress stroke without saving it to history — used
  // when a second touch arrives mid-stroke and the gesture switches
  // from drawing to pan/zoom/rotate.
  function cancelDraw() {
    state.isDrawing = false;
    state.lastPixel = null;
    state.activePointerId = null;
    state.selecting = null;
    state.movingSelection = null;
    state.resizing = null;
  }

  function updatePixelStatus(x, y) {
    statusPixel.textContent = "(" + x + ", " + y + ")";
  }

  // ==================== POINTER EVENTS (drawing) ====================
  // Touch strokes are held back briefly before the first pixel is
  // committed: if a second finger lands within that window it's a
  // pinch/rotate/pan gesture, not a stroke, and the pending draw is
  // dropped instead of stamping a stray pixel. A quick single tap
  // still draws immediately once it lifts, before the window closes.
  const TOUCH_DRAW_DELAY = 80;
  let pendingTouch = null;
  let pendingTouchTimer = null;

  function clearPendingTouch() {
    if (pendingTouchTimer !== null) { clearTimeout(pendingTouchTimer); pendingTouchTimer = null; }
    pendingTouch = null;
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    // A second touch landing while one is already tracked means a
    // pinch/rotate/pan gesture is starting, not a new stroke.
    if (e.pointerType === "touch" && touchPoints.size >= 1) return;

    if (e.pointerType === "touch") {
      try { displayCanvas.setPointerCapture(e.pointerId); } catch (err) {}
      pendingTouch = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      pendingTouchTimer = setTimeout(function () {
        pendingTouchTimer = null;
        if (pendingTouch && pendingTouch.pointerId === e.pointerId && touchPoints.size < 2) {
          state.activePointerId = pendingTouch.pointerId;
          startDraw(pendingTouch.x, pendingTouch.y);
        }
        pendingTouch = null;
      }, TOUCH_DRAW_DELAY);
      return;
    }

    state.activePointerId = e.pointerId;
    try { displayCanvas.setPointerCapture(e.pointerId); } catch (err) {}
    startDraw(e.clientX, e.clientY);
  }

  function onPointerMove(e) {
    if (pendingTouch && e.pointerId === pendingTouch.pointerId) {
      pendingTouch.x = e.clientX;
      pendingTouch.y = e.clientY;
    }
    if (state.activePointerId !== null && e.pointerId !== state.activePointerId) return;
    moveDraw(e.clientX, e.clientY, e.ctrlKey);
  }

  function onPointerUp(e) {
    // The touch lifted before the hold-back window elapsed: treat it
    // as a completed single tap and draw+finish right away, rather
    // than losing the tap entirely.
    if (pendingTouch && e.pointerId === pendingTouch.pointerId) {
      const pt = pendingTouch;
      clearPendingTouch();
      if (touchPoints.size < 2) {
        state.activePointerId = pt.pointerId;
        startDraw(pt.x, pt.y);
        endDraw();
      }
      return;
    }
    if (state.activePointerId !== null && e.pointerId !== state.activePointerId) return;
    endDraw();
  }

  displayCanvas.addEventListener("pointerdown", onPointerDown);
  displayCanvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  displayCanvas.addEventListener("pointerleave", function () {
    if (state.activePointerId === null) {
      statusPixel.textContent = "\u2014";
      state.hoverPixel = null;
      renderOverlay();
    }
  });

  // ==================== PAN (mouse, right-drag) / ROTATE (mouse, middle-drag) ====================
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panPointerId = null;

  let isRotating = false;
  let rotatePointerId = null;
  let rotateStartClientX = 0;
  let rotateStartRotation = 0;

  canvasWrapper.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  canvasWrapper.addEventListener("pointerdown", function (e) {
    if (e.button === 1) {
      isRotating = true;
      rotatePointerId = e.pointerId;
      rotateStartClientX = e.clientX;
      rotateStartRotation = state.rotation;
      canvasWrapper.style.cursor = "grabbing";
      e.preventDefault();
    } else if (e.button === 2) {
      isPanning = true;
      panPointerId = e.pointerId;
      panStartX = e.clientX - state.panX;
      panStartY = e.clientY - state.panY;
      canvasWrapper.style.cursor = "grabbing";
      e.preventDefault();
    }
  });

  window.addEventListener("pointermove", function (e) {
    if (isPanning && e.pointerId === panPointerId) {
      state.panX = e.clientX - panStartX;
      state.panY = e.clientY - panStartY;
      applyTransform();
    } else if (isRotating && e.pointerId === rotatePointerId) {
      // Pivots on the canvas's own center (same as rotateBy/touch),
      // driven by how far the mouse has dragged horizontally.
      const cx = state.width / 2;
      const cy = state.height / 2;
      const before = toScreenOffset(cx, cy, state.zoom, state.rotation);
      const screenX = state.panX + before.x;
      const screenY = state.panY + before.y;

      state.rotation = rotateStartRotation + (e.clientX - rotateStartClientX) * 0.5;

      const after = toScreenOffset(cx, cy, state.zoom, state.rotation);
      state.panX = screenX - after.x;
      state.panY = screenY - after.y;
      applyTransform();
    }
  });

  window.addEventListener("pointerup", function (e) {
    if (isPanning && e.pointerId === panPointerId) {
      isPanning = false;
      panPointerId = null;
      canvasWrapper.style.cursor = state.tool === "eraser" ? "cell" : "crosshair";
    } else if (isRotating && e.pointerId === rotatePointerId) {
      isRotating = false;
      rotatePointerId = null;
      canvasWrapper.style.cursor = state.tool === "eraser" ? "cell" : "crosshair";
    }
  });

  // ==================== ZOOM (mouse wheel) ====================
  // Anchors on the cursor position so whatever's under the pointer
  // stays put as the view scales in/out.
  canvasWrapper.addEventListener("wheel", function (e) {
    e.preventDefault();
    const factor = Math.pow(1.0016, -e.deltaY);
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom * factor));

    // Pivot on the canvas's own center (same as the two-finger touch
    // gesture) rather than the cursor position, so the view scales in
    // place instead of drifting toward wherever the mouse happens to be.
    const offset = toScreenOffset(state.width / 2, state.height / 2, state.zoom, state.rotation);
    const screenX = state.panX + offset.x;
    const screenY = state.panY + offset.y;
    const newOffset = toScreenOffset(state.width / 2, state.height / 2, newZoom, state.rotation);
    state.zoom = newZoom;
    state.panX = screenX - newOffset.x;
    state.panY = screenY - newOffset.y;
    applyTransform();
  }, { passive: false });

  // ==================== PAN / ZOOM / ROTATE (two-finger touch) ====================
  const touchPoints = new Map(); // pointerId -> {x, y}
  let gesture = null;
  let gestureFramePending = false;

  function touchDist(p1, p2) { return Math.hypot(p2.x - p1.x, p2.y - p1.y); }
  function touchAngle(p1, p2) { return (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI; }
  function touchMid(p1, p2) { return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }; }

  window.addEventListener("pointerdown", function (e) {
    if (e.pointerType !== "touch") return;
    touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (touchPoints.size === 2) {
      clearPendingTouch();
      cancelDraw();
      const pts = Array.from(touchPoints.values());
      const mid = touchMid(pts[0], pts[1]);
      // Pivot always stays on the canvas's own center — not the
      // fingers — so the canvas spins/scales in place. To avoid a
      // jump the instant the second finger lands, we don't snap pan
      // to the finger midpoint; we only track how far the midpoint
      // moves from here on and slide the (still center-pivoted) view
      // by that same delta.
      const offset0 = toScreenOffset(state.width / 2, state.height / 2, state.zoom, state.rotation);
      gesture = {
        startDist: touchDist(pts[0], pts[1]),
        startAngle: touchAngle(pts[0], pts[1]),
        startZoom: state.zoom,
        startRotation: state.rotation,
        anchorLx: state.width / 2,
        anchorLy: state.height / 2,
        startMidX: mid.x,
        startMidY: mid.y,
        startScreenX: state.panX + offset0.x,
        startScreenY: state.panY + offset0.y,
      };
    }
  });

  // Touch fires pointermove far more often than the screen can repaint,
  // so we only record the latest finger positions here and let a single
  // requestAnimationFrame callback per frame do the (heavier) transform
  // math — applying every single event immediately is what was causing
  // the stutter during pinch/rotate.
  function applyGestureFrame() {
    gestureFramePending = false;
    if (touchPoints.size !== 2 || !gesture) return;
    const pts = Array.from(touchPoints.values());
    const dist = touchDist(pts[0], pts[1]);
    const angle = touchAngle(pts[0], pts[1]);
    const mid = touchMid(pts[0], pts[1]);

    let newZoom = gesture.startZoom * (dist / gesture.startDist);
    newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    const newRotation = gesture.startRotation + (angle - gesture.startAngle);

    const offset = toScreenOffset(gesture.anchorLx, gesture.anchorLy, newZoom, newRotation);
    const targetScreenX = gesture.startScreenX + (mid.x - gesture.startMidX);
    const targetScreenY = gesture.startScreenY + (mid.y - gesture.startMidY);
    state.zoom = newZoom;
    state.rotation = newRotation;
    state.panX = targetScreenX - offset.x;
    state.panY = targetScreenY - offset.y;
    applyTransform();
  }

  window.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "touch" || !touchPoints.has(e.pointerId)) return;
    touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (touchPoints.size === 2 && gesture && !gestureFramePending) {
      gestureFramePending = true;
      requestAnimationFrame(applyGestureFrame);
    }
  });

  function releaseTouch(e) {
    if (e.pointerType !== "touch") return;
    touchPoints.delete(e.pointerId);
    if (touchPoints.size < 2) gesture = null;
  }
  window.addEventListener("pointerup", releaseTouch);
  window.addEventListener("pointercancel", releaseTouch);

  // ==================== UNDO / REDO ====================
  function saveState() {
    const snapshot = new Uint8Array(state.pixels);
    state.undoStack.push(snapshot);
    if (state.undoStack.length > 100) state.undoStack.shift();
    state.redoStack = [];
    updateHistoryButtons();
  }

  function undo() {
    if (state.undoStack.length <= 1) return;
    const current = state.undoStack.pop();
    state.redoStack.push(current);
    const prev = state.undoStack[state.undoStack.length - 1];
    copyPixels(new Uint8Array(prev), state.pixels);
    render();
  }

  function redo() {
    if (state.redoStack.length === 0) return;
    const next = state.redoStack.pop();
    state.undoStack.push(next);
    copyPixels(new Uint8Array(next), state.pixels);
    render();
  }

  function updateHistoryButtons() {
    btnUndo.disabled = state.undoStack.length <= 1;
    btnRedo.disabled = state.redoStack.length === 0;
  }

  // ==================== NEW CANVAS ====================
  function createNewCanvas() {
    const w = parseInt(inputWidth.value, 10);
    const h = parseInt(inputHeight.value, 10);

    if (isNaN(w) || isNaN(h)) { alert("Please enter valid numbers for width and height."); return; }
    if (w < 1 || h < 1) { alert("Width and height must be positive."); return; }
    if (w > 2048 || h > 2048) { alert("Maximum size is 2048\u00d72048."); return; }

    state.width = w;
    state.height = h;
    setupCanvas();
  }

  // ==================== COLOR WHEEL ====================
  // The wheel encodes hue as angle and saturation as radius (HSV);
  // brightness/value is a separate slider since a 2D wheel can't show
  // three dimensions at once. Hex field, swatch, wheel dot and slider
  // are all kept in sync with state.color from whichever one changes.
  let wheelHue = 0;
  let wheelSat = 0;
  let wheelVal = 1;

  function hsvToRgb(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
    };
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : d / max;
    return { h: h, s: s, v: max };
  }

  function rgbToHex(r, g, b) {
    const toHex = (n) => n.toString(16).padStart(2, "0");
    return "#" + toHex(r) + toHex(g) + toHex(b);
  }

  function drawWheel() {
    const size = colorWheel.width;
    const cx = size / 2, cy = size / 2, radius = size / 2;
    const imgData = wheelCtx.createImageData(size, size);
    const data = imgData.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.hypot(dx, dy);
        const i = (y * size + x) * 4;
        if (dist <= radius) {
          let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          if (angle < 0) angle += 360;
          const sat = Math.min(dist / radius, 1);
          const rgb = hsvToRgb(angle, sat, wheelVal);
          data[i] = rgb.r; data[i + 1] = rgb.g; data[i + 2] = rgb.b;
          data[i + 3] = dist <= radius - 1 ? 255 : Math.max(0, 255 * (radius - dist));
        }
      }
    }
    wheelCtx.putImageData(imgData, 0, 0);
  }

  function positionDot() {
    const size = colorWheel.width;
    const radius = size / 2;
    const rad = (wheelHue * Math.PI) / 180;
    const dist = wheelSat * radius;
    const px = radius + Math.cos(rad) * dist;
    const py = radius + Math.sin(rad) * dist;
    wheelDot.style.left = (px / size) * 100 + "%";
    wheelDot.style.top = (py / size) * 100 + "%";
  }

  function applyColor(rgb, opts) {
    opts = opts || {};
    state.color = { r: rgb.r, g: rgb.g, b: rgb.b, a: 255 };
    if (state.tool === "eraser") selectTool("pencil");

    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    colorSwatch.style.background = hex;
    if (!opts.skipHex) hexInput.value = hex.toUpperCase();
  }

  // Sets the wheel/slider/hue-sat state from an RGB color (e.g. typed
  // into the hex field) and redraws everything to match.
  function syncWheelFromRgb(rgb) {
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    wheelHue = hsv.h;
    wheelSat = hsv.s;
    wheelVal = hsv.v;
    valueSlider.value = Math.round(wheelVal * 100);
    drawWheel();
    positionDot();
  }

  function onWheelPointer(e) {
    const rect = colorWheel.getBoundingClientRect();
    const size = rect.width;
    const radius = size / 2;
    const dx = e.clientX - rect.left - radius;
    const dy = e.clientY - rect.top - radius;
    const dist = Math.min(Math.hypot(dx, dy), radius);
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle < 0) angle += 360;

    wheelHue = angle;
    wheelSat = radius === 0 ? 0 : dist / radius;
    positionDot();

    const rgb = hsvToRgb(wheelHue, wheelSat, wheelVal);
    applyColor(rgb);
  }

  let wheelDragging = false;
  colorWheel.addEventListener("pointerdown", function (e) {
    wheelDragging = true;
    try { colorWheel.setPointerCapture(e.pointerId); } catch (err) {}
    onWheelPointer(e);
  });
  colorWheel.addEventListener("pointermove", function (e) {
    if (wheelDragging) onWheelPointer(e);
  });
  colorWheel.addEventListener("pointerup", function () { wheelDragging = false; });
  colorWheel.addEventListener("pointercancel", function () { wheelDragging = false; });

  valueSlider.addEventListener("input", function (e) {
    wheelVal = parseInt(e.target.value, 10) / 100;
    drawWheel();
    const rgb = hsvToRgb(wheelHue, wheelSat, wheelVal);
    applyColor(rgb);
  });

  function onHexInput() {
    let v = hexInput.value.trim();
    if (v[0] !== "#") v = "#" + v;
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) return;
    const rgb = {
      r: parseInt(v.slice(1, 3), 16),
      g: parseInt(v.slice(3, 5), 16),
      b: parseInt(v.slice(5, 7), 16),
    };
    syncWheelFromRgb(rgb);
    applyColor(rgb, { skipHex: true });
    hexInput.value = v.toUpperCase();
  }
  hexInput.addEventListener("change", onHexInput);
  hexInput.addEventListener("blur", onHexInput);

  // ==================== MIRROR ====================
  function toggleMirrorX() {
    state.mirrorX = !state.mirrorX;
    btnMirrorX.classList.toggle("active", state.mirrorX);
  }

  function toggleMirrorY() {
    state.mirrorY = !state.mirrorY;
    btnMirrorY.classList.toggle("active", state.mirrorY);
  }

  // ==================== CANVAS AIDS (grid / onion skin) ====================
  function toggleGrid() {
    state.showGrid = !state.showGrid;
    btnGrid.classList.toggle("active", state.showGrid);
    renderOverlay();
  }

  function toggleOnionSkin() {
    state.onionSkin = !state.onionSkin;
    btnOnion.classList.toggle("active", state.onionSkin);
    render();
  }

  // ==================== ZOOM / ROTATE / VIEW ====================
  function onZoomChange(e) {
    state.zoom = parseInt(e.target.value, 10);
    applyTransform();
  }

  // Rotation always pivots around the canvas's own center point,
  // regardless of current pan/zoom, by re-solving pan so that the
  // screen position of (width/2, height/2) doesn't move.
  function rotateBy(deltaDeg) {
    const cx = state.width / 2;
    const cy = state.height / 2;
    const before = toScreenOffset(cx, cy, state.zoom, state.rotation);
    const screenX = state.panX + before.x;
    const screenY = state.panY + before.y;

    state.rotation += deltaDeg;

    const after = toScreenOffset(cx, cy, state.zoom, state.rotation);
    state.panX = screenX - after.x;
    state.panY = screenY - after.y;
    applyTransform();
  }

  function resetView() {
    state.rotation = 0;
    state.zoom = parseInt(zoomSelect.value, 10) || 4;
    centerCanvas();
    applyTransform();
  }

  // ==================== PROJECTS (save/load via localStorage) ====================
  const PROJECTS_STORAGE_KEY = "pixelDrawProjects";

  // Uint8Array <-> base64, chunked so a big canvas doesn't blow the
  // call stack on String.fromCharCode.apply.
  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function loadProjectsIndex() {
    try {
      return JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) || "{}");
    } catch (err) {
      return {};
    }
  }

  function saveProjectsIndex(idx) {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(idx));
  }

  function refreshProjectSelect(selectName) {
    const idx = loadProjectsIndex();
    const names = Object.keys(idx).sort(function (a, b) { return a.localeCompare(b); });
    projectSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "\u2014 Projects \u2014";
    projectSelect.appendChild(placeholder);
    names.forEach(function (name) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      projectSelect.appendChild(opt);
    });
    projectSelect.value = names.indexOf(selectName) !== -1 ? selectName : "";
  }

  function serializeProject() {
    return {
      width: state.width,
      height: state.height,
      frames: state.frames.map(bytesToBase64),
      brushSize: state.brushSize,
      color: state.color,
      mirrorX: state.mirrorX,
      mirrorY: state.mirrorY,
      savedAt: Date.now(),
    };
  }

  function saveProject() {
    const name = projectName.value.trim();
    if (!name) { alert("Please enter a project name first."); return; }

    const idx = loadProjectsIndex();
    idx[name] = serializeProject();
    try {
      saveProjectsIndex(idx);
    } catch (err) {
      alert("Couldn't save the project (storage may be full): " + err.message);
      return;
    }
    refreshProjectSelect(name);
  }

  function loadProject(name) {
    if (!name) return;
    const idx = loadProjectsIndex();
    const proj = idx[name];
    if (!proj) return;

    stopPlayback();
    state.width = proj.width;
    state.height = proj.height;
    state.brushSize = proj.brushSize || 1;
    state.mirrorX = !!proj.mirrorX;
    state.mirrorY = !!proj.mirrorY;

    const frames = proj.frames.map(base64ToBytes);

    inputWidth.value = state.width;
    inputHeight.value = state.height;
    setBrushSize(state.brushSize, true);
    btnMirrorX.classList.toggle("active", state.mirrorX);
    btnMirrorY.classList.toggle("active", state.mirrorY);

    if (proj.color) {
      syncWheelFromRgb(proj.color);
      applyColor(proj.color);
    }

    setupCanvas(frames);
    projectName.value = name;
  }

  function deleteProject(name) {
    if (!name) return;
    if (!confirm('Delete project "' + name + '"? This can\'t be undone.')) return;
    const idx = loadProjectsIndex();
    delete idx[name];
    saveProjectsIndex(idx);
    refreshProjectSelect();
    projectName.value = "";
  }

  btnProjectSave.addEventListener("click", saveProject);
  btnProjectLoad.addEventListener("click", function () { loadProject(projectSelect.value); });
  btnProjectDelete.addEventListener("click", function () { deleteProject(projectSelect.value); });
  projectSelect.addEventListener("change", function () {
    if (projectSelect.value) projectName.value = projectSelect.value;
  });

  // ==================== PNG IMPORT ====================
  function onImportClick() {
    fileInput.click();
  }

  function onFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (evt) {
      const img = new Image();
      img.onload = function () {
        if (img.naturalWidth > 2048 || img.naturalHeight > 2048) {
          alert("Imported image is too large. Maximum size is 2048\u00d72048.");
          return;
        }
        const tmpCanvas = document.createElement("canvas");
        const tmpCtx = tmpCanvas.getContext("2d");
        tmpCanvas.width = img.naturalWidth;
        tmpCanvas.height = img.naturalHeight;
        tmpCtx.drawImage(img, 0, 0);
        const imgData = tmpCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);

        state.width = img.naturalWidth;
        state.height = img.naturalHeight;
        inputWidth.value = state.width;
        inputHeight.value = state.height;

        state.pixels = createPixels(state.width, state.height);
        copyPixels(imgData.data, state.pixels);
        state.frames = [state.pixels];
        state.currentFrame = 0;

        displayCanvas.width = state.width;
        displayCanvas.height = state.height;
        displayCanvas.style.width = state.width + "px";
        displayCanvas.style.height = state.height + "px";

        state.rotation = 0;
        centerCanvas();
        state.undoStack = [];
        state.redoStack = [];
        saveState();

        statusSize.innerHTML = "Canvas: <b>" + state.width + " \u00d7 " + state.height + "</b>";
        updateFrameLabel();
        render();
      };
      img.onerror = function () {
        alert("Couldn't read that file as a PNG image.");
      };
      img.src = evt.target.result;
    };
    reader.onerror = function () {
      alert("Couldn't read that file.");
    };
    reader.readAsDataURL(file);

    e.target.value = "";
  }

  // ==================== PNG EXPORT ====================
  // Shared by the single-frame PNG export and the animation ZIP
  // export. Reads the name field, strips characters that aren't safe
  // in a filename, and falls back to a default when it's empty.
  function getExportBaseName(fallback) {
    const raw = exportFilenameInput.value.trim();
    const cleaned = raw.replace(/[\\/:*?"<>|]+/g, "").trim();
    return cleaned || fallback;
  }

  function exportPNG() {
    const tmpCanvas = document.createElement("canvas");
    const tmpCtx = tmpCanvas.getContext("2d");
    tmpCanvas.width = state.width;
    tmpCanvas.height = state.height;

    const imgData = tmpCtx.createImageData(state.width, state.height);
    imgData.data.set(state.pixels);
    tmpCtx.putImageData(imgData, 0, 0);

    tmpCanvas.toBlob(function (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = getExportBaseName("pixel-art") + ".png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  // ==================== FRAMES (ANIMATION) ====================
  function updateFrameLabel() {
    frameLabel.textContent = (state.currentFrame + 1) + "/" + state.frames.length;
    btnFramePrev.disabled = state.currentFrame <= 0;
    btnFrameNext.disabled = state.currentFrame >= state.frames.length - 1;
    btnFrameDelete.disabled = state.frames.length <= 1;
    btnFramePlay.disabled = state.frames.length <= 1;
  }

  // Switches the working buffer to a different frame and gives it a
  // fresh undo history — history isn't shared across frames.
  function goToFrame(index) {
    if (index < 0 || index >= state.frames.length) return;
    clearSelection();
    state.currentFrame = index;
    state.pixels = state.frames[index];
    state.undoStack = [];
    state.redoStack = [];
    saveState();
    updateFrameLabel();
    render();
  }

  function copyFrame() {
    stopPlayback();
    const dup = new Uint8Array(state.pixels);
    state.frames.splice(state.currentFrame + 1, 0, dup);
    goToFrame(state.currentFrame + 1);
  }

  // Inserts a brand-new blank (fully transparent) frame right after
  // the current one, leaving every other frame untouched.
  function addEmptyFrame() {
    stopPlayback();
    const blank = createPixels(state.width, state.height);
    state.frames.splice(state.currentFrame + 1, 0, blank);
    goToFrame(state.currentFrame + 1);
  }

  function deleteFrame() {
    if (state.frames.length <= 1) return;
    stopPlayback();
    state.frames.splice(state.currentFrame, 1);
    goToFrame(Math.min(state.currentFrame, state.frames.length - 1));
  }

  // ==================== ANIMATION PLAYBACK ====================
  let isPlaying = false;
  let playTimer = null;

  const PLAY_ICON = '<path d="M7 5l12 7-12 7V5z" fill="currentColor"/>';
  const PAUSE_ICON = '<rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/>';

  function getFps() {
    const v = Math.max(1, Math.min(60, parseInt(fpsInput.value, 10) || 12));
    return v;
  }

  function advanceFrame() {
    const next = (state.currentFrame + 1) % state.frames.length;
    goToFrame(next);
  }

  function startPlayback() {
    if (isPlaying || state.frames.length <= 1) return;
    isPlaying = true;
    btnFramePlay.classList.add("playing");
    btnFramePlay.title = "Pause animation";
    btnFramePlay.querySelector(".icon").innerHTML = PAUSE_ICON;
    playTimer = setInterval(advanceFrame, 1000 / getFps());
  }

  function stopPlayback() {
    if (!isPlaying) return;
    isPlaying = false;
    clearInterval(playTimer);
    playTimer = null;
    btnFramePlay.classList.remove("playing");
    btnFramePlay.title = "Play animation";
    btnFramePlay.querySelector(".icon").innerHTML = PLAY_ICON;
  }

  function togglePlayback() {
    if (isPlaying) stopPlayback(); else startPlayback();
  }

  function restartPlaybackTimer() {
    if (!isPlaying) return;
    clearInterval(playTimer);
    playTimer = setInterval(advanceFrame, 1000 / getFps());
  }

  // Renders one frame's buffer onto an off-screen canvas and returns
  // it as a PNG blob (transparency intact, same as the single-frame
  // export).
  function frameToBlob(frameData) {
    return new Promise(function (resolve) {
      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = state.width;
      tmpCanvas.height = state.height;
      const tmpCtx = tmpCanvas.getContext("2d");
      const imgData = tmpCtx.createImageData(state.width, state.height);
      imgData.data.set(frameData);
      tmpCtx.putImageData(imgData, 0, 0);
      tmpCanvas.toBlob(resolve, "image/png");
    });
  }

  function frameFileName(index, baseName) {
    return (baseName || "frame") + "_" + String(index + 1).padStart(3, "0") + ".png";
  }

  // ==================== ZIP (store, no compression) ====================
  // A minimal, dependency-free ZIP writer. Uses the "store" method
  // (0% deflate) since implementing a real compressor isn't worth it
  // for PNG frames, which are already compressed — the ZIP here is
  // purely a container so every frame downloads as a single file.
  const CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // DOS date/time bit-packing, required by the ZIP local/central
  // headers. Uses "now" — these files never existed on a real disk.
  function dosDateTime() {
    const d = new Date();
    const time =
      ((d.getHours() & 0x1f) << 11) |
      ((d.getMinutes() & 0x3f) << 5) |
      ((d.getSeconds() >> 1) & 0x1f);
    const date =
      (((d.getFullYear() - 1980) & 0x7f) << 9) |
      (((d.getMonth() + 1) & 0xf) << 5) |
      (d.getDate() & 0x1f);
    return { time: time & 0xffff, date: date & 0xffff };
  }

  // Builds a single .zip Blob (store method) from [{name, data:Uint8Array}]
  function buildZip(files) {
    const { time, date } = dosDateTime();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const encoder = new TextEncoder();

    files.forEach(function (file) {
      const nameBytes = encoder.encode(file.name);
      const data = file.data;
      const crc = crc32(data);
      const size = data.length;

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); // local file header signature
      local.setUint16(4, 20, true); // version needed
      local.setUint16(6, 0, true); // flags
      local.setUint16(8, 0, true); // method: 0 = store
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true); // compressed size
      local.setUint32(22, size, true); // uncompressed size
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true); // extra field length
      localParts.push(new Uint8Array(local.buffer), nameBytes, data);

      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true); // central directory signature
      central.setUint16(4, 20, true); // version made by
      central.setUint16(6, 20, true); // version needed
      central.setUint16(8, 0, true); // flags
      central.setUint16(10, 0, true); // method: store
      central.setUint16(12, time, true);
      central.setUint16(14, date, true);
      central.setUint32(16, crc, true);
      central.setUint32(20, size, true);
      central.setUint32(24, size, true);
      central.setUint16(28, nameBytes.length, true);
      central.setUint16(30, 0, true); // extra length
      central.setUint16(32, 0, true); // comment length
      central.setUint16(34, 0, true); // disk number
      central.setUint16(36, 0, true); // internal attrs
      central.setUint32(38, 0, true); // external attrs
      central.setUint32(42, offset, true); // local header offset
      centralParts.push(new Uint8Array(central.buffer), nameBytes);

      offset += local.buffer.byteLength + nameBytes.length + size;
    });

    const centralSize = centralParts.reduce(function (sum, p) { return sum + p.length; }, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); // end of central directory signature
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true); // offset of central directory
    end.setUint16(20, 0, true); // comment length

    return new Blob(localParts.concat(centralParts, [new Uint8Array(end.buffer)]), {
      type: "application/zip",
    });
  }

  // Exports every frame as a numbered PNG bundled into a single .zip
  // file, so the whole animation downloads as one file instead of a
  // batch of individually-saved PNGs.
  async function exportAnimation() {
    if (!state.frames.length) return;

    const baseName = getExportBaseName("animation_frames");
    const files = [];
    for (let i = 0; i < state.frames.length; i++) {
      const blob = await frameToBlob(state.frames[i]);
      const buffer = await blob.arrayBuffer();
      files.push({ name: frameFileName(i, baseName), data: new Uint8Array(buffer) });
    }

    const zipName = baseName + ".zip";
    const zipBlob = buildZip(files);
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert("Exported " + state.frames.length + " frame(s) as " + zipName + ".");
  }

  // ==================== KEYBOARD SHORTCUTS ====================
  function onKeyDown(e) {
    if (e.target.tagName === "INPUT") return;

    if (e.ctrlKey && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if (e.ctrlKey && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      redo();
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === "p" || e.key === "P") selectTool("pencil");
      else if (e.key === "e" || e.key === "E") selectTool("eraser");
      else if (e.key === "i" || e.key === "I") selectTool("eyedropper");
      else if (e.key === "s" || e.key === "S") selectTool("select");
      else if (e.key === "g" || e.key === "G") toggleGrid();
      else if (e.key === "o" || e.key === "O") toggleOnionSkin();
      else if (e.key === "m" || e.key === "M") toggleMirrorX();
      else if (e.key === "n" || e.key === "N") toggleMirrorY();
      else if (e.key === "[") rotateBy(-15);
      else if (e.key === "]") rotateBy(15);
      else if (e.key === "Delete" || e.key === "Backspace") {
        if (state.selection || state.floating) {
          e.preventDefault();
          deleteSelectionContents();
        }
      } else if (e.key === "Escape") {
        if (state.selection || state.floating) {
          clearSelection();
          render();
        }
      }
    }
  }

  // ==================== TOOL SELECTION ====================
  function selectTool(tool) {
    if (tool !== "eyedropper") state.lastPaintTool = tool;
    if (tool !== "select" && state.floating) {
      commitFloating();
      saveState();
    }
    state.tool = tool;
    btnPencil.classList.toggle("active", tool === "pencil");
    btnEraser.classList.toggle("active", tool === "eraser");
    btnEyedropper.classList.toggle("active", tool === "eyedropper");
    btnSelect.classList.toggle("active", tool === "select");
    canvasWrapper.style.cursor =
      tool === "eraser" ? "cell" : tool === "eyedropper" ? "copy" : "crosshair";
    render();
  }

  // ==================== BRUSH SIZE (shared: pencil + eraser) ====================
  // Only touches state while the field is being typed into — never
  // rewrites what's on screen mid-typing (that used to force the box
  // back to "1" the instant it was cleared, so the next digit typed
  // landed after it instead of replacing it, e.g. clearing to type
  // "5" produced "15"). The displayed value only gets clamped/tidied
  // once the person leaves the field.
  function setBrushSize(v, commit) {
    const parsed = parseInt(v, 10);
    const valid = !isNaN(parsed);
    const clamped = Math.max(1, Math.min(64, valid ? parsed : state.brushSize));
    state.brushSize = clamped;
    if (commit) brushSizeNumber.value = clamped;
    renderOverlay();
  }
  brushSizeNumber.addEventListener("input", function (e) { setBrushSize(e.target.value, false); });
  brushSizeNumber.addEventListener("blur", function () { setBrushSize(brushSizeNumber.value, true); });

  // ==================== TOOLBAR COLLAPSE/EXPAND ====================
  // Toolbar starts collapsed to a slim strip; the toggle only ever
  // flips a width on the outer #toolbar box (see CSS) so the inner
  // panel's own layout/scroll never has to reflow.
  function toggleToolbar() {
    const collapsed = toolbar.classList.toggle("collapsed");
    toolbarToggle.setAttribute("data-collapsed", collapsed ? "true" : "false");
    toolbarToggle.title = collapsed ? "Expand toolbar" : "Collapse toolbar";
    document.getElementById("app").classList.toggle("sidebar-open", !collapsed);
  }

  // ==================== EVENT BINDINGS ====================
  btnPencil.addEventListener("click", function () { selectTool("pencil"); });
  btnEraser.addEventListener("click", function () { selectTool("eraser"); });
  btnEyedropper.addEventListener("click", function () { selectTool("eyedropper"); });
  btnSelect.addEventListener("click", function () { selectTool("select"); });
  btnGrid.addEventListener("click", toggleGrid);
  btnOnion.addEventListener("click", toggleOnionSkin);
  toolbarToggle.addEventListener("click", toggleToolbar);
  btnFramePrev.addEventListener("click", function () { stopPlayback(); goToFrame(state.currentFrame - 1); });
  btnFrameNext.addEventListener("click", function () { stopPlayback(); goToFrame(state.currentFrame + 1); });
  btnFrameAdd.addEventListener("click", addEmptyFrame);
  btnFrameCopy.addEventListener("click", copyFrame);
  btnFrameDelete.addEventListener("click", deleteFrame);
  btnFrameExport.addEventListener("click", function () { stopPlayback(); exportAnimation(); });
  btnFramePlay.addEventListener("click", togglePlayback);
  fpsInput.addEventListener("change", function () {
    fpsInput.value = getFps();
    restartPlaybackTimer();
  });
  fpsInput.addEventListener("input", restartPlaybackTimer);
  btnMirrorX.addEventListener("click", toggleMirrorX);
  btnMirrorY.addEventListener("click", toggleMirrorY);
  btnNew.addEventListener("click", createNewCanvas);
  zoomSelect.addEventListener("change", onZoomChange);
  btnRotateLeft.addEventListener("click", function () { rotateBy(-15); });
  btnRotateRight.addEventListener("click", function () { rotateBy(15); });
  btnResetView.addEventListener("click", resetView);

  // ==================== CANVAS-CREATE GROUP PLACEMENT ====================
  // The "New canvas" button + W/H inputs are a single DOM node
  // (#size-group). On mobile it stays in the sidebar next to the
  // resize controls it belongs with; on desktop it moves into the
  // topbar instead. Moving the same node (rather than duplicating
  // markup) means there's only one set of inputs/listeners to keep
  // in sync.
  //
  // Only a single divider (#size-group-end-divider) brackets the
  // group's slot in the sidebar, on the frames-group side, and it
  // stays put whether or not #size-group itself is currently there —
  // so there's never more than one divider line in that spot,
  // regardless of screen size.
  //
  // The topbar has the mirror problem: its anchor span is flanked by
  // a divider on each side, which is right when #size-group is
  // sitting there (desktop) but leaves the anchor empty with two
  // dividers touching on mobile. So the trailing one of that pair is
  // hidden whenever the group isn't actually in the topbar.
  const desktopLayoutQuery = window.matchMedia("(min-width: 481px)");
  function placeCanvasCreateGroup(isDesktop) {
    if (isDesktop) {
      if (sizeGroup.parentElement !== topbarCanvasAnchor.parentElement) {
        topbarCanvasAnchor.parentElement.insertBefore(sizeGroup, topbarCanvasAnchor);
      }
    } else {
      if (sizeGroup.nextElementSibling !== sizeGroupEndDivider) {
        sizeGroupEndDivider.parentElement.insertBefore(sizeGroup, sizeGroupEndDivider);
      }
    }
    topbarCanvasAnchorDivider.style.display = isDesktop ? "" : "none";
  }
  placeCanvasCreateGroup(desktopLayoutQuery.matches);
  desktopLayoutQuery.addEventListener("change", function (e) {
    placeCanvasCreateGroup(e.matches);
  });

  // ==================== DOCS OVERLAY ====================
  const docsOverlay = document.getElementById("docs-overlay");
  const btnDocs = document.getElementById("btn-docs");
  const btnDocsClose = document.getElementById("btn-docs-close");
  function openDocs() { docsOverlay.classList.remove("hidden"); }
  function closeDocs() { docsOverlay.classList.add("hidden"); }
  btnDocs.addEventListener("click", openDocs);
  btnDocsClose.addEventListener("click", closeDocs);
  docsOverlay.addEventListener("click", function (e) {
    if (e.target === docsOverlay) closeDocs();
  });
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !docsOverlay.classList.contains("hidden")) closeDocs();
  });
  btnUndo.addEventListener("click", undo);
  btnRedo.addEventListener("click", redo);
  btnImport.addEventListener("click", onImportClick);
  btnExport.addEventListener("click", exportPNG);
  fileInput.addEventListener("change", onFileChange);
  window.addEventListener("keydown", onKeyDown);

  displayCanvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  // One finger draws; two fingers pan/zoom/rotate (handled above), so
  // both touch counts need the browser's own scroll/zoom suppressed.
  canvasWrapper.addEventListener("touchstart", function (e) {
    if (e.touches.length === 1 || e.touches.length === 2) e.preventDefault();
  }, { passive: false });
  canvasWrapper.addEventListener("touchmove", function (e) {
    if (e.touches.length === 1 || e.touches.length === 2) e.preventDefault();
  }, { passive: false });

  // ==================== INIT ====================
  syncWheelFromRgb(state.color);
  colorSwatch.style.background = rgbToHex(state.color.r, state.color.g, state.color.b);
  setupCanvas();
  refreshProjectSelect();

  // Keeps the overlay canvas's own raster matched to the workspace's
  // actual on-screen size (window resizes, mobile orientation changes,
  // and the toolbar's animated collapse/expand all resize it).
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      resizeOverlayCanvas();
      renderOverlay();
    }).observe(canvasWrapper);
  }

  window.addEventListener("resize", function () {
    // Keep the canvas roughly centered as the workspace is resized,
    // e.g. rotating a phone or resizing the browser window.
    centerCanvas();
    applyTransform();
  });
})();
