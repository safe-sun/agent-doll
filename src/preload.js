const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexPet", {
  readUsage: (options) => ipcRenderer.invoke("codex-usage:read", options),
  onRefreshRequest: (callback) => {
    const listener = (_event, options) => callback(options);
    ipcRenderer.on("codex-usage:refresh", listener);
    return () => ipcRenderer.removeListener("codex-usage:refresh", listener);
  },
  refreshUsageWindow: () => ipcRenderer.invoke("codex-usage:refresh-window"),
  showContextMenu: (point) => ipcRenderer.invoke("context-menu:show", point),
  closeContextMenu: () => ipcRenderer.invoke("context-menu:close"),
  getContextMenuState: () => ipcRenderer.invoke("context-menu:state"),
  onContextMenuOpen: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("context-menu:open", listener);
    return () => ipcRenderer.removeListener("context-menu:open", listener);
  },
  toggleAlwaysOnTop: () => ipcRenderer.invoke("window:toggle-top"),
  isAlwaysOnTop: () => ipcRenderer.invoke("window:is-top"),
  toggleCollapsed: () => ipcRenderer.invoke("window:toggle-collapsed"),
  toggleGlow: () => ipcRenderer.invoke("window:toggle-glow"),
  toggleGlowBreathing: () =>
    ipcRenderer.invoke("window:toggle-glow-breathing"),
  isCollapsed: () => ipcRenderer.invoke("window:is-collapsed"),
  isGlowEnabled: () => ipcRenderer.invoke("window:is-glow-enabled"),
  isGlowBreathing: () => ipcRenderer.invoke("window:is-glow-breathing"),
  getGlassCaptureGeometry: () => ipcRenderer.invoke("glass-capture:geometry"),
  getGlassCaptureSource: () => ipcRenderer.invoke("glass-capture:source"),
  onGlassCaptureGeometry: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("glass-capture:geometry-changed", listener);
    return () =>
      ipcRenderer.removeListener("glass-capture:geometry-changed", listener);
  },
  onCollapsedChange: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("window:collapsed-changed", listener);
    return () => ipcRenderer.removeListener("window:collapsed-changed", listener);
  },
  onGlowChange: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("window:glow-changed", listener);
    return () => ipcRenderer.removeListener("window:glow-changed", listener);
  },
  onGlowBreathingChange: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("window:glow-breathing-changed", listener);
    return () =>
      ipcRenderer.removeListener("window:glow-breathing-changed", listener);
  },
  dragStart: () => ipcRenderer.invoke("window:drag-start"),
  dragEnd: () => ipcRenderer.invoke("window:drag-end"),
  reload: () => ipcRenderer.invoke("window:reload"),
  openCodexHome: () => ipcRenderer.invoke("window:open-codex-home"),
  quit: () => ipcRenderer.invoke("window:quit"),
});
