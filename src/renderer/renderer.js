const statusTitle = document.querySelector("#statusTitle");
const primaryRemaining = document.querySelector("#primaryRemaining");
const secondaryRemaining = document.querySelector("#secondaryRemaining");
const primaryBar = document.querySelector("#primaryBar");
const secondaryBar = document.querySelector("#secondaryBar");
const primaryReset = document.querySelector("#primaryReset");
const secondaryReset = document.querySelector("#secondaryReset");
const lastTokens = document.querySelector("#lastTokens");
const planType = document.querySelector("#planType");
const updatedAt = document.querySelector("#updatedAt");
const petBubble = document.querySelector("#petBubble");
const petImage = document.querySelector("#petImage");
const fallbackPet = document.querySelector("#fallbackPet");
const refreshButton = document.querySelector("#refreshButton");
const topButton = document.querySelector("#topButton");
const closeButton = document.querySelector("#closeButton");

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

function formatTime(value) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function resetText(window) {
  if (!window) {
    return "没有窗口数据";
  }

  const minutes = Number(window.windowMinutes);
  const windowText = Number.isFinite(minutes) ? `${Math.round(minutes / 60)} 小时窗口` : "用量窗口";
  return `${windowText}，${formatTime(window.resetsAt)} 重置`;
}

function updateWindow(window, remainingEl, barEl, resetEl) {
  if (!window) {
    remainingEl.textContent = "--%";
    barEl.style.width = "0%";
    resetEl.textContent = "没有窗口数据";
    return;
  }

  const remaining = Number(window.remainingPercent);
  remainingEl.textContent = percentText(remaining);
  barEl.style.width = `${Math.max(0, Math.min(100, remaining || 0))}%`;
  resetEl.textContent = resetText(window);
}

function bubbleText(usage) {
  if (!usage.found) {
    return "还没读到用量";
  }

  const primary = usage.primary?.remainingPercent;
  const secondary = usage.secondary?.remainingPercent;

  if (Number.isFinite(primary) && primary <= 12) {
    return "短窗口快满了";
  }

  if (Number.isFinite(secondary) && secondary <= 15) {
    return "长窗口偏紧";
  }

  if (Number.isFinite(primary)) {
    return `剩余 ${Math.round(primary)}%`;
  }

  return "用量已更新";
}

function renderUsage(usage) {
  document.body.classList.toggle("error", !usage.found);

  if (!usage.found) {
    statusTitle.textContent = "未检测到用量";
    primaryRemaining.textContent = "--%";
    secondaryRemaining.textContent = "--%";
    primaryBar.style.width = "0%";
    secondaryBar.style.width = "0%";
    primaryReset.textContent = usage.message || "没有最近记录";
    secondaryReset.textContent = "打开 Codex 对话后会自动出现";
    lastTokens.textContent = "--";
    planType.textContent = "--";
    updatedAt.textContent = formatTime(usage.readAt);
    petBubble.textContent = "没有记录";
    return;
  }

  statusTitle.textContent = usage.rateLimitReachedType ? "用量已触顶" : "用量正常";
  updateWindow(usage.primary, primaryRemaining, primaryBar, primaryReset);
  updateWindow(usage.secondary, secondaryRemaining, secondaryBar, secondaryReset);
  lastTokens.textContent = compactNumber(usage.lastTokenUsage?.total_tokens);
  planType.textContent = usage.planType || "--";
  updatedAt.textContent = formatTime(usage.timestamp || usage.readAt);
  petBubble.textContent = bubbleText(usage);
}

function renderPet(usage) {
  if (usage.petImage?.url) {
    petImage.src = usage.petImage.url;
    petImage.hidden = false;
    fallbackPet.hidden = true;
    return;
  }

  petImage.hidden = true;
  fallbackPet.hidden = false;
}

async function refreshUsage() {
  refreshButton.disabled = true;
  try {
    const usage = await window.codexPet.readUsage();
    renderUsage(usage);
    renderPet(usage);
  } catch (error) {
    renderUsage({
      found: false,
      readAt: new Date().toISOString(),
      message: "读取失败，请稍后刷新",
    });
    console.error(error);
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", refreshUsage);
closeButton.addEventListener("click", () => window.codexPet.quit());
topButton.addEventListener("click", async () => {
  const isTop = await window.codexPet.toggleAlwaysOnTop();
  topButton.title = isTop ? "取消置顶" : "保持置顶";
  topButton.textContent = isTop ? "▣" : "□";
});

window.codexPet.isAlwaysOnTop().then((isTop) => {
  topButton.title = isTop ? "取消置顶" : "保持置顶";
  topButton.textContent = isTop ? "▣" : "□";
});

refreshUsage();
setInterval(refreshUsage, 60_000);
