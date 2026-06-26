const primaryRemaining = document.querySelector("#primaryRemaining");
const secondaryRemaining = document.querySelector("#secondaryRemaining");
const primaryBar = document.querySelector("#primaryBar");
const secondaryBar = document.querySelector("#secondaryBar");
const todayTokens = document.querySelector("#todayTokens");
const todayInput = document.querySelector("#todayInput");
const todayOutput = document.querySelector("#todayOutput");
const screenSample = document.querySelector("#screenSample");
const screenVideo = document.querySelector("#screenVideo");
let dragging = false;
let activePointerId = null;
let captureStream = null;
let captureDisplayId = null;
let captureRestarting = false;

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
}

function stopCaptureStream() {
  if (captureStream) {
    for (const track of captureStream.getTracks()) {
      track.stop();
    }
  }

  captureStream = null;
  captureDisplayId = null;
  screenVideo.srcObject = null;
}

function applyCaptureGeometry(geometry) {
  if (!geometry || !geometry.window || !geometry.display) {
    return null;
  }

  const sampleRect = screenSample.getBoundingClientRect();
  const offsetX = geometry.display.x - geometry.window.x - sampleRect.left;
  const offsetY = geometry.display.y - geometry.window.y - sampleRect.top;

  screenVideo.style.left = `${offsetX}px`;
  screenVideo.style.top = `${offsetY}px`;
  screenVideo.style.width = `${geometry.display.width}px`;
  screenVideo.style.height = `${geometry.display.height}px`;

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
