const path = require("node:path");
const { app, BrowserWindow, ipcMain, Menu, screen, shell } = require("electron");
const { readCodexUsage } = require("./usage-reader");

let mainWindow;
let alwaysOnTop = true;
let dragState = null;

function createWindow() {
  const windowWidth = 236;
  const windowHeight = 236;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = display.workArea;
  const sideMargin = Math.max(24, Math.round(workArea.width * 0.08));
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
    minWidth: windowWidth,
    minHeight: windowHeight,
    maxWidth: windowWidth,
    maxHeight: windowHeight,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    skipTaskbar: true,
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
  mainWindow.webContents.on("context-menu", (event) => {
    event.preventDefault();
    createContextMenu().popup({ window: mainWindow });
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.moveTop();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createContextMenu() {
  return Menu.buildFromTemplate([
    {
      label: "刷新用量",
      click: () => mainWindow?.webContents.send("codex-usage:refresh"),
    },
    {
      label: alwaysOnTop ? "取消置顶" : "保持置顶",
      type: "checkbox",
      checked: alwaysOnTop,
      click: () => setAlwaysOnTop(!alwaysOnTop),
    },
    { type: "separator" },
    {
      label: "打开 Codex 目录",
      click: async () => {
        const usage = await readCodexUsage();
        await shell.openPath(usage.codexHome);
      },
    },
    {
      label: "重新载入窗口",
      click: () => mainWindow?.reload(),
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => app.quit(),
    },
  ]);
}

function setAlwaysOnTop(value) {
  alwaysOnTop = value;
  if (!mainWindow) {
    return alwaysOnTop;
  }

  mainWindow.setAlwaysOnTop(alwaysOnTop, "screen-saver");
  if (alwaysOnTop) {
    mainWindow.moveTop();
  }

  return alwaysOnTop;
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
  return setAlwaysOnTop(!alwaysOnTop);
});

ipcMain.handle("window:is-top", () => alwaysOnTop);

ipcMain.handle("window:open-codex-home", async () => {
  const usage = await readCodexUsage();
  await shell.openPath(usage.codexHome);
});

ipcMain.handle("window:quit", () => {
  app.quit();
});

ipcMain.handle("window:show-context-menu", () => {
  if (mainWindow) {
    createContextMenu().popup({ window: mainWindow });
  }
});

ipcMain.handle("window:drag-start", (_event, point) => {
  if (!mainWindow || !point) {
    return;
  }

  dragState = {
    startMouseX: point.screenX,
    startMouseY: point.screenY,
    startBounds: mainWindow.getBounds(),
  };
});

ipcMain.handle("window:drag-move", (_event, point) => {
  if (!mainWindow || !dragState || !point) {
    return;
  }

  const deltaX = Math.round(point.screenX - dragState.startMouseX);
  const deltaY = Math.round(point.screenY - dragState.startMouseY);
  mainWindow.setPosition(
    dragState.startBounds.x + deltaX,
    dragState.startBounds.y + deltaY,
    false,
  );
});

ipcMain.handle("window:drag-end", () => {
  dragState = null;
});
