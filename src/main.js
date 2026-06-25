const path = require("node:path");
const { app, BrowserWindow, ipcMain, Menu, screen, shell } = require("electron");
const { readCodexUsage } = require("./usage-reader");

let mainWindow;
let alwaysOnTop = true;

function createWindow() {
  const windowWidth = 500;
  const windowHeight = 320;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = display.workArea;
  const sideMargin = Math.max(24, Math.round(workArea.width * 0.16));
  const x = Math.max(
    workArea.x + 20,
    Math.round(workArea.x + workArea.width - windowWidth - sideMargin),
  );
  const y = Math.max(
    workArea.y + 20,
    Math.round(workArea.y + workArea.height - windowHeight - 24),
  );

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 340,
    minHeight: 260,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    skipTaskbar: false,
    alwaysOnTop,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAlwaysOnTop(alwaysOnTop, "screen-saver");
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.moveTop();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("codex-usage:read", async () => readCodexUsage());

ipcMain.handle("window:toggle-top", () => {
  alwaysOnTop = !alwaysOnTop;
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(alwaysOnTop, "screen-saver");
    if (alwaysOnTop) {
      mainWindow.moveTop();
    }
  }

  return alwaysOnTop;
});

ipcMain.handle("window:is-top", () => alwaysOnTop);

ipcMain.handle("window:open-codex-home", async () => {
  const usage = await readCodexUsage();
  await shell.openPath(usage.codexHome);
});

ipcMain.handle("window:quit", () => {
  app.quit();
});
