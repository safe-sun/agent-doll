const path = require("node:path");
const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
} = require("electron");
const { readCodexUsage } = require("./usage-reader");

let mainWindow;
let contextMenuWindow;
let contextMenuReady = null;
let alwaysOnTop = true;
let collapsed = false;
let glowEnabled = false;
let glowBreathing = false;
let dragState = null;
let dragInterval = null;
const WINDOW_GLOW_MARGIN = 6;
const EXPANDED_SIZE = {
  width: 150 + WINDOW_GLOW_MARGIN * 2,
  height: 150 + WINDOW_GLOW_MARGIN * 2,
};
const COLLAPSED_SIZE = {
  width: 50 + WINDOW_GLOW_MARGIN * 2,
  height: 50 + WINDOW_GLOW_MARGIN * 2,
};
const CONTEXT_MENU_SIZE = {
  width: 136,
  height: 208,
};
const EDGE_THRESHOLD = 18;
const CAPTURE_GEOMETRY_INTERVAL_MS = 80;
let lastCaptureGeometrySentAt = 0;
const gotSingleInstanceLock = app.requestSingleInstanceLock();

function getCaptureGeometry() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  const bounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);

  return {
    window: bounds,
    display: display.bounds,
    displayId: String(display.id),
    scaleFactor: display.scaleFactor || 1,
  };
}

function sendCaptureGeometry(force = false) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const now = Date.now();
  if (!force && now - lastCaptureGeometrySentAt < CAPTURE_GEOMETRY_INTERVAL_MS) {
    return;
  }

  lastCaptureGeometrySentAt = now;
  mainWindow.webContents.send(
    "glass-capture:geometry-changed",
    getCaptureGeometry(),
  );
}

async function getScreenSourceForWindow() {
  const geometry = getCaptureGeometry();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 0, height: 0 },
  });

  if (!sources.length) {
    return null;
  }

  if (!geometry) {
    return sources[0];
  }

  return (
    sources.find((source) => source.display_id === geometry.displayId) ||
    sources[0]
  );
}

function configureDisplayCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const source = await getScreenSourceForWindow();

        if (!source) {
          callback({});
          return;
        }

        callback({ video: source });
      } catch (error) {
        console.error(error);
        callback({});
      }
    },
  );
}

function createWindow() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = display.workArea;
  const sideMargin = Math.max(24, Math.round(workArea.width * 0.08));
  const x = Math.max(
    workArea.x + 20,
    Math.round(workArea.x + workArea.width - EXPANDED_SIZE.width - sideMargin),
  );
  const y = Math.max(
    workArea.y + 20,
    Math.round(workArea.y + workArea.height - EXPANDED_SIZE.height - 24),
  );

  mainWindow = new BrowserWindow({
    width: EXPANDED_SIZE.width,
    height: EXPANDED_SIZE.height,
    minWidth: EXPANDED_SIZE.width,
    minHeight: EXPANDED_SIZE.height,
    maxWidth: EXPANDED_SIZE.width,
    maxHeight: EXPANDED_SIZE.height,
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
  mainWindow.setContentProtection(true);
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow?.webContents.send("window:collapsed-changed", collapsed);
    mainWindow?.webContents.send("window:glow-changed", glowEnabled);
    mainWindow?.webContents.send(
      "window:glow-breathing-changed",
      glowBreathing,
    );
    sendCaptureGeometry(true);
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.moveTop();
    sendCaptureGeometry(true);
  });

  mainWindow.on("closed", () => {
    stopDrag();
    if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
      contextMenuWindow.destroy();
    }
    mainWindow = null;
  });
}

function createContextMenuWindow() {
  if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
    return contextMenuWindow;
  }

  contextMenuWindow = new BrowserWindow({
    width: CONTEXT_MENU_SIZE.width,
    height: CONTEXT_MENU_SIZE.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  contextMenuWindow.setMenuBarVisibility(false);
  contextMenuWindow.setAlwaysOnTop(true, "pop-up-menu");
  contextMenuWindow.setContentProtection(true);
  contextMenuWindow.on("blur", () => hideContextMenuWindow());
  contextMenuWindow.on("closed", () => {
    contextMenuWindow = null;
    contextMenuReady = null;
  });

  contextMenuReady = contextMenuWindow.loadFile(
    path.join(__dirname, "menu", "index.html"),
  );

  return contextMenuWindow;
}

function getContextMenuState() {
  return {
    alwaysOnTop,
    collapsed,
    glowBreathing,
    glowEnabled,
  };
}

async function showContextMenuWindow(point = {}) {
  const menuWindow = createContextMenuWindow();
  const cursor = screen.getCursorScreenPoint();
  const x = Number.isFinite(point.x) ? Math.round(point.x) : cursor.x;
  const y = Number.isFinite(point.y) ? Math.round(point.y) : cursor.y;
  const wasVisible = menuWindow.isVisible();

  menuWindow.setBounds(
    {
      x,
      y,
      width: CONTEXT_MENU_SIZE.width,
      height: CONTEXT_MENU_SIZE.height,
    },
    false,
  );

  try {
    await contextMenuReady;

    if (!contextMenuWindow || contextMenuWindow.isDestroyed()) {
      return;
    }

    const renderScript = `window.renderContextMenuForState(${JSON.stringify(
      getContextMenuState(),
    )})`;
    await contextMenuWindow.webContents.executeJavaScript(renderScript);
  } catch (error) {
    console.error(error);
    return;
  }

  if (!wasVisible) {
    contextMenuWindow.show();
  }

  contextMenuWindow.focus();
}

function hideContextMenuWindow() {
  if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
    contextMenuWindow.hide();
  }
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
  const size = dragState.size;
  mainWindow.setBounds(
    {
      x: dragState.startBounds.x + deltaX,
      y: dragState.startBounds.y + deltaY,
      width: size.width,
      height: size.height,
    },
    false,
  );
  sendCaptureGeometry();
}

function getActiveSize() {
  return collapsed ? COLLAPSED_SIZE : EXPANDED_SIZE;
}

function getDisplayForBounds(bounds) {
  return screen.getDisplayMatching(bounds).workArea;
}

function clampBoundsToWorkArea(bounds, size, workArea) {
  return {
    x: Math.min(
      Math.max(bounds.x, workArea.x),
      workArea.x + workArea.width - size.width,
    ),
    y: Math.min(
      Math.max(bounds.y, workArea.y),
      workArea.y + workArea.height - size.height,
    ),
    width: size.width,
    height: size.height,
  };
}

function getNearestEdge(bounds) {
  const workArea = getDisplayForBounds(bounds);
  const distances = [
    { edge: "left", value: bounds.x - workArea.x },
    {
      edge: "right",
      value: workArea.x + workArea.width - (bounds.x + bounds.width),
    },
    { edge: "top", value: bounds.y - workArea.y },
    {
      edge: "bottom",
      value: workArea.y + workArea.height - (bounds.y + bounds.height),
    },
  ];
  const crossedEdges = distances
    .filter(({ value }) => value <= 0)
    .sort((a, b) => Math.abs(a.value) - Math.abs(b.value));

  if (crossedEdges.length) {
    return crossedEdges[0].edge;
  }

  const [nearestEdge] = distances.sort((a, b) => a.value - b.value);
  return nearestEdge.value <= EDGE_THRESHOLD ? nearestEdge.edge : null;
}

function getBoundsForMode(nextCollapsed, edge = null) {
  const current = mainWindow.getBounds();
  const fromSize = getActiveSize();
  const nextSize = nextCollapsed ? COLLAPSED_SIZE : EXPANDED_SIZE;
  const workArea = getDisplayForBounds(current);
  const centerX = current.x + fromSize.width / 2;
  const centerY = current.y + fromSize.height / 2;
  const nextBounds = {
    x: Math.round(centerX - nextSize.width / 2),
    y: Math.round(centerY - nextSize.height / 2),
    width: nextSize.width,
    height: nextSize.height,
  };

  if (edge === "left") {
    nextBounds.x = workArea.x;
  } else if (edge === "right") {
    nextBounds.x = workArea.x + workArea.width - nextSize.width;
  } else if (edge === "top") {
    nextBounds.y = workArea.y;
  } else if (edge === "bottom") {
    nextBounds.y = workArea.y + workArea.height - nextSize.height;
  }

  return clampBoundsToWorkArea(nextBounds, nextSize, workArea);
}

function setCollapsed(nextCollapsed, edge = null) {
  if (!mainWindow) {
    collapsed = nextCollapsed;
    return collapsed;
  }

  const size = nextCollapsed ? COLLAPSED_SIZE : EXPANDED_SIZE;
  const bounds = getBoundsForMode(nextCollapsed, edge);
  collapsed = nextCollapsed;

  mainWindow.setMinimumSize(size.width, size.height);
  mainWindow.setMaximumSize(size.width, size.height);
  mainWindow.setBounds(bounds, false);
  mainWindow.webContents.send("window:collapsed-changed", collapsed);
  sendCaptureGeometry(true);
  return collapsed;
}

function updateCollapseAfterDrag() {
  if (!mainWindow) {
    return;
  }

  const bounds = mainWindow.getBounds();
  const edge = getNearestEdge(bounds);
  setCollapsed(Boolean(edge), edge);
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

function setGlowEnabled(value) {
  glowEnabled = value;
  if (!glowEnabled) {
    glowBreathing = false;
    mainWindow?.webContents.send(
      "window:glow-breathing-changed",
      glowBreathing,
    );
  }
  mainWindow?.webContents.send("window:glow-changed", glowEnabled);
  return glowEnabled;
}

function setGlowBreathing(value) {
  glowBreathing = glowEnabled && value;
  mainWindow?.webContents.send("window:glow-breathing-changed", glowBreathing);
  return glowBreathing;
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.moveTop();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    configureDisplayCapture();
    createWindow();

    app.on("activate", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("codex-usage:read", async (_event, options) =>
  readCodexUsage(options),
);

ipcMain.handle("codex-usage:refresh-window", () => {
  mainWindow?.webContents.send("codex-usage:refresh", { force: true });
});

ipcMain.handle("window:toggle-top", () => {
  return setAlwaysOnTop(!alwaysOnTop);
});

ipcMain.handle("window:is-top", () => alwaysOnTop);

ipcMain.handle("context-menu:show", (_event, point) => {
  return showContextMenuWindow(point);
});

ipcMain.handle("context-menu:close", () => {
  hideContextMenuWindow();
});

ipcMain.handle("window:toggle-collapsed", () => {
  return setCollapsed(!collapsed);
});

ipcMain.handle("window:toggle-glow", () => {
  return setGlowEnabled(!glowEnabled);
});

ipcMain.handle("window:toggle-glow-breathing", () => {
  return setGlowBreathing(!glowBreathing);
});

ipcMain.handle("window:open-codex-home", async () => {
  const usage = await readCodexUsage();
  await shell.openPath(usage.codexHome);
});

ipcMain.handle("window:reload", () => {
  mainWindow?.reload();
});

ipcMain.handle("window:quit", () => {
  app.quit();
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
    size: getActiveSize(),
    startedAt: Date.now(),
  };

  if (!dragInterval) {
    dragInterval = setInterval(tickDrag, 16);
  }
});

ipcMain.handle("window:drag-end", () => {
  stopDrag();
  updateCollapseAfterDrag();
});

ipcMain.handle("window:is-collapsed", () => collapsed);

ipcMain.handle("window:is-glow-enabled", () => glowEnabled);

ipcMain.handle("window:is-glow-breathing", () => glowBreathing);

ipcMain.handle("glass-capture:geometry", () => getCaptureGeometry());

ipcMain.handle("glass-capture:source", async () => {
  const source = await getScreenSourceForWindow();

  if (!source) {
    return null;
  }

  return {
    id: source.id,
    name: source.name,
    displayId: source.display_id,
    geometry: getCaptureGeometry(),
  };
});
