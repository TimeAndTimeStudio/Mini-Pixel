(function () {
  "use strict";

  // ==================== STATE ====================
  const state = {
    width: 64,
    height: 64,
    pixels: null,
    tool: "pencil",
    color: { r: 0, g: 0, b: 0, a: 255 },
    mirrorX: false,
    mirrorY: false,
    zoom: 4,
    panX: 0,
    panY: 0,
    undoStack: [],
    redoStack: [],
    isDrawing: false,
    lastPixel: null,
  };

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
  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");
  const btnImport = document.getElementById("btn-import");
  const btnExport = document.getElementById("btn-export");
  const fileInput = document.getElementById("file-input");
  const canvasWrapper = document.getElementById("canvas-wrapper");

  // ==================== PIXEL BUFFER ====================
  function createPixels(w, h) {
    const data = new Uint8Array(w * h * 4);
    return data;
  }

  function clearPixels(data, w, h) {
    data.fill(0);
  }

  function getPixel(data, w, x, y) {
    const i = (y * w + x) * 4;
    return {
      r: data[i],
      g: data[i + 1],
      b: data[i + 2],
      a: data[i + 3],
    };
  }

  function setPixel(data, w, x, y, r, g, b, a) {
    const i = (y * w + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }

  function copyPixels(src, dst) {
    dst.set(src);
  }

  // ==================== CANVAS SETUP ====================
  function setupCanvas() {
    const w = state.width;
    const h = state.height;
    state.pixels = createPixels(w, h);
    clearPixels(state.pixels, w, h);

    displayCanvas.width = w;
    displayCanvas.height = h;
    displayCanvas.style.width = w * state.zoom + "px";
    displayCanvas.style.height = h * state.zoom + "px";

    ctx.imageSmoothingEnabled = false;

    state.panX = 0;
    state.panY = 0;
    zoomDisplay();

    state.undoStack = [];
    state.redoStack = [];
    saveState();
  }

  // ==================== RENDER ====================
  function render() {
    const w = state.width;
    const h = state.height;

    const imgData = ctx.createImageData(w, h);
    imgData.data.set(state.pixels);
    ctx.putImageData(imgData, 0, 0);

    displayCanvas.style.transform =
      "translate(" + state.panX + "px," + state.panY + "px) scale(" + state.zoom + ")";
    displayCanvas.style.transformOrigin = "0 0";
  }

  function zoomDisplay() {
    displayCanvas.style.width = state.width * state.zoom + "px";
    displayCanvas.style.height = state.height * state.zoom + "px";
    render();
  }

  // ==================== COORDINATE CONVERSION ====================
  function getCanvasCoords(clientX, clientY) {
    const rect = canvasWrapper.getBoundingClientRect();
    const x = (clientX - rect.left - state.panX) / state.zoom;
    const y = (clientY - rect.top - state.panY) / state.zoom;
    return {
      x: Math.floor(x),
      y: Math.floor(y),
    };
  }

  // ==================== DRAWING ====================
  function drawPixel(x, y, r, g, b, a) {
    if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;

    if (state.tool === "eraser") {
      setPixel(state.pixels, state.width, x, y, 0, 0, 0, 0);
    } else {
      setPixel(state.pixels, state.width, x, y, r, g, b, a);
    }

    if (state.mirrorX) {
      const mx = state.width - 1 - x;
      if (mx !== x) {
        if (state.tool === "eraser") {
          setPixel(state.pixels, state.width, mx, y, 0, 0, 0, 0);
        } else {
          setPixel(state.pixels, state.width, mx, y, r, g, b, a);
        }
      }
    }

    if (state.mirrorY) {
      const my = state.height - 1 - y;
      if (my !== y) {
        if (state.tool === "eraser") {
          setPixel(state.pixels, state.width, x, my, 0, 0, 0, 0);
        } else {
          setPixel(state.pixels, state.width, x, my, r, g, b, a);
        }
      }

      if (state.mirrorX) {
        const mx = state.width - 1 - x;
        if (mx !== x && my !== y) {
          if (state.tool === "eraser") {
            setPixel(state.pixels, state.width, mx, my, 0, 0, 0, 0);
          } else {
            setPixel(state.pixels, state.width, mx, my, r, g, b, a);
          }
        }
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
      drawPixel(x0, y0, r, g, b, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dx) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dy) {
        err += dx;
        y0 += sy;
      }
    }
  }

  function startDraw(x, y) {
    const coords = getCanvasCoords(x, y);
    const px = coords.x;
    const py = coords.y;

    if (px < 0 || px >= state.width || py < 0 || py >= state.height) return;

    state.isDrawing = true;
    state.lastPixel = { x: px, y: py };

    if (state.tool === "eraser") {
      drawPixel(px, py, 0, 0, 0, 0);
    } else {
      drawPixel(px, py, state.color.r, state.color.g, state.color.b, state.color.a);
    }
    render();
  }

  function moveDraw(x, y) {
    if (!state.isDrawing) return;
    const coords = getCanvasCoords(x, y);
    const px = coords.x;
    const py = coords.y;

    if (px < 0 || px >= state.width || py < 0 || py >= state.height) return;

    if (state.lastPixel) {
      if (state.tool === "eraser") {
        drawLine(state.lastPixel.x, state.lastPixel.y, px, py, 0, 0, 0, 0);
      } else {
        drawLine(state.lastPixel.x, state.lastPixel.y, px, py, state.color.r, state.color.g, state.color.b, state.color.a);
      }
    } else {
      if (state.tool === "eraser") {
        drawPixel(px, py, 0, 0, 0, 0);
      } else {
        drawPixel(px, py, state.color.r, state.color.g, state.color.b, state.color.a);
      }
    }

    state.lastPixel = { x: px, y: py };
    render();
  }

  function endDraw() {
    if (!state.isDrawing) return;
    state.isDrawing = false;
    state.lastPixel = null;
    saveState();
  }

  // ==================== POINTER EVENTS ====================
  function onPointerDown(e) {
    if (e.button === 0) {
      startDraw(e.clientX, e.clientY);
    }
  }

  function onPointerMove(e) {
    moveDraw(e.clientX, e.clientY);
  }

  function onPointerUp(e) {
    endDraw();
  }

  displayCanvas.addEventListener("pointerdown", onPointerDown);
  displayCanvas.addEventListener("pointermove", onPointerMove);
  displayCanvas.addEventListener("pointerup", onPointerUp);
  displayCanvas.addEventListener("pointercancel", onPointerUp);

  // ==================== PAN ====================
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;

  canvasWrapper.addEventListener("pointerdown", function (e) {
    if (e.button === 1) {
      isPanning = true;
      panStartX = e.clientX - state.panX;
      panStartY = e.clientY - state.panY;
      canvasWrapper.style.cursor = "grabbing";
      e.preventDefault();
    }
  });

  window.addEventListener("pointermove", function (e) {
    if (isPanning) {
      state.panX = e.clientX - panStartX;
      state.panY = e.clientY - panStartY;
      render();
    }
  });

  window.addEventListener("pointerup", function () {
    if (isPanning) {
      isPanning = false;
      canvasWrapper.style.cursor = "crosshair";
    }
  });

  // ==================== UNDO / REDO ====================
  function saveState() {
    const snapshot = new Uint8Array(state.pixels);
    state.undoStack.push(snapshot);
    if (state.undoStack.length > 100) {
      state.undoStack.shift();
    }
    state.redoStack = [];
  }

  function undo() {
    if (state.undoStack.length <= 1) return;
    const current = state.undoStack.pop();
    state.redoStack.push(current);
    const prev = state.undoStack[state.undoStack.length - 1];
    const prevCopy = new Uint8Array(prev);
    copyPixels(prevCopy, state.pixels);
    render();
  }

  function redo() {
    if (state.redoStack.length === 0) return;
    const next = state.redoStack.pop();
    state.undoStack.push(next);
    const copy = new Uint8Array(next);
    copyPixels(copy, state.pixels);
    render();
  }

  // ==================== NEW CANVAS ====================
  function createNewCanvas() {
    const w = parseInt(inputWidth.value, 10);
    const h = parseInt(inputHeight.value, 10);

    if (isNaN(w) || isNaN(h)) {
      alert("Please enter valid numbers for width and height.");
      return;
    }
    if (w < 1 || h < 1) {
      alert("Width and height must be positive.");
      return;
    }
    if (w > 2048 || h > 2048) {
      alert("Maximum size is 2048x2048.");
      return;
    }

    state.width = w;
    state.height = h;

    setupCanvas();
    render();
  }

  // ==================== COLOR ====================
  function hexToRGBA(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r: r, g: g, b: b, a: 255 };
  }

  function onColorChange(e) {
    state.color = hexToRGBA(e.target.value);
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

  // ==================== ZOOM ====================
  function onZoomChange(e) {
    state.zoom = parseInt(e.target.value, 10);
    zoomDisplay();
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
        displayCanvas.style.width = state.width * state.zoom + "px";
        displayCanvas.style.height = state.height * state.zoom + "px";

        state.panX = 0;
        state.panY = 0;

        state.undoStack = [];
        state.redoStack = [];
        saveState();

        render();
      };
      img.src = evt.target.result;
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

    if (e.ctrlKey && e.key === "z") {
      e.preventDefault();
      undo();
    } else if (e.ctrlKey && e.key === "y") {
      e.preventDefault();
      redo();
    } else if (e.key === "p" || e.key === "P") {
      selectTool("pencil");
    } else if (e.key === "e" || e.key === "E") {
      selectTool("eraser");
    } else if (e.key === "m" || e.key === "M") {
      toggleMirrorX();
    } else if (e.key === "n" || e.key === "N") {
      toggleMirrorY();
    }
  }

  // ==================== TOOL SELECTION ====================
  function selectTool(tool) {
    state.tool = tool;
    btnPencil.classList.toggle("active", tool === "pencil");
    btnEraser.classList.toggle("active", tool === "eraser");
  }

  // ==================== EVENT BINDINGS ====================
  btnPencil.addEventListener("click", function () { selectTool("pencil"); });
  btnEraser.addEventListener("click", function () { selectTool("eraser"); });
  btnMirrorX.addEventListener("click", toggleMirrorX);
  btnMirrorY.addEventListener("click", toggleMirrorY);
  btnNew.addEventListener("click", createNewCanvas);
  zoomSelect.addEventListener("change", onZoomChange);
  btnUndo.addEventListener("click", undo);
  btnRedo.addEventListener("click", redo);
  btnImport.addEventListener("click", onImportClick);
  btnExport.addEventListener("click", exportPNG);
  fileInput.addEventListener("change", onFileChange);
  colorPicker.addEventListener("input", onColorChange);
  window.addEventListener("keydown", onKeyDown);

  // Prevent context menu on canvas
  displayCanvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  // Prevent scrolling on touch
  canvasWrapper.addEventListener("touchstart", function (e) {
    if (e.touches.length === 1) {
      e.preventDefault();
    }
  }, { passive: false });

  canvasWrapper.addEventListener("touchmove", function (e) {
    if (e.touches.length === 1) {
      e.preventDefault();
    }
  }, { passive: false });

  // ==================== INIT ====================
  setupCanvas();
  render();
})();
