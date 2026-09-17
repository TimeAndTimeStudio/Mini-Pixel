(function () {
  "use strict";

  // ==================== STATE ====================
  const state = {
    width: 64,
    height: 64,
    pixels: null,
    tool: "pencil",
    color: { r: 94, g: 234, b: 212, a: 255 },
    mirrorX: false,
    mirrorY: false,
    zoom: 4,
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
  const colorPicker = document.getElementById("color-picker");
  const btnPencil = document.getElementById("btn-pencil");
  const btnEraser = document.getElementById("btn-eraser");
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
  function setupCanvas() {
    const w = state.width;
    const h = state.height;
    state.pixels = createPixels(w, h);

    displayCanvas.width = w;
    displayCanvas.height = h;
    displayCanvas.style.width = w + "px";
    displayCanvas.style.height = h + "px";

    ctx.imageSmoothingEnabled = false;

    state.panX = 0;
    state.panY = 0;
    state.rotation = 0;

    state.undoStack = [];
    state.redoStack = [];
    saveState();

    statusSize.innerHTML = "Canvas: <b>" + w + " \u00d7 " + h + "</b>";
    render();
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

  function drawLine(x0, y0, x1, y1, r, g, b, a) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      drawPixel(x0, y0, r, g, b, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dx) { err -= dy; x0 += sx; }
      if (e2 < dy) { err += dx; y0 += sy; }
    }
  }

  function startDraw(x, y) {
    const c0 = getCanvasCoords(x, y);
    const px = c0.x, py = c0.y;
    if (px < 0 || px >= state.width || py < 0 || py >= state.height) return;

    state.isDrawing = true;
    state.lastPixel = { x: px, y: py };

    const c = currentRGBA();
    drawPixel(px, py, c.r, c.g, c.b, c.a);
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

    const c = currentRGBA();
    if (state.lastPixel) {
      drawLine(state.lastPixel.x, state.lastPixel.y, px, py, c.r, c.g, c.b, c.a);
    } else {
      drawPixel(px, py, c.r, c.g, c.b, c.a);
    }

    state.lastPixel = { x: px, y: py };
    render();
  }

  function endDraw() {
    if (!state.isDrawing) return;
    state.isDrawing = false;
    state.lastPixel = null;
    state.activePointerId = null;
    saveState();
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
  function onPointerDown(e) {
    if (e.button !== 0) return;
    // A second touch landing while one is already tracked means a
    // pinch/rotate/pan gesture is starting, not a new stroke.
    if (e.pointerType === "touch" && touchPoints.size >= 1) return;

    state.activePointerId = e.pointerId;
    try { displayCanvas.setPointerCapture(e.pointerId); } catch (err) {}
    startDraw(e.clientX, e.clientY);
  }

  function onPointerMove(e) {
    if (state.activePointerId !== null && e.pointerId !== state.activePointerId) return;
    moveDraw(e.clientX, e.clientY);
  }

  function onPointerUp(e) {
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

  // ==================== PAN (mouse, middle-drag) ====================
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panPointerId = null;

  canvasWrapper.addEventListener("pointerdown", function (e) {
    if (e.button === 1) {
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
    }
  });

  window.addEventListener("pointerup", function (e) {
    if (isPanning && e.pointerId === panPointerId) {
      isPanning = false;
      panPointerId = null;
      canvasWrapper.style.cursor = state.tool === "eraser" ? "cell" : "crosshair";
    }
  });

  // ==================== PAN / ZOOM / ROTATE (two-finger touch) ====================
  const touchPoints = new Map(); // pointerId -> {x, y}
  let gesture = null;

  function touchDist(p1, p2) { return Math.hypot(p2.x - p1.x, p2.y - p1.y); }
  function touchAngle(p1, p2) { return (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI; }
  function touchMid(p1, p2) { return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }; }

  window.addEventListener("pointerdown", function (e) {
    if (e.pointerType !== "touch") return;
    touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (touchPoints.size === 2) {
      cancelDraw();
      const pts = Array.from(touchPoints.values());
      const startMid = touchMid(pts[0], pts[1]);
      const anchor = toLocal(startMid.x, startMid.y, state.panX, state.panY, state.zoom, state.rotation);
      gesture = {
        startDist: touchDist(pts[0], pts[1]),
        startAngle: touchAngle(pts[0], pts[1]),
        startZoom: state.zoom,
        startRotation: state.rotation,
        anchorLx: anchor.lx,
        anchorLy: anchor.ly,
      };
    }
  });

  window.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "touch" || !touchPoints.has(e.pointerId)) return;
    touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (touchPoints.size === 2 && gesture) {
      const pts = Array.from(touchPoints.values());
      const dist = touchDist(pts[0], pts[1]);
      const angle = touchAngle(pts[0], pts[1]);
      const mid = touchMid(pts[0], pts[1]);

      let newZoom = gesture.startZoom * (dist / gesture.startDist);
      newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
      const newRotation = gesture.startRotation + (angle - gesture.startAngle);

      const offset = toScreenOffset(gesture.anchorLx, gesture.anchorLy, newZoom, newRotation);
      state.zoom = newZoom;
      state.rotation = newRotation;
      state.panX = mid.x - offset.x;
      state.panY = mid.y - offset.y;
      applyTransform();
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

  // ==================== COLOR ====================
  function hexToRGBA(hex) {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
      a: 255,
    };
  }

  function onColorChange(e) {
    state.color = hexToRGBA(e.target.value);
    if (state.tool === "eraser") selectTool("pencil");
  }

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

  function rotateBy(deltaDeg) {
    state.rotation += deltaDeg;
    applyTransform();
  }

  function resetView() {
    state.panX = 0;
    state.panY = 0;
    state.rotation = 0;
    state.zoom = parseInt(zoomSelect.value, 10) || 4;
    applyTransform();
  }

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

        displayCanvas.width = state.width;
        displayCanvas.height = state.height;
        displayCanvas.style.width = state.width + "px";
        displayCanvas.style.height = state.height + "px";

        state.panX = 0;
        state.panY = 0;
        state.rotation = 0;
        state.undoStack = [];
        state.redoStack = [];
        saveState();

        statusSize.innerHTML = "Canvas: <b>" + state.width + " \u00d7 " + state.height + "</b>";
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
      else if (e.key === "m" || e.key === "M") toggleMirrorX();
      else if (e.key === "n" || e.key === "N") toggleMirrorY();
      else if (e.key === "[") rotateBy(-15);
      else if (e.key === "]") rotateBy(15);
    }
  }

  // ==================== TOOL SELECTION ====================
  function selectTool(tool) {
    state.tool = tool;
    btnPencil.classList.toggle("active", tool === "pencil");
    btnEraser.classList.toggle("active", tool === "eraser");
    canvasWrapper.style.cursor = tool === "eraser" ? "cell" : "crosshair";
  }

  // ==================== EVENT BINDINGS ====================
  btnPencil.addEventListener("click", function () { selectTool("pencil"); });
  btnEraser.addEventListener("click", function () { selectTool("eraser"); });
  btnMirrorX.addEventListener("click", toggleMirrorX);
  btnMirrorY.addEventListener("click", toggleMirrorY);
  btnNew.addEventListener("click", createNewCanvas);
  zoomSelect.addEventListener("change", onZoomChange);
  btnRotateLeft.addEventListener("click", function () { rotateBy(-15); });
  btnRotateRight.addEventListener("click", function () { rotateBy(15); });
  btnResetView.addEventListener("click", resetView);
  btnUndo.addEventListener("click", undo);
  btnRedo.addEventListener("click", redo);
  btnImport.addEventListener("click", onImportClick);
  btnExport.addEventListener("click", exportPNG);
  fileInput.addEventListener("change", onFileChange);
  colorPicker.addEventListener("input", onColorChange);
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
  setupCanvas();
})();
