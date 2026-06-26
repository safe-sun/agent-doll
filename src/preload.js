const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexPet", {
  readUsage: (options) => ipcRenderer.invoke("codex-usage:read", options),
  onRefreshRequest: (callback) => {
    const listener = (_event, options) => callback(options);
    ipcRenderer.on("codex-usage:refresh", listener);
    return () => ipcRenderer.removeListener("codex-usage:refresh", listener);
  },
  toggleAlwaysOnTop: () => ipcRenderer.invoke("window:toggle-top"),
  isAlwaysOnTop: () => ipcRenderer.invoke("window:is-top"),
  showContextMenu: () => ipcRenderer.invoke("window:show-context-menu"),
  isCollapsed: () => ipcRenderer.invoke("window:is-collapsed"),
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
  dragStart: () => ipcRenderer.invoke("window:drag-start"),
  dragEnd: () => ipcRenderer.invoke("window:drag-end"),
  openCodexHome: () => ipcRenderer.invoke("window:open-codex-home"),
  quit: () => ipcRenderer.invoke("window:quit"),
});
