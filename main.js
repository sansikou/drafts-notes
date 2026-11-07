/**
 * main.js — Drafts 主进程
 *
 * 职责：
 *  1. 系统托盘常驻
 *  2. 悬浮球窗口置顶，点击展开主编辑窗口
 *  3. 主窗口右上角：「−」缩小为悬浮球，「×」缩小到托盘
 *  4. 开机自启动
 *  5. electron-store 本地缓存（云同步在渲染进程通过 Supabase 完成）
 */

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  screen,
  ipcMain,
  nativeImage,
} = require('electron');

app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:7897');

const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

// ─── 常量 ────────────────────────────────────────────────────────────────────

const MAIN_WIDTH = 400;
const MAIN_MIN_WIDTH = 320;
const MAIN_MIN_HEIGHT = 420;
const BALL_SIZE = 44;

// ─── 全局状态 ────────────────────────────────────────────────────────────────

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** @type {BrowserWindow | null} */
let floatWindow = null;

/** @type {Tray | null} */
let tray = null;

/** @type {'ball' | 'expanded' | 'tray'} */
let windowMode = 'ball';

const store = new Store({
  defaults: {
    notes: [],
    activeNoteId: null,
    autoLaunch: false,
    ballPosition: null,
    mainWindowBounds: null,
  },
});

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function getPrimaryWorkArea() {
  return screen.getPrimaryDisplay().workArea;
}

function resourcePath(...parts) {
  return path.join(__dirname, ...parts);
}

function firstExisting(...candidates) {
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* asar 内 existsSync 通常可用；异常则跳过 */
    }
  }
  return null;
}

/** 窗口 / 快捷方式用 .ico；托盘优先 png（Windows 托盘对 ico/jpg 更不稳定） */
function getWindowIconPath() {
  return firstExisting(
    resourcePath('icon.ico'),
    resourcePath('icon.png'),
    resourcePath('icon.jpg')
  );
}

function getTrayIconPath() {
  return firstExisting(
    resourcePath('icon-tray.png'),
    resourcePath('icon.png'),
    resourcePath('icon.ico'),
    resourcePath('icon.jpg')
  );
}

function getAppIcon(size) {
  const iconPath = size && size <= 32 ? getTrayIconPath() : getWindowIconPath();
  if (iconPath) {
    let image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      if (size) image = image.resize({ width: size, height: size });
      return image;
    }
  }
  return createFallbackTrayIcon(size || 16);
}

function createFallbackTrayIcon(size) {
  const canvas = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - size / 2 + 0.5;
      const dy = y - size / 2 + 0.5;
      const inCircle = dx * dx + dy * dy <= (size / 2 - 1) ** 2;
      canvas[idx] = inCircle ? 0 : 0;
      canvas[idx + 1] = inCircle ? 122 : 0;
      canvas[idx + 2] = inCircle ? 255 : 0;
      canvas[idx + 3] = inCircle ? 255 : 0;
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

/** 默认悬浮球位置：屏幕右下角 */
function getDefaultBallPosition() {
  const { x, y, width, height } = getPrimaryWorkArea();
  return {
    x: x + width - BALL_SIZE - 24,
    y: y + height - BALL_SIZE - 24,
  };
}

function getBallPosition() {
  return store.get('ballPosition') || getDefaultBallPosition();
}

function saveBallPosition(pos) {
  store.set('ballPosition', pos);
}

/** 展开后主窗口位置与尺寸（记住用户拖拽后的大小） */
function getMainWindowBounds() {
  const workArea = getPrimaryWorkArea();
  const saved = store.get('mainWindowBounds');

  if (saved?.width && saved?.height) {
    const width = Math.max(MAIN_MIN_WIDTH, Math.min(saved.width, workArea.width));
    const height = Math.max(MAIN_MIN_HEIGHT, Math.min(saved.height, workArea.height));
    const x = Math.max(
      workArea.x,
      Math.min(saved.x ?? workArea.x + workArea.width - width, workArea.x + workArea.width - width)
    );
    const y = Math.max(
      workArea.y,
      Math.min(saved.y ?? workArea.y, workArea.y + workArea.height - height)
    );
    return { x, y, width, height };
  }

  return {
    x: workArea.x + workArea.width - MAIN_WIDTH,
    y: workArea.y,
    width: MAIN_WIDTH,
    height: workArea.height,
  };
}

function saveMainWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || windowMode !== 'expanded') return;
  store.set('mainWindowBounds', mainWindow.getBounds());
}

// ─── 窗口模式切换 ─────────────────────────────────────────────────────────────

/** 展开主编辑窗口，隐藏悬浮球 */
function expandMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  windowMode = 'expanded';
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.hide();
  }

  mainWindow.setBounds(getMainWindowBounds());
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('focus-editor');
}

/** 缩小为悬浮球 */
function collapseToBall() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  windowMode = 'ball';
  mainWindow.hide();

  if (!floatWindow || floatWindow.isDestroyed()) {
    createFloatWindow();
  } else {
    const pos = getBallPosition();
    floatWindow.setBounds({ x: pos.x, y: pos.y, width: BALL_SIZE, height: BALL_SIZE });
    floatWindow.show();
  }
}

/** 缩小到托盘（隐藏所有窗口） */
function collapseToTray() {
  windowMode = 'tray';
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  if (floatWindow && !floatWindow.isDestroyed()) floatWindow.hide();
}

/** 从托盘/菜单恢复悬浮球 */
function showFloatBall() {
  windowMode = 'ball';
  if (!floatWindow || floatWindow.isDestroyed()) {
    createFloatWindow();
  } else {
    const pos = getBallPosition();
    floatWindow.setBounds({ x: pos.x, y: pos.y, width: BALL_SIZE, height: BALL_SIZE });
    floatWindow.show();
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
}

// ─── 窗口创建 ─────────────────────────────────────────────────────────────────

function createMainWindow() {
  const bounds = getMainWindowBounds();

  mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    icon: getWindowIconPath() || undefined,
    frame: false,
    transparent: true,
    resizable: true,
    thickFrame: true,
    minWidth: MAIN_MIN_WIDTH,
    minHeight: MAIN_MIN_HEIGHT,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('resize', saveMainWindowBounds);
  mainWindow.on('move', saveMainWindowBounds);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createFloatWindow() {
  const pos = getBallPosition();

  floatWindow = new BrowserWindow({
    width: BALL_SIZE,
    height: BALL_SIZE,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  floatWindow.loadFile('float.html');
  floatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  floatWindow.on('moved', () => {
    if (floatWindow && !floatWindow.isDestroyed()) {
      const [x, y] = floatWindow.getPosition();
      saveBallPosition({ x, y });
    }
  });

  floatWindow.on('closed', () => {
    floatWindow = null;
  });
}

// ─── 系统托盘 ─────────────────────────────────────────────────────────────────

function getAutoLaunchEnabled() {
  return store.get('autoLaunch', false);
}

function setAutoLaunchEnabled(enabled) {
  store.set('autoLaunch', enabled);
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: [],
  });
}

function buildTrayMenu() {
  const autoLaunch = getAutoLaunchEnabled();

  return Menu.buildFromTemplate([
    {
      label: '显示悬浮球',
      click: () => showFloatBall(),
    },
    {
      label: '展开编辑器',
      click: () => expandMainWindow(),
    },
    {
      label: '开机自启动',
      type: 'checkbox',
      checked: autoLaunch,
      click: (menuItem) => setAutoLaunchEnabled(menuItem.checked),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  // Windows 托盘在高 DPI 下用 32px 更清晰，也更不容易变成空白占位图
  tray = new Tray(getAppIcon(32));
  tray.setToolTip('Drafts');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    if (windowMode === 'expanded') return;
    showFloatBall();
  });
}

// ─── IPC ─────────────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  ipcMain.on('expand-main', () => expandMainWindow());
  ipcMain.on('minimize-to-ball', () => collapseToBall());
  ipcMain.on('close-to-tray', () => collapseToTray());
  ipcMain.on('editor-ready', () => {});

  /** 悬浮球手动拖拽（避免与点击展开冲突） */
  ipcMain.on('float-window-move', (_event, { dx, dy }) => {
    if (!floatWindow || floatWindow.isDestroyed()) return;
    const [x, y] = floatWindow.getPosition();
    floatWindow.setPosition(x + dx, y + dy);
  });

  ipcMain.handle('store-get', (_event, key) => store.get(key));
  ipcMain.handle('store-set', (_event, key, value) => {
    store.set(key, value);
    return true;
  });
  ipcMain.handle('store-get-all', () => store.store);
}

// ─── 应用生命周期 ─────────────────────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (windowMode === 'expanded') expandMainWindow();
    else showFloatBall();
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.drafts.app');
  }
  setAutoLaunchEnabled(getAutoLaunchEnabled());
  registerIpcHandlers();
  createMainWindow();
  createFloatWindow();
  createTray();

  screen.on('display-metrics-changed', () => {
    if (windowMode === 'ball' && floatWindow && !floatWindow.isDestroyed()) {
      const pos = getBallPosition();
      floatWindow.setBounds({ x: pos.x, y: pos.y, width: BALL_SIZE, height: BALL_SIZE });
    }
    if (windowMode === 'expanded' && mainWindow && !mainWindow.isDestroyed()) {
      const bounds = getMainWindowBounds();
      mainWindow.setBounds(bounds);
    }
  });
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('activate', () => {
  showFloatBall();
});
