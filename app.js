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
  };

  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 64;

  // ==================== DOM REFS ====================
  const displayCanvas = document.getElementById("display-canvas");
  const ctx = displayCanvas.getContext("2d");
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
  const zoomSelect = document.getElementById("zoom-select");
  const btnRotateLeft = document.getElementById("btn-rotate-left");
  const btnRotateRight = document.getElementById("btn-rotate-right");
  const btnResetView = document.getElementById("btn-reset-view");
  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");
  const btnImport = document.getElementById("btn-import");
  const btnExport = document.getElementById("btn-export");
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

    ctx.imageSmoothingEnabled = false;

    state.rotation = 0;
    centerCanvas();

    state.undoStack = [];
    state.redoStack = [];
    saveState();

    statusSize.innerHTML = "Canvas: <b>" + w + " \u00d7 " + h + "</b>";
    updateFrameLabel();
    render();
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
  function render() {
    const w = state.width;
    const h = state.height;

    const imgData = ctx.createImageData(w, h);
    imgData.data.set(state.pixels);
    ctx.putImageData(imgData, 0, 0);

    applyTransform();
    updateHistoryButtons();
  }

  // Only updates the view transform + status text, skipping the
  // (relatively expensive) pixel buffer -> canvas upload. Used while
  // panning/zooming/rotating, where the pixel data itself never changes.
  function applyTransform() {
    displayCanvas.style.transform =
      "translate(" + state.panX + "px," + state.panY + "px) " +
      "rotate(" + state.rotation + "deg) " +
      "scale(" + state.zoom + ")";
    displayCanvas.style.transformOrigin = "0 0";

    const zoomLabel = (Math.round(state.zoom * 100) / 100) + "\u00d7";
    const rotLabel = Math.round(((state.rotation % 360) + 360) % 360) + "\u00b0";
    statusZoom.innerHTML = "Zoom: <b>" + zoomLabel + "</b> \u00b7 Rotation: <b>" + rotLabel + "</b>";
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
    if (px < 0 || px >= state.width || py < 0 || py >= state.height) return;

    state.isDrawing = true;
    state.lastPixel = { x: px, y: py };

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

  function moveDraw(x, y) {
    const c0 = getCanvasCoords(x, y);
    const px = c0.x, py = c0.y;
    if (px >= 0 && px < state.width && py >= 0 && py < state.height) {
      updatePixelStatus(px, py);
    }
    if (!state.isDrawing) return;
    if (px < 0 || px >= state.width || py < 0 || py >= state.height) return;

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
    state.isDrawing = false;
    state.lastPixel = null;
    state.activePointerId = null;
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
    moveDraw(e.clientX, e.clientY);
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
    if (state.activePointerId === null) statusPixel.textContent = "\u2014";
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
      a.download = "pixel-art.png";
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

  function frameFileName(index) {
    return "frame_" + String(index + 1).padStart(3, "0") + ".png";
  }

  // Exports every frame as a numbered PNG. Where the browser supports
  // the File System Access API, the person picks a real folder and
  // the files are written straight into it; otherwise each frame is
  // downloaded individually (they land in the browser's default
  // downloads location instead).
  async function exportAnimation() {
    if (!state.frames.length) return;

    if ("showDirectoryPicker" in window) {
      let dirHandle;
      try {
        dirHandle = await window.showDirectoryPicker();
      } catch (err) {
        return; // person cancelled the picker
      }
      try {
        for (let i = 0; i < state.frames.length; i++) {
          const blob = await frameToBlob(state.frames[i]);
          const fileHandle = await dirHandle.getFileHandle(frameFileName(i), { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        }
        alert("Exported " + state.frames.length + " frame(s) to the selected folder.");
      } catch (err) {
        alert("Couldn't finish exporting to that folder: " + err.message);
      }
    } else {
      for (let i = 0; i < state.frames.length; i++) {
        const blob = await frameToBlob(state.frames[i]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = frameFileName(i);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        await new Promise(function (r) { setTimeout(r, 150); });
      }
      alert("Your browser can't pick a folder directly, so " + state.frames.length + " frame(s) were downloaded individually instead.");
    }
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
      else if (e.key === "m" || e.key === "M") toggleMirrorX();
      else if (e.key === "n" || e.key === "N") toggleMirrorY();
      else if (e.key === "[") rotateBy(-15);
      else if (e.key === "]") rotateBy(15);
    }
  }

  // ==================== TOOL SELECTION ====================
  function selectTool(tool) {
    if (tool !== "eyedropper") state.lastPaintTool = tool;
    state.tool = tool;
    btnPencil.classList.toggle("active", tool === "pencil");
    btnEraser.classList.toggle("active", tool === "eraser");
    btnEyedropper.classList.toggle("active", tool === "eyedropper");
    canvasWrapper.style.cursor =
      tool === "eraser" ? "cell" : tool === "eyedropper" ? "copy" : "crosshair";
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

  window.addEventListener("resize", function () {
    // Keep the canvas roughly centered as the workspace is resized,
    // e.g. rotating a phone or resizing the browser window.
    centerCanvas();
    applyTransform();
  });
})();
