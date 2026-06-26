const primaryRemaining = document.querySelector("#primaryRemaining");
const secondaryRemaining = document.querySelector("#secondaryRemaining");
const primaryBar = document.querySelector("#primaryBar");
const secondaryBar = document.querySelector("#secondaryBar");
const todayTokens = document.querySelector("#todayTokens");
const todayInput = document.querySelector("#todayInput");
const todayOutput = document.querySelector("#todayOutput");
const screenSample = document.querySelector("#screenSample");
const screenCanvas = document.querySelector("#screenCanvas");
const screenContext = screenCanvas.getContext("2d", { alpha: false });
const screenVideo = document.querySelector("#screenVideo");
let dragging = false;
let activePointerId = null;
let captureStream = null;
let captureDisplayId = null;
let captureRestarting = false;
let captureGeometry = null;
let sampleFrameId = null;

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
  const scale = Math.max(
    1,
    Math.ceil(window.devicePixelRatio || captureGeometry?.scaleFactor || 1),
  );
  const width = Math.max(1, Math.round(sampleRect.width * scale));
  const height = Math.max(1, Math.round(sampleRect.height * scale));

  if (screenCanvas.width !== width || screenCanvas.height !== height) {
    screenCanvas.width = width;
    screenCanvas.height = height;
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

  const sampleRect = screenSample.getBoundingClientRect();
  const display = captureGeometry.display;
  const windowBounds = captureGeometry.window;

  if (!sampleRect.width || !sampleRect.height || !display.width || !display.height) {
    return;
  }

  resizeScreenCanvas();

  const sourceScaleX = screenVideo.videoWidth / display.width;
  const sourceScaleY = screenVideo.videoHeight / display.height;
  const sourceX =
    (windowBounds.x + sampleRect.left - display.x) * sourceScaleX;
  const sourceY =
    (windowBounds.y + sampleRect.top - display.y) * sourceScaleY;
  const sourceWidth = sampleRect.width * sourceScaleX;
  const sourceHeight = sampleRect.height * sourceScaleY;
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

  screenContext.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
  screenContext.drawImage(
    screenVideo,
    clampedX,
    clampedY,
    clampedWidth,
    clampedHeight,
    0,
    0,
    screenCanvas.width,
    screenCanvas.height,
  );
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
