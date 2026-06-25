const primaryRemaining = document.querySelector("#primaryRemaining");
const secondaryRemaining = document.querySelector("#secondaryRemaining");
const primaryBar = document.querySelector("#primaryBar");
const secondaryBar = document.querySelector("#secondaryBar");
const todayTokens = document.querySelector("#todayTokens");
const todayInput = document.querySelector("#todayInput");
const todayOutput = document.querySelector("#todayOutput");
let dragging = false;

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
window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  window.codexPet.showContextMenu();
});
window.addEventListener("pointermove", (event) => {
  document.documentElement.style.setProperty("--light-x", `${event.clientX}px`);
  document.documentElement.style.setProperty("--light-y", `${event.clientY}px`);
});
window.addEventListener("mousedown", (event) => {
  if (event.button !== 0) {
    return;
  }

  dragging = true;
  if (document.body.setPointerCapture && event.pointerId !== undefined) {
    document.body.setPointerCapture(event.pointerId);
  }
  window.codexPet.dragStart();
});
window.addEventListener("mouseup", (event) => {
  if (!dragging) {
    return;
  }

  dragging = false;
  if (document.body.releasePointerCapture && event.pointerId !== undefined) {
    try {
      document.body.releasePointerCapture(event.pointerId);
    } catch {
      // The capture can already be gone if the window lost focus.
    }
  }
  window.codexPet.dragEnd();
});
window.addEventListener("blur", () => {
  dragging = false;
  window.codexPet.dragEnd();
});
refreshUsage();
setInterval(refreshUsage, 60_000);
