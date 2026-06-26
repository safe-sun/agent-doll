const primaryRemaining = document.querySelector("#primaryRemaining");
const secondaryRemaining = document.querySelector("#secondaryRemaining");
const primaryBar = document.querySelector("#primaryBar");
const secondaryBar = document.querySelector("#secondaryBar");
const todayTokens = document.querySelector("#todayTokens");
const todayInput = document.querySelector("#todayInput");
const todayOutput = document.querySelector("#todayOutput");
const screenSample = document.querySelector("#screenSample");
const screenCanvas = document.querySelector("#screenCanvas");
const screenVideo = document.querySelector("#screenVideo");
const expandedDisplacementMap = createDisplacementMapImage("frosted");
const compactDisplacementMap = createDisplacementMapImage("frostedCompact");
const CAPTURE_FRAME_RATE = 60;
const CAPTURE_CURSOR_MODE = "never";
const GLASS_RENDER_FPS = 60;
const GLASS_RENDER_INTERVAL_MS = 1000 / GLASS_RENDER_FPS;
const MAX_RENDER_SCALE = 1;
const GLASS_RENDER = {
  expanded: {
    blurRadius: 18,
    displacement: 6,
  },
  compact: {
    blurRadius: 12,
    displacement: 4.5,
  },
};
const GLASS_VERTEX_SHADER = `
  attribute vec2 aPosition;
  attribute vec2 aUv;
  varying vec2 vUv;

  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
    vUv = aUv;
  }
`;
const GLASS_FRAGMENT_SHADER = `
  precision mediump float;

  uniform sampler2D uVideo;
  uniform sampler2D uMap;
  uniform vec4 uSourceRect;
  uniform vec2 uDisplaySize;
  uniform float uBlurRadius;
  uniform float uDisplacement;
  varying vec2 vUv;

  vec2 clampUv(vec2 uv) {
    return clamp(uv, vec2(0.001), vec2(0.999));
  }

  vec4 sampleBlur(vec2 uv) {
    vec2 radius = vec2(uBlurRadius) / uDisplaySize;
    vec2 ringA = radius * 0.28;
    vec2 ringB = radius * 0.55;
    vec2 ringC = radius * 0.82;
    vec4 color = texture2D(uVideo, clampUv(uv)) * 0.14;

    color += texture2D(uVideo, clampUv(uv + vec2(ringA.x, 0.0))) * 0.04;
    color += texture2D(uVideo, clampUv(uv - vec2(ringA.x, 0.0))) * 0.04;
    color += texture2D(uVideo, clampUv(uv + vec2(0.0, ringA.y))) * 0.04;
    color += texture2D(uVideo, clampUv(uv - vec2(0.0, ringA.y))) * 0.04;
    color += texture2D(uVideo, clampUv(uv + ringA * vec2(0.7071, 0.7071))) * 0.04;
    color += texture2D(uVideo, clampUv(uv - ringA * vec2(0.7071, 0.7071))) * 0.04;
    color += texture2D(uVideo, clampUv(uv + ringA * vec2(0.7071, -0.7071))) * 0.04;
    color += texture2D(uVideo, clampUv(uv + ringA * vec2(-0.7071, 0.7071))) * 0.04;

    color += texture2D(uVideo, clampUv(uv + vec2(ringB.x, 0.0))) * 0.026;
    color += texture2D(uVideo, clampUv(uv - vec2(ringB.x, 0.0))) * 0.026;
    color += texture2D(uVideo, clampUv(uv + vec2(0.0, ringB.y))) * 0.026;
    color += texture2D(uVideo, clampUv(uv - vec2(0.0, ringB.y))) * 0.026;
    color += texture2D(uVideo, clampUv(uv + ringB * vec2(0.8660, 0.5))) * 0.026;
    color += texture2D(uVideo, clampUv(uv - ringB * vec2(0.8660, 0.5))) * 0.026;
    color += texture2D(uVideo, clampUv(uv + ringB * vec2(0.8660, -0.5))) * 0.026;
    color += texture2D(uVideo, clampUv(uv + ringB * vec2(-0.8660, 0.5))) * 0.026;
    color += texture2D(uVideo, clampUv(uv + ringB * vec2(0.5, 0.8660))) * 0.026;
    color += texture2D(uVideo, clampUv(uv - ringB * vec2(0.5, 0.8660))) * 0.026;
    color += texture2D(uVideo, clampUv(uv + ringB * vec2(0.5, -0.8660))) * 0.026;
    color += texture2D(uVideo, clampUv(uv + ringB * vec2(-0.5, 0.8660))) * 0.026;

    color += texture2D(uVideo, clampUv(uv + vec2(ringC.x, 0.0))) * 0.01425;
    color += texture2D(uVideo, clampUv(uv - vec2(ringC.x, 0.0))) * 0.01425;
    color += texture2D(uVideo, clampUv(uv + vec2(0.0, ringC.y))) * 0.01425;
    color += texture2D(uVideo, clampUv(uv - vec2(0.0, ringC.y))) * 0.01425;
    color += texture2D(uVideo, clampUv(uv + ringC * vec2(0.9239, 0.3827))) * 0.01425;
    color += texture2D(uVideo, clampUv(uv - ringC * vec2(0.9239, 0.3827))) * 0.01425;
    color += texture2D(uVideo, clampUv(uv + ringC * vec2(0.9239, -0.3827))) * 0.01425;
    color += texture2D(uVideo, clampUv(uv + ringC * vec2(-0.9239, 0.3827))) * 0.01425;
    color += texture2D(uVideo, clampUv(uv + ringC * vec2(0.7071, 0.7071))) * 0.01425;
    color += texture2D(uVideo, clampUv(uv - ringC * vec2(0.7071, 0.7071))) * 0.01425;
    color += texture2D(uVideo, clampUv(uv + ringC * vec2(0.7071, -0.7071))) * 0.01425;
    color += texture2D(uVideo, clampUv(uv + ringC * vec2(-0.7071, 0.7071))) * 0.01425;
    color += texture2D(uVideo, clampUv(uv + ringC * vec2(0.3827, 0.9239))) * 0.01425;
    color += texture2D(uVideo, clampUv(uv - ringC * vec2(0.3827, 0.9239))) * 0.01425;
    color += texture2D(uVideo, clampUv(uv + ringC * vec2(0.3827, -0.9239))) * 0.01425;
    color += texture2D(uVideo, clampUv(uv + ringC * vec2(-0.3827, 0.9239))) * 0.01425;

    return color;
  }

  void main() {
    vec2 mapValue = texture2D(uMap, vUv).rg;
    vec2 displacement =
      ((mapValue - vec2(0.5)) * 2.0 * uDisplacement) / uDisplaySize;
    vec2 videoUv = uSourceRect.xy + vUv * uSourceRect.zw + displacement;
    vec4 color = sampleBlur(videoUv);

    gl_FragColor = vec4(color.rgb, 1.0);
  }
`;
const glassRenderer = createGlassRenderer();
const fallbackScreenContext = glassRenderer
  ? null
  : screenCanvas.getContext("2d", { alpha: false });
let dragging = false;
let activePointerId = null;
let captureStream = null;
let captureDisplayId = null;
let captureRestarting = false;
let captureGeometry = null;
let sampleFrameCallbackId = null;
let sampleFrameCallbackType = null;
let lastSampleRenderAt = 0;

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
  image.addEventListener("load", () => {
    glassRenderer?.invalidateMap();
  });
  return image;
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(error || "Failed to compile WebGL shader.");
  }

  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(error || "Failed to link WebGL program.");
  }

  return program;
}

function createTexture(gl) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

function createGlassRenderer() {
  const gl = screenCanvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    preserveDrawingBuffer: false,
    premultipliedAlpha: false,
    stencil: false,
  });

  if (!gl) {
    console.warn("WebGL is unavailable; falling back to canvas blur.");
    return null;
  }

  try {
    const program = createProgram(
      gl,
      GLASS_VERTEX_SHADER,
      GLASS_FRAGMENT_SHADER,
    );
    const vertices = new Float32Array([
      -1, -1, 0, 1,
      1, -1, 1, 1,
      -1, 1, 0, 0,
      1, 1, 1, 0,
    ]);
    const buffer = gl.createBuffer();
    const positionLocation = gl.getAttribLocation(program, "aPosition");
    const uvLocation = gl.getAttribLocation(program, "aUv");
    const uniforms = {
      blurRadius: gl.getUniformLocation(program, "uBlurRadius"),
      displacement: gl.getUniformLocation(program, "uDisplacement"),
      displaySize: gl.getUniformLocation(program, "uDisplaySize"),
      map: gl.getUniformLocation(program, "uMap"),
      sourceRect: gl.getUniformLocation(program, "uSourceRect"),
      video: gl.getUniformLocation(program, "uVideo"),
    };
    const videoTexture = createTexture(gl);
    const mapTexture = createTexture(gl);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.useProgram(program);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uvLocation);
    gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 16, 8);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mapTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([128, 128, 128, 255]),
    );
    gl.uniform1i(uniforms.video, 0);
    gl.uniform1i(uniforms.map, 1);

    return {
      gl,
      invalidateMap() {
        this.mapKey = "";
      },
      mapKey: "",
      mapTexture,
      program,
      uniforms,
      videoTexture,
    };
  } catch (error) {
    console.error(error);
    return null;
  }
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

function resizeScreenCanvas() {
  const sampleRect = screenSample.getBoundingClientRect();
  const scale = Math.max(
    1,
    Math.min(
      MAX_RENDER_SCALE,
      Math.ceil(window.devicePixelRatio || captureGeometry?.scaleFactor || 1),
    ),
  );
  const width = Math.max(1, Math.round(sampleRect.width * scale));
  const height = Math.max(1, Math.round(sampleRect.height * scale));

  if (screenCanvas.width !== width || screenCanvas.height !== height) {
    screenCanvas.width = width;
    screenCanvas.height = height;
  }

  return {
    height,
    sampleRect,
    scale,
    settings: getGlassRenderSettings(),
    width,
  };
}

function getVideoSource(metrics) {
  const display = captureGeometry.display;
  const windowBounds = captureGeometry.window;
  const sourceScaleX = screenVideo.videoWidth / display.width;
  const sourceScaleY = screenVideo.videoHeight / display.height;
  const sourceX =
    (windowBounds.x + metrics.sampleRect.left - display.x) * sourceScaleX;
  const sourceY =
    (windowBounds.y + metrics.sampleRect.top - display.y) * sourceScaleY;
  const sourceWidth = metrics.sampleRect.width * sourceScaleX;
  const sourceHeight = metrics.sampleRect.height * sourceScaleY;

  return {
    height: Math.max(1, sourceHeight),
    normalized: [
      sourceX / screenVideo.videoWidth,
      sourceY / screenVideo.videoHeight,
      sourceWidth / screenVideo.videoWidth,
      sourceHeight / screenVideo.videoHeight,
    ],
    width: Math.max(1, sourceWidth),
    x: Math.max(0, Math.min(screenVideo.videoWidth - 1, sourceX)),
    y: Math.max(0, Math.min(screenVideo.videoHeight - 1, sourceY)),
  };
}

function updateMapTexture(renderer) {
  const image = getActiveDisplacementMap();
  const mode = document.body.classList.contains("is-collapsed")
    ? "compact"
    : "expanded";

  if (renderer.mapKey === mode || !image.complete || !image.naturalWidth) {
    return;
  }

  const gl = renderer.gl;
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, renderer.mapTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    image,
  );
  renderer.mapKey = mode;
}

function renderGlassWithWebGL(metrics) {
  const renderer = glassRenderer;

  if (!renderer) {
    return false;
  }

  const gl = renderer.gl;
  const source = getVideoSource(metrics);

  try {
    gl.viewport(0, 0, metrics.width, metrics.height);
    gl.useProgram(renderer.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, renderer.videoTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      screenVideo,
    );
    updateMapTexture(renderer);
    gl.uniform4fv(renderer.uniforms.sourceRect, source.normalized);
    gl.uniform2f(
      renderer.uniforms.displaySize,
      captureGeometry.display.width,
      captureGeometry.display.height,
    );
    gl.uniform1f(
      renderer.uniforms.blurRadius,
      metrics.settings.blurRadius * metrics.scale,
    );
    gl.uniform1f(
      renderer.uniforms.displacement,
      metrics.settings.displacement * metrics.scale,
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  } catch (error) {
    console.warn("Falling back to canvas blur.", error);
    return false;
  }
}

function renderGlassWithCanvas(metrics) {
  if (!fallbackScreenContext) {
    return;
  }

  const source = getVideoSource(metrics);
  fallbackScreenContext.clearRect(0, 0, metrics.width, metrics.height);
  fallbackScreenContext.filter = `blur(${
    metrics.settings.blurRadius * metrics.scale
  }px)`;
  fallbackScreenContext.drawImage(
    screenVideo,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    metrics.width,
    metrics.height,
  );
  fallbackScreenContext.filter = "none";
}

function drawScreenSampleFrame() {
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

  if (!renderGlassWithWebGL(metrics)) {
    renderGlassWithCanvas(metrics);
  }
}

function scheduleScreenSampleFrame() {
  if (sampleFrameCallbackId !== null) {
    return;
  }

  if (screenVideo.requestVideoFrameCallback) {
    sampleFrameCallbackType = "video";
    sampleFrameCallbackId = screenVideo.requestVideoFrameCallback(
      handleScreenVideoFrame,
    );
    return;
  }

  sampleFrameCallbackType = "timer";
  sampleFrameCallbackId = window.setTimeout(
    handleTimedScreenFrame,
    GLASS_RENDER_INTERVAL_MS,
  );
}

function handleScreenVideoFrame(now) {
  sampleFrameCallbackId = null;
  sampleFrameCallbackType = null;

  if (now - lastSampleRenderAt >= GLASS_RENDER_INTERVAL_MS) {
    lastSampleRenderAt = now;
    drawScreenSampleFrame();
  }

  if (captureStream) {
    scheduleScreenSampleFrame();
  }
}

function handleTimedScreenFrame() {
  sampleFrameCallbackId = null;
  sampleFrameCallbackType = null;
  lastSampleRenderAt = performance.now();
  drawScreenSampleFrame();

  if (captureStream) {
    scheduleScreenSampleFrame();
  }
}

function startScreenSampleRendering() {
  if (sampleFrameCallbackId !== null) {
    return;
  }

  resizeScreenCanvas();
  lastSampleRenderAt = 0;
  scheduleScreenSampleFrame();
}

function stopScreenSampleRendering() {
  if (sampleFrameCallbackId !== null) {
    if (
      sampleFrameCallbackType === "video" &&
      screenVideo.cancelVideoFrameCallback
    ) {
      screenVideo.cancelVideoFrameCallback(sampleFrameCallbackId);
    } else {
      window.clearTimeout(sampleFrameCallbackId);
    }

    sampleFrameCallbackId = null;
    sampleFrameCallbackType = null;
  }

  if (glassRenderer) {
    const gl = glassRenderer.gl;
    gl.viewport(0, 0, screenCanvas.width, screenCanvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  } else {
    fallbackScreenContext?.clearRect(
      0,
      0,
      screenCanvas.width,
      screenCanvas.height,
    );
  }
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
  let stream = null;

  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: {
        cursor: CAPTURE_CURSOR_MODE,
        frameRate: { ideal: CAPTURE_FRAME_RATE, max: CAPTURE_FRAME_RATE },
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

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        cursor: CAPTURE_CURSOR_MODE,
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: source.id,
          minFrameRate: 30,
          maxFrameRate: CAPTURE_FRAME_RATE,
        },
      },
    });
  }

  await applyCaptureCursorMode(stream);
  return stream;
}

async function applyCaptureCursorMode(stream) {
  const [track] = stream.getVideoTracks();

  if (!track?.applyConstraints) {
    return;
  }

  try {
    const capabilities = track.getCapabilities?.();

    if (
      Array.isArray(capabilities?.cursor) &&
      !capabilities.cursor.includes(CAPTURE_CURSOR_MODE)
    ) {
      return;
    }

    await track.applyConstraints({ cursor: CAPTURE_CURSOR_MODE });
  } catch (error) {
    console.warn("Screen capture cursor exclusion is unavailable.", error);
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
  glassRenderer?.invalidateMap();
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
  glassRenderer?.invalidateMap();
}

syncWindowState();
startGlassCapture();
setInterval(syncCaptureGeometry, 250);
refreshUsage();
setInterval(refreshUsage, 60_000);
