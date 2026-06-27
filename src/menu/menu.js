const contextMenu = document.querySelector("#contextMenu");

const contextMenuActions = {
  async refresh() {
    await window.codexPet.refreshUsageWindow();
  },
  async toggleTop() {
    await window.codexPet.toggleAlwaysOnTop();
  },
  async toggleCollapsed() {
    await window.codexPet.toggleCollapsed();
  },
  async toggleGlow() {
    await window.codexPet.toggleGlow();
  },
  async toggleGlowBreathing() {
    await window.codexPet.toggleGlowBreathing();
  },
  async openCodexHome() {
    await window.codexPet.openCodexHome();
  },
  async reload() {
    await window.codexPet.reload();
  },
  async quit() {
    await window.codexPet.quit();
  },
};

window.renderContextMenuForState = (state) => renderContextMenu(state);

function renderContextMenu(state) {
  const items = [
    { action: "refresh", label: "刷新" },
    { action: "toggleTop", checked: state.alwaysOnTop, label: "置顶" },
    {
      action: "toggleCollapsed",
      label: state.collapsed ? "展开" : "收起",
    },
    { action: "toggleGlow", checked: state.glowEnabled, label: "泛光" },
    {
      action: "toggleGlowBreathing",
      checked: state.glowEnabled && state.glowBreathing,
      disabled: !state.glowEnabled,
      label: "呼吸",
    },
    { separator: true },
    { action: "openCodexHome", label: "Codex目录" },
    { action: "reload", label: "重载" },
    { action: "quit", label: "退出" },
  ];

  contextMenu.replaceChildren(
    ...items.map((item) => {
      if (item.separator) {
        return createContextMenuSeparator();
      }

      return createContextMenuItem(item);
    }),
  );
}

function createContextMenuItem(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "context-menu-item";
  button.dataset.action = item.action;
  button.textContent = item.label;
  button.disabled = Boolean(item.disabled);

  if (item.checked) {
    button.classList.add("is-checked");
    button.setAttribute("aria-checked", "true");
  }

  return button;
}

function createContextMenuSeparator() {
  const separator = document.createElement("span");
  separator.className = "context-menu-separator";
  separator.setAttribute("role", "separator");
  return separator;
}

contextMenu.addEventListener("click", async (event) => {
  const button = event.target.closest(".context-menu-item");

  if (!button || button.disabled) {
    return;
  }

  const action = contextMenuActions[button.dataset.action];
  await window.codexPet.closeContextMenu();

  if (action) {
    await action();
  }
});

window.addEventListener("keydown", async (event) => {
  if (event.key === "Escape") {
    await window.codexPet.closeContextMenu();
  }
});
