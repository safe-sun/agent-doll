const primaryRemaining = document.querySelector("#primaryRemaining");
const secondaryRemaining = document.querySelector("#secondaryRemaining");
const primaryBar = document.querySelector("#primaryBar");
const secondaryBar = document.querySelector("#secondaryBar");
const todayTokens = document.querySelector("#todayTokens");
const todayInput = document.querySelector("#todayInput");
const todayOutput = document.querySelector("#todayOutput");
const screenSample = document.querySelector("#screenSample");
const screenCanvas = document.querySelector("#screenCanvas");
const screenContext = screenCanvas.getContext("2d", {
  alpha: false,
  willReadFrequently: true,
});
const screenVideo = document.querySelector("#screenVideo");
const screenSourceCanvas = document.createElement("canvas");
const screenSourceContext = screenSourceCanvas.getContext("2d", {
  alpha: false,
});
const screenBlurCanvas = document.createElement("canvas");
const screenBlurContext = screenBlurCanvas.getContext("2d", {
  alpha: false,
  willReadFrequently: true,
});
const displacementMapCanvas = document.createElement("canvas");
const displacementMapContext = displacementMapCanvas.getContext("2d", {
  alpha: false,
  willReadFrequently: true,
});
const expandedDisplacementMap = createDisplacementMapImage("frosted");
const compactDisplacementMap = createDisplacementMapImage("frostedCompact");
const GLASS_RENDER = {
  expanded: {
    blurRadius: 13,
    displacement: 9,
    overscan: 34,
  },
  compact: {
    blurRadius: 9,
    displacement: 7,
    overscan: 24,
  },
};
let dragging = false;
let activePointerId = null;
let captureStream = null;
let captureDisplayId = null;
let captureRestarting = false;
let captureGeometry = null;
let sampleFrameId = null;
let displacementMapCacheKey = "";
let sampleReadbackFailed = false;

function percentText(value) {
  if (!Number.isFinite(value)) {
    return "--%";
  }

  return `${Math.round(value)}%`;
}

function compactNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "--";
  }

  if (number >= 100000000) {
    return `${(number / 100000000).toFixed(1)}亿`;
  }

  if (number >= 10000) {
    return `${(number / 10000).toFixed(1)}万`;
  }

  return new Intl.NumberFormat("zh-CN").format(number);
}

function updateQuota(window, remainingEl, barEl) {
  if (!window) {
    remainingEl.textContent = "--%";
    barEl.style.width = "0%";
    return;
  }

  const remaining = Number(window.remainingPercent);
  remainingEl.textContent = percentText(remaining);
  barEl.style.width = `${Math.max(0, Math.min(100, remaining || 0))}%`;
}

function updateTodayTokens(usage) {
  const today = usage.todayTokenUsage || {};
  todayTokens.textContent = compactNumber(today.total_tokens);
  todayInput.textContent = compactNumber(today.input_tokens);
  todayOutput.textContent = compactNumber(today.output_tokens);
}

function renderUsage(usage) {
  document.body.classList.toggle("error", !usage.found);

  if (!usage.found) {
    updateQuota(null, primaryRemaining, primaryBar);
    updateQuota(null, secondaryRemaining, secondaryBar);
    updateTodayTokens(usage);
    return;
  }

  updateQuota(usage.primary, primaryRemaining, primaryBar);
  updateQuota(usage.secondary, secondaryRemaining, secondaryBar);
  updateTodayTokens(usage);
}

function createDisplacementMapImage(filterId) {
  const image = new Image();
  const map = document.querySelector(`#${filterId} feImage`);
  image.src = map?.getAttribute("href") || "";
  return image;
}

function setCaptureReady(isReady) {
  document.body.classList.toggle("capture-ready", isReady);
  document.body.classList.toggle("capture-error", !isReady);

  if (isReady) {
    startScreenSampleRendering();
  } else {
    stopScreenSampleRendering();
  }
}

function stopCaptureStream() {
  if (captureStream) {
    for (const track of captureStream.getTracks()) {
      track.stop();
    }
  }

  captureStream = null;
  captureDisplayId = null;
  captureGeometry = null;
  screenVideo.srcObject = null;
  stopScreenSampleRendering();
}

function resizeScreenCanvas() {
  const sampleRect = screenSample.getBoundingClientRect();
  const settings = getGlassRenderSettings();
  const scale = Math.max(
    1,
    Math.min(
      2,
      Math.ceil(window.devicePixelRatio || captureGeometry?.scaleFactor || 1),
    ),
  );
  const width = Math.max(1, Math.round(sampleRect.width * scale));
  const height = Math.max(1, Math.round(sampleRect.height * scale));
  const overscanPixels = Math.max(1, Math.round(settings.overscan * scale));
  const bufferWidth = width + overscanPixels * 2;
  const bufferHeight = height + overscanPixels * 2;

  if (screenCanvas.width !== width || screenCanvas.height !== height) {
    screenCanvas.width = width;
    screenCanvas.height = height;
    displacementMapCacheKey = "";
  }

  if (
    screenSourceCanvas.width !== bufferWidth ||
    screenSourceCanvas.height !== bufferHeight
  ) {
    screenSourceCanvas.width = bufferWidth;
    screenSourceCanvas.height = bufferHeight;
  }

  if (
    screenBlurCanvas.width !== bufferWidth ||
    screenBlurCanvas.height !== bufferHeight
  ) {
    screenBlurCanvas.width = bufferWidth;
    screenBlurCanvas.height = bufferHeight;
  }

  return {
    bufferHeight,
    bufferWidth,
    height,
    overscanPixels,
    sampleRect,
    scale,
    settings,
    width,
  };
}

function getGlassRenderSettings() {
  return document.body.classList.contains("is-collapsed")
    ? GLASS_RENDER.compact
    : GLASS_RENDER.expanded;
}

function getActiveDisplacementMap() {
  return document.body.classList.contains("is-collapsed")
    ? compactDisplacementMap
    : expandedDisplacementMap;
}

function updateDisplacementMap(metrics) {
  const image = getActiveDisplacementMap();

  if (!image.complete || !image.naturalWidth) {
    return false;
  }

  const mode = document.body.classList.contains("is-collapsed")
    ? "compact"
    : "expanded";
  const cacheKey = `${mode}:${metrics.width}x${metrics.height}`;

  if (displacementMapCacheKey === cacheKey) {
    return true;
  }

  displacementMapCanvas.width = metrics.width;
  displacementMapCanvas.height = metrics.height;
  displacementMapContext.imageSmoothingEnabled = true;
  displacementMapContext.clearRect(0, 0, metrics.width, metrics.height);
  displacementMapContext.drawImage(
    image,
    0,
    0,
    metrics.width,
    metrics.height,
  );
  displacementMapCacheKey = cacheKey;
  return true;
}

function drawScreenVideoToSourceCanvas(metrics) {
  const display = captureGeometry.display;
  const windowBounds = captureGeometry.window;
  const sourceScaleX = screenVideo.videoWidth / display.width;
  const sourceScaleY = screenVideo.videoHeight / display.height;
  const cssSourceX =
    windowBounds.x +
    metrics.sampleRect.left -
    display.x -
    metrics.settings.overscan;
  const cssSourceY =
    windowBounds.y +
    metrics.sampleRect.top -
    display.y -
    metrics.settings.overscan;
  const sourceX = cssSourceX * sourceScaleX;
  const sourceY = cssSourceY * sourceScaleY;
  const sourceWidth =
    (metrics.sampleRect.width + metrics.settings.overscan * 2) *
    sourceScaleX;
  const sourceHeight =
    (metrics.sampleRect.height + metrics.settings.overscan * 2) *
    sourceScaleY;
  const clampedX = Math.max(0, Math.min(screenVideo.videoWidth - 1, sourceX));
  const clampedY = Math.max(0, Math.min(screenVideo.videoHeight - 1, sourceY));
  const clampedWidth = Math.max(
    1,
    Math.min(screenVideo.videoWidth - clampedX, sourceWidth),
  );
  const clampedHeight = Math.max(
    1,
    Math.min(screenVideo.videoHeight - clampedY, sourceHeight),
  );
  const destinationX = Math.max(
    0,
    Math.round(((clampedX - sourceX) / sourceScaleX) * metrics.scale),
  );
  const destinationY = Math.max(
    0,
    Math.round(((clampedY - sourceY) / sourceScaleY) * metrics.scale),
  );
  const destinationWidth = Math.max(
    1,
    Math.round((clampedWidth / sourceScaleX) * metrics.scale),
  );
  const destinationHeight = Math.max(
    1,
    Math.round((clampedHeight / sourceScaleY) * metrics.scale),
  );

  screenSourceContext.imageSmoothingEnabled = true;
  screenSourceContext.clearRect(
    0,
    0,
    metrics.bufferWidth,
    metrics.bufferHeight,
  );
  screenSourceContext.drawImage(
    screenVideo,
    clampedX,
    clampedY,
    clampedWidth,
    clampedHeight,
    destinationX,
    destinationY,
    destinationWidth,
    destinationHeight,
  );
}

function drawBlurredSample(metrics) {
  screenContext.drawImage(
    screenBlurCanvas,
    metrics.overscanPixels,
    metrics.overscanPixels,
    metrics.width,
    metrics.height,
    0,
    0,
    metrics.width,
    metrics.height,
  );
}

function drawDisplacedSample(metrics) {
  if (!updateDisplacementMap(metrics)) {
    drawBlurredSample(metrics);
    return;
  }

  try {
    const source = screenBlurContext.getImageData(
      0,
      0,
      metrics.bufferWidth,
      metrics.bufferHeight,
    );
    const map = displacementMapContext.getImageData(
      0,
      0,
      metrics.width,
      metrics.height,
    );
    const output = screenContext.createImageData(metrics.width, metrics.height);
    const displacement = metrics.settings.displacement * metrics.scale;

    for (let y = 0; y < metrics.height; y += 1) {
      for (let x = 0; x < metrics.width; x += 1) {
        const targetIndex = (y * metrics.width + x) * 4;
        const dx = ((map.data[targetIndex] - 128) / 127) * displacement;
        const dy = ((map.data[targetIndex + 1] - 128) / 127) * displacement;
        const sourceX = Math.max(
          0,
          Math.min(
            metrics.bufferWidth - 1,
            Math.round(x + metrics.overscanPixels + dx),
          ),
        );
        const sourceY = Math.max(
          0,
          Math.min(
            metrics.bufferHeight - 1,
            Math.round(y + metrics.overscanPixels + dy),
          ),
        );
        const sourceIndex = (sourceY * metrics.bufferWidth + sourceX) * 4;

        output.data[targetIndex] = source.data[sourceIndex];
        output.data[targetIndex + 1] = source.data[sourceIndex + 1];
        output.data[targetIndex + 2] = source.data[sourceIndex + 2];
        output.data[targetIndex + 3] = 255;
      }
    }

    screenContext.putImageData(output, 0, 0);
    sampleReadbackFailed = false;
  } catch (error) {
    if (!sampleReadbackFailed) {
      console.warn("Falling back to blur-only glass rendering.", error);
      sampleReadbackFailed = true;
    }

    drawBlurredSample(metrics);
  }
}

function drawScreenSample() {
  sampleFrameId = window.requestAnimationFrame(drawScreenSample);

  if (
    !captureStream ||
    !captureGeometry ||
    screenVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    !screenVideo.videoWidth ||
    !screenVideo.videoHeight
  ) {
    return;
  }

  const display = captureGeometry.display;
  const metrics = resizeScreenCanvas();

  if (
    !metrics.sampleRect.width ||
    !metrics.sampleRect.height ||
    !display.width ||
    !display.height
  ) {
    return;
  }

  drawScreenVideoToSourceCanvas(metrics);

  screenBlurContext.clearRect(
    0,
    0,
    metrics.bufferWidth,
    metrics.bufferHeight,
  );
  screenBlurContext.filter = `blur(${
    metrics.settings.blurRadius * metrics.scale
  }px)`;
  screenBlurContext.drawImage(screenSourceCanvas, 0, 0);
  screenBlurContext.filter = "none";
  drawDisplacedSample(metrics);
}

function startScreenSampleRendering() {
  if (sampleFrameId !== null) {
    return;
  }

  resizeScreenCanvas();
  sampleFrameId = window.requestAnimationFrame(drawScreenSample);
}

function stopScreenSampleRendering() {
  if (sampleFrameId !== null) {
    window.cancelAnimationFrame(sampleFrameId);
    sampleFrameId = null;
  }

  screenContext.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
  screenSourceContext.clearRect(
    0,
    0,
    screenSourceCanvas.width,
    screenSourceCanvas.height,
  );
  screenBlurContext.clearRect(
    0,
    0,
    screenBlurCanvas.width,
    screenBlurCanvas.height,
  );
}

function applyCaptureGeometry(geometry) {
  if (!geometry || !geometry.window || !geometry.display) {
    captureGeometry = null;
    return null;
  }

  captureGeometry = geometry;
  resizeScreenCanvas();

  return geometry.displayId;
}

async function syncCaptureGeometry() {
  try {
    const geometry = await window.codexPet.getGlassCaptureGeometry();
    return applyCaptureGeometry(geometry) ? geometry : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function requestScreenStream() {
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: {
        frameRate: { ideal: 30, max: 30 },
      },
    });
  } catch (displayMediaError) {
    const source = await window.codexPet.getGlassCaptureSource();

    if (!source?.id) {
      throw displayMediaError;
    }

    applyCaptureGeometry(source.geometry);
    if (!navigator.mediaDevices.getUserMedia) {
      throw displayMediaError;
    }

    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: source.id,
          minFrameRate: 15,
          maxFrameRate: 30,
        },
      },
    });
  }
}

async function startGlassCapture(force = false) {
  if (captureRestarting) {
    return;
  }

  captureRestarting = true;

  try {
    const geometry = await syncCaptureGeometry();

    if (!navigator.mediaDevices) {
      throw new Error("Screen capture is not available in this Electron runtime.");
    }

    if (force) {
      stopCaptureStream();
    }

    const stream = await requestScreenStream();

    stopCaptureStream();
    captureStream = stream;
    screenVideo.srcObject = stream;

    const [track] = stream.getVideoTracks();
    track?.addEventListener(
      "ended",
      () => {
        setCaptureReady(false);
        captureDisplayId = null;
        window.setTimeout(() => startGlassCapture(true), 1200);
      },
      { once: true },
    );

    await screenVideo.play();
    const latestGeometry = (await syncCaptureGeometry()) || geometry;
    captureDisplayId = latestGeometry?.displayId || null;
    setCaptureReady(true);
  } catch (error) {
    setCaptureReady(false);
    console.error(error);
  } finally {
    captureRestarting = false;
  }
}

async function refreshUsage() {
  try {
    const usage = await window.codexPet.readUsage();
    renderUsage(usage);
  } catch (error) {
    renderUsage({
      found: false,
      todayTokenUsage: {},
    });
    console.error(error);
  }
}

window.codexPet.onRefreshRequest(refreshUsage);
window.codexPet.onCollapsedChange((value) => {
  document.body.classList.toggle("is-collapsed", Boolean(value));
  syncCaptureGeometry();
});
window.codexPet.onGlassCaptureGeometry((geometry) => {
  const nextDisplayId = applyCaptureGeometry(geometry);
  if (
    captureDisplayId &&
    nextDisplayId &&
    nextDisplayId !== captureDisplayId
  ) {
    startGlassCapture(true);
  }
});
window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  window.codexPet.showContextMenu();
});
function finishDrag(event) {
  if (!dragging) {
    return;
  }

  dragging = false;
  if (
    event &&
    activePointerId !== null &&
    document.body.releasePointerCapture
  ) {
    try {
      document.body.releasePointerCapture(activePointerId);
    } catch {
      // 窗口失焦时 capture 可能已经被系统释放。
    }
  }
  activePointerId = null;
  window.codexPet.dragEnd();
}

window.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }

  dragging = true;
  activePointerId = event.pointerId;
  if (document.body.setPointerCapture) {
    document.body.setPointerCapture(event.pointerId);
  }
  window.codexPet.dragStart();
});
window.addEventListener("pointerup", finishDrag);
window.addEventListener("pointercancel", finishDrag);
window.addEventListener("mouseup", finishDrag);
window.addEventListener("blur", () => {
  finishDrag();
});
window.addEventListener("beforeunload", () => {
  stopCaptureStream();
});

async function syncWindowState() {
  const collapsed = await window.codexPet.isCollapsed();
  document.body.classList.toggle("is-collapsed", Boolean(collapsed));
}

syncWindowState();
startGlassCapture();
setInterval(syncCaptureGeometry, 250);
refreshUsage();
setInterval(refreshUsage, 60_000);
