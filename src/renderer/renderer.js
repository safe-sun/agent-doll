const primaryRemaining = document.querySelector("#primaryRemaining");
const secondaryRemaining = document.querySelector("#secondaryRemaining");
const primaryUsed = document.querySelector("#primaryUsed");
const secondaryUsed = document.querySelector("#secondaryUsed");
const primaryBar = document.querySelector("#primaryBar");
const secondaryBar = document.querySelector("#secondaryBar");
const todayTokens = document.querySelector("#todayTokens");
const todayInput = document.querySelector("#todayInput");
const todayOutput = document.querySelector("#todayOutput");
const todayReasoning = document.querySelector("#todayReasoning");
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

function updateQuota(window, remainingEl, usedEl, barEl) {
  if (!window) {
    remainingEl.textContent = "--%";
    usedEl.textContent = "已用 --%";
    barEl.style.width = "0%";
    return;
  }

  const remaining = Number(window.remainingPercent);
  const used = Number(window.usedPercent);
  remainingEl.textContent = percentText(remaining);
  usedEl.textContent = `已用 ${percentText(used)}`;
  barEl.style.width = `${Math.max(0, Math.min(100, remaining || 0))}%`;
}

function updateTodayTokens(usage) {
  const today = usage.todayTokenUsage || {};
  todayTokens.textContent = compactNumber(today.total_tokens);
  todayInput.textContent = compactNumber(today.input_tokens);
  todayOutput.textContent = compactNumber(today.output_tokens);
  todayReasoning.textContent = compactNumber(today.reasoning_output_tokens);
}

function renderUsage(usage) {
  document.body.classList.toggle("error", !usage.found);

  if (!usage.found) {
    updateQuota(null, primaryRemaining, primaryUsed, primaryBar);
    updateQuota(null, secondaryRemaining, secondaryUsed, secondaryBar);
    updateTodayTokens(usage);
    return;
  }

  updateQuota(usage.primary, primaryRemaining, primaryUsed, primaryBar);
  updateQuota(usage.secondary, secondaryRemaining, secondaryUsed, secondaryBar);
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
window.addEventListener("mousedown", (event) => {
  if (event.button !== 0) {
    return;
  }

  dragging = true;
  window.codexPet.dragStart({
    screenX: event.screenX,
    screenY: event.screenY,
  });
});
window.addEventListener("mousemove", (event) => {
  if (!dragging) {
    return;
  }

  window.codexPet.dragMove({
    screenX: event.screenX,
    screenY: event.screenY,
  });
});
window.addEventListener("mouseup", () => {
  if (!dragging) {
    return;
  }

  dragging = false;
  window.codexPet.dragEnd();
});
window.addEventListener("blur", () => {
  dragging = false;
  window.codexPet.dragEnd();
});
refreshUsage();
setInterval(refreshUsage, 60_000);
