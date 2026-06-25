const path = require("node:path");
const { app, BrowserWindow, ipcMain, Menu, screen, shell } = require("electron");
const { readCodexUsage } = require("./usage-reader");

let mainWindow;
let alwaysOnTop = true;
let dragState = null;
let dragInterval = null;
const WINDOW_WIDTH = 236;
const WINDOW_HEIGHT = 236;

function createWindow() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = display.workArea;
  const sideMargin = Math.max(24, Math.round(workArea.width * 0.08));
  const x = Math.max(
    workArea.x + 20,
    Math.round(workArea.x + workArea.width - WINDOW_WIDTH - sideMargin),
  );
  const y = Math.max(
    workArea.y + 20,
    Math.round(workArea.y + workArea.height - WINDOW_HEIGHT - 24),
  );

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_WIDTH,
    minHeight: WINDOW_HEIGHT,
    maxWidth: WINDOW_WIDTH,
    maxHeight: WINDOW_HEIGHT,
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
    stopDrag();
    mainWindow = null;
  });
}

function stopDrag() {
  dragState = null;

  if (dragInterval) {
    clearInterval(dragInterval);
    dragInterval = null;
  }
}

function tickDrag() {
  if (!mainWindow || !dragState) {
    stopDrag();
    return;
  }

  if (Date.now() - dragState.startedAt > 15000) {
    stopDrag();
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  const deltaX = Math.round(cursor.x - dragState.startMouseX);
  const deltaY = Math.round(cursor.y - dragState.startMouseY);
  mainWindow.setBounds(
    {
      x: dragState.startBounds.x + deltaX,
      y: dragState.startBounds.y + deltaY,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    },
    false,
  );
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

ipcMain.handle("window:drag-start", () => {
  if (!mainWindow) {
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  dragState = {
    startMouseX: cursor.x,
    startMouseY: cursor.y,
    startBounds: mainWindow.getBounds(),
    startedAt: Date.now(),
  };

  if (!dragInterval) {
    dragInterval = setInterval(tickDrag, 16);
  }
});

ipcMain.handle("window:drag-end", () => {
  stopDrag();
});
