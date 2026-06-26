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
const PROGRESS_ARC_DEGREES = 360;
const CONTRAST_SAMPLE_SIZE = 10;
const CONTRAST_UPDATE_INTERVAL_MS = 240;
const GLASS_RENDER = {
  expanded: {
    blurStdDeviation: 0.02,
    displacement: 1,
  },
  compact: {
    blurStdDeviation: 0.02,
    displacement: 1,
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
const GLASS_BLUR_FRAGMENT_SHADER = `
  precision mediump float;

  uniform sampler2D uTexture;
  uniform vec4 uSourceRect;
  uniform vec2 uBlurStep;
  varying vec2 vUv;

  vec2 clampUv(vec2 uv) {
    return clamp(uv, vec2(0.001), vec2(0.999));
  }

  vec4 sampleGaussian(vec2 uv) {
    vec4 color = texture2D(uTexture, clampUv(uv)) * 0.199676;

    color += texture2D(uTexture, clampUv(uv + uBlurStep * 1.0)) * 0.176213;
    color += texture2D(uTexture, clampUv(uv - uBlurStep * 1.0)) * 0.176213;
    color += texture2D(uTexture, clampUv(uv + uBlurStep * 2.0)) * 0.121109;
    color += texture2D(uTexture, clampUv(uv - uBlurStep * 2.0)) * 0.121109;
    color += texture2D(uTexture, clampUv(uv + uBlurStep * 3.0)) * 0.064826;
    color += texture2D(uTexture, clampUv(uv - uBlurStep * 3.0)) * 0.064826;
    color += texture2D(uTexture, clampUv(uv + uBlurStep * 4.0)) * 0.027023;
    color += texture2D(uTexture, clampUv(uv - uBlurStep * 4.0)) * 0.027023;
    color += texture2D(uTexture, clampUv(uv + uBlurStep * 5.0)) * 0.008773;
    color += texture2D(uTexture, clampUv(uv - uBlurStep * 5.0)) * 0.008773;
    color += texture2D(uTexture, clampUv(uv + uBlurStep * 6.0)) * 0.002218;
    color += texture2D(uTexture, clampUv(uv - uBlurStep * 6.0)) * 0.002218;

    return color;
  }

  void main() {
    vec2 uv = uSourceRect.xy + vUv * uSourceRect.zw;

    gl_FragColor = sampleGaussian(uv);
  }
`;
const GLASS_DISPLACE_FRAGMENT_SHADER = `
  precision mediump float;

  uniform sampler2D uTexture;
  uniform sampler2D uMap;
  uniform float uDisplacement;
  varying vec2 vUv;

  vec2 clampUv(vec2 uv) {
    return clamp(uv, vec2(0.001), vec2(0.999));
  }

  void main() {
    vec2 mapValue = texture2D(uMap, vUv).rg;
    vec2 displacement = (mapValue - vec2(0.5)) * uDisplacement;
    vec4 color = texture2D(uTexture, clampUv(vUv + displacement));

    gl_FragColor = vec4(color.rgb, 1.0);
  }
`;
const glassRenderer = createGlassRenderer();
const fallbackScreenContext = glassRenderer
  ? null
  : screenCanvas.getContext("2d", { alpha: false });
const contrastCanvas = document.createElement("canvas");
contrastCanvas.width = CONTRAST_SAMPLE_SIZE;
contrastCanvas.height = CONTRAST_SAMPLE_SIZE;
const contrastContext = contrastCanvas.getContext("2d", {
  alpha: false,
  willReadFrequently: true,
});
let dragging = false;
let activePointerId = null;
let captureStream = null;
let captureDisplayId = null;
let captureRestarting = false;
let captureGeometry = null;
let sampleFrameCallbackId = null;
let sampleFrameCallbackType = null;
let lastSampleRenderAt = 0;
let lastContrastUpdateAt = 0;
let lastContrastTheme = "";

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

  const compactUnits = [
    { threshold: 100000000, unit: "亿" },
    { threshold: 10000, unit: "万" },
  ];

  for (const { threshold, unit } of compactUnits) {
    if (number >= threshold) {
      return `${formatCompactUnit(number / threshold)}${unit}`;
    }
  }

  return new Intl.NumberFormat("zh-CN").format(number);
}

function formatCompactUnit(value) {
  return (Math.floor(value * 10) / 10).toFixed(1).replace(/\.0$/, "");
}

function updateQuota(window, remainingEl, barEl) {
  if (!window) {
    remainingEl.textContent = "--%";
    setQuotaProgress(barEl, 0);
    return;
  }

  const remaining = Number(window.remainingPercent);
  remainingEl.textContent = percentText(remaining);
  setQuotaProgress(barEl, remaining || 0);
}

function setQuotaProgress(barEl, percent) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const meterEl = barEl.closest(".meter");

  barEl.style.width = `${clamped}%`;
  meterEl?.setAttribute("data-quota-level", quotaLevel(clamped));
  meterEl?.style.setProperty(
    "--progress-angle",
    `${(clamped / 100) * PROGRESS_ARC_DEGREES}deg`,
  );
}

function quotaLevel(percent) {
  if (percent > 50) {
    return "green";
  }

  if (percent >= 20) {
    return "yellow";
  }

  return "red";
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

function createRenderTarget(gl) {
  return {
    framebuffer: gl.createFramebuffer(),
    height: 0,
    texture: createTexture(gl),
    width: 0,
  };
}

function resizeRenderTarget(gl, target, width, height) {
  if (target.width === width && target.height === height) {
    return;
  }

  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    target.texture,
    0,
  );

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("Failed to create glass blur framebuffer.");
  }

  target.width = width;
  target.height = height;
}

function createProgramInfo(gl, fragmentSource) {
  const program = createProgram(gl, GLASS_VERTEX_SHADER, fragmentSource);

  return {
    positionLocation: gl.getAttribLocation(program, "aPosition"),
    program,
    uniforms: {
      blurStep: gl.getUniformLocation(program, "uBlurStep"),
      displacement: gl.getUniformLocation(program, "uDisplacement"),
      map: gl.getUniformLocation(program, "uMap"),
      sourceRect: gl.getUniformLocation(program, "uSourceRect"),
      texture: gl.getUniformLocation(program, "uTexture"),
    },
    uvLocation: gl.getAttribLocation(program, "aUv"),
  };
}

function useProgramInfo(gl, renderer, programInfo) {
  gl.useProgram(programInfo.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.buffer);
  gl.enableVertexAttribArray(programInfo.positionLocation);
  gl.vertexAttribPointer(
    programInfo.positionLocation,
    2,
    gl.FLOAT,
    false,
    16,
    0,
  );
  gl.enableVertexAttribArray(programInfo.uvLocation);
  gl.vertexAttribPointer(programInfo.uvLocation, 2, gl.FLOAT, false, 16, 8);
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
    const blurProgram = createProgramInfo(gl, GLASS_BLUR_FRAGMENT_SHADER);
    const displaceProgram = createProgramInfo(
      gl,
      GLASS_DISPLACE_FRAGMENT_SHADER,
    );
    const vertices = new Float32Array([
      -1, -1, 0, 1,
      1, -1, 1, 1,
      -1, 1, 0, 0,
      1, 1, 1, 0,
    ]);
    const buffer = gl.createBuffer();
    const videoTexture = createTexture(gl);
    const mapTexture = createTexture(gl);
    const horizontalBlur = createRenderTarget(gl);
    const verticalBlur = createRenderTarget(gl);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
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
    useProgramInfo(gl, { buffer }, blurProgram);
    gl.uniform1i(blurProgram.uniforms.texture, 0);
    useProgramInfo(gl, { buffer }, displaceProgram);
    gl.uniform1i(displaceProgram.uniforms.texture, 0);
    gl.uniform1i(displaceProgram.uniforms.map, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);

    return {
      blurProgram,
      buffer,
      displaceProgram,
      gl,
      horizontalBlur,
      invalidateMap() {
        this.mapKey = "";
      },
      mapKey: "",
      mapTexture,
      verticalBlur,
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

function resizeGlassRenderTargets(renderer, metrics) {
  const gl = renderer.gl;

  resizeRenderTarget(gl, renderer.horizontalBlur, metrics.width, metrics.height);
  resizeRenderTarget(gl, renderer.verticalBlur, metrics.width, metrics.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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

function renderBlurPass(
  renderer,
  inputTexture,
  framebuffer,
  sourceRect,
  blurStep,
  metrics,
) {
  const gl = renderer.gl;
  const program = renderer.blurProgram;

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.viewport(0, 0, metrics.width, metrics.height);
  useProgramInfo(gl, renderer, program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, inputTexture);
  gl.uniform4fv(program.uniforms.sourceRect, sourceRect);
  gl.uniform2f(program.uniforms.blurStep, blurStep[0], blurStep[1]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function renderDisplacementPass(renderer, metrics) {
  const gl = renderer.gl;
  const program = renderer.displaceProgram;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, metrics.width, metrics.height);
  useProgramInfo(gl, renderer, program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, renderer.verticalBlur.texture);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, renderer.mapTexture);
  gl.uniform1f(program.uniforms.displacement, metrics.settings.displacement);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function renderGlassWithWebGL(metrics, source) {
  const renderer = glassRenderer;

  if (!renderer) {
    return false;
  }

  const gl = renderer.gl;

  try {
    resizeGlassRenderTargets(renderer, metrics);
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
    renderBlurPass(
      renderer,
      renderer.videoTexture,
      renderer.horizontalBlur.framebuffer,
      source.normalized,
      [metrics.settings.blurStdDeviation * source.normalized[2] * 0.5, 0],
      metrics,
    );
    renderBlurPass(
      renderer,
      renderer.horizontalBlur.texture,
      renderer.verticalBlur.framebuffer,
      [0, 0, 1, 1],
      [0, metrics.settings.blurStdDeviation * 0.5],
      metrics,
    );
    renderDisplacementPass(renderer, metrics);
    return true;
  } catch (error) {
    console.warn("Falling back to canvas blur.", error);
    return false;
  }
}

function renderGlassWithCanvas(metrics, source) {
  if (!fallbackScreenContext) {
    return;
  }

  fallbackScreenContext.clearRect(0, 0, metrics.width, metrics.height);
  fallbackScreenContext.filter = `blur(${
    Math.max(metrics.width, metrics.height) *
    metrics.settings.blurStdDeviation
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

function getRelativeLuminance(red, green, blue) {
  const channels = [red, green, blue].map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function updateAdaptiveContrast(source) {
  if (!contrastContext) {
    return;
  }

  const now = performance.now();
  if (now - lastContrastUpdateAt < CONTRAST_UPDATE_INTERVAL_MS) {
    return;
  }

  lastContrastUpdateAt = now;

  try {
    contrastContext.drawImage(
      screenVideo,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      CONTRAST_SAMPLE_SIZE,
      CONTRAST_SAMPLE_SIZE,
    );

    const data = contrastContext.getImageData(
      0,
      0,
      CONTRAST_SAMPLE_SIZE,
      CONTRAST_SAMPLE_SIZE,
    ).data;
    let luminance = 0;

    for (let index = 0; index < data.length; index += 4) {
      luminance += getRelativeLuminance(
        data[index],
        data[index + 1],
        data[index + 2],
      );
    }

    luminance /= data.length / 4;

    const theme = luminance > 0.48 ? "theme-on-light" : "theme-on-dark";
    if (theme === lastContrastTheme) {
      return;
    }

    document.body.classList.toggle("theme-on-light", theme === "theme-on-light");
    document.body.classList.toggle("theme-on-dark", theme === "theme-on-dark");
    lastContrastTheme = theme;
  } catch (error) {
    if (!lastContrastTheme) {
      document.body.classList.add("theme-on-light");
      lastContrastTheme = "theme-on-light";
    }
  }
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

  const source = getVideoSource(metrics);
  updateAdaptiveContrast(source);

  if (!renderGlassWithWebGL(metrics, source)) {
    renderGlassWithCanvas(metrics, source);
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

async function refreshUsage(options = {}) {
  try {
    const usage = await window.codexPet.readUsage(options);
    renderUsage(usage);
  } catch (error) {
    renderUsage({
      found: false,
      todayTokenUsage: {},
    });
    console.error(error);
  }
}

window.codexPet.onRefreshRequest((options) => refreshUsage(options));
window.codexPet.onCollapsedChange((value) => {
  document.body.classList.toggle("is-collapsed", Boolean(value));
  glassRenderer?.invalidateMap();
  syncCaptureGeometry();
});
window.codexPet.onGlowChange((value) => {
  document.body.classList.toggle("glow-enabled", Boolean(value));
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
  const [collapsed, glowEnabled] = await Promise.all([
    window.codexPet.isCollapsed(),
    window.codexPet.isGlowEnabled(),
  ]);
  document.body.classList.toggle("is-collapsed", Boolean(collapsed));
  document.body.classList.toggle("glow-enabled", Boolean(glowEnabled));
  glassRenderer?.invalidateMap();
}

syncWindowState();
startGlassCapture();
setInterval(syncCaptureGeometry, 250);
refreshUsage();
setInterval(refreshUsage, 60_000);
