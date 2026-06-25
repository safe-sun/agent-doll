const primaryRemaining = document.querySelector("#primaryRemaining");
const secondaryRemaining = document.querySelector("#secondaryRemaining");
const primaryBar = document.querySelector("#primaryBar");
const secondaryBar = document.querySelector("#secondaryBar");
const todayTokens = document.querySelector("#todayTokens");
const todayInput = document.querySelector("#todayInput");
const todayOutput = document.querySelector("#todayOutput");
let dragging = false;
let activePointerId = null;
const light = {
  x: 0.44,
  y: 0.18,
  targetX: 0.44,
  targetY: 0.18,
};

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
});
window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  window.codexPet.showContextMenu();
});
window.addEventListener("pointermove", (event) => {
  light.targetX = Math.max(0, Math.min(1, event.clientX / window.innerWidth));
  light.targetY = Math.max(0, Math.min(1, event.clientY / window.innerHeight));
});
window.addEventListener("pointerleave", () => {
  light.targetX = 0.44;
  light.targetY = 0.18;
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

async function syncWindowState() {
  const collapsed = await window.codexPet.isCollapsed();
  document.body.classList.toggle("is-collapsed", Boolean(collapsed));
}

function animateLight() {
  light.x += (light.targetX - light.x) * 0.16;
  light.y += (light.targetY - light.y) * 0.16;

  const xPercent = `${(light.x * 100).toFixed(2)}%`;
  const yPercent = `${(light.y * 100).toFixed(2)}%`;
  const glintX = `${((light.x - 0.5) * 10).toFixed(2)}px`;
  const glintY = `${((light.y - 0.5) * 7).toFixed(2)}px`;
  const angle =
    (Math.atan2(light.y - 0.5, light.x - 0.5) * 180) / Math.PI + 120;

  document.documentElement.style.setProperty("--pointer-x", xPercent);
  document.documentElement.style.setProperty("--pointer-y", yPercent);
  document.documentElement.style.setProperty("--glint-x", glintX);
  document.documentElement.style.setProperty("--glint-y", glintY);
  document.documentElement.style.setProperty("--light-angle", `${angle}deg`);
  requestAnimationFrame(animateLight);
}

syncWindowState();
animateLight();
refreshUsage();
setInterval(refreshUsage, 60_000);
