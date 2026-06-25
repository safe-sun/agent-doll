const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexPet", {
  readUsage: () => ipcRenderer.invoke("codex-usage:read"),
  toggleAlwaysOnTop: () => ipcRenderer.invoke("window:toggle-top"),
  isAlwaysOnTop: () => ipcRenderer.invoke("window:is-top"),
  openCodexHome: () => ipcRenderer.invoke("window:open-codex-home"),
  quit: () => ipcRenderer.invoke("window:quit"),
});
