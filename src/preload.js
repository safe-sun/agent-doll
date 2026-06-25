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
  openCodexHome: () => ipcRenderer.invoke("window:open-codex-home"),
  quit: () => ipcRenderer.invoke("window:quit"),
});
