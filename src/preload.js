const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexPet", {
  readUsage: () => ipcRenderer.invoke("codex-usage:read"),
  onRefreshRequest: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("codex-usage:refresh", listener);
    return () => ipcRenderer.removeListener("codex-usage:refresh", listener);
  },
  toggleAlwaysOnTop: () => ipcRenderer.invoke("window:toggle-top"),
  isAlwaysOnTop: () => ipcRenderer.invoke("window:is-top"),
  showContextMenu: () => ipcRenderer.invoke("window:show-context-menu"),
  dragStart: (point) => ipcRenderer.invoke("window:drag-start", point),
  dragMove: (point) => ipcRenderer.invoke("window:drag-move", point),
  dragEnd: () => ipcRenderer.invoke("window:drag-end"),
  openCodexHome: () => ipcRenderer.invoke("window:open-codex-home"),
  quit: () => ipcRenderer.invoke("window:quit"),
});
