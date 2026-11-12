/**
 * Yuhox Board · 主进程
 *
 * 架构（参考昱弘播控 Stage 的多屏输出思路，做了单包轻量化）：
 *   控制窗口 —— 常规窗口，落在主显示器，负责编辑与指挥；
 *   输出窗口 —— 无边框全屏窗口，可以钉到任意一台显示器上，
 *               通过 screen.getAllDisplays() 精确落位；
 *   两者之间不共享页面状态，全部经主进程广播（board:updated / status:updated）。
 *
 * 另开两条实时数据通道：本地 HTTP 推送（POST /api/board）与 JSON 文件监听。
 */
'use strict';

const {
  app, BrowserWindow, ipcMain, screen, powerSaveBlocker,
  Tray, Menu, nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const { createBoardServer } = require('./server');
const excel = require('./excel');

let controlWin = null;
let outputWin = null;
let identifyWins = [];
let tray = null;
let trayMenuTimer = null;
let quitting = false;
let closeTipShown = false;
let blacked = false;
let outputDisplayId = null;
let powerSaveId = null;
let fileWatcher = null;
let fileWatchPath = null;
let fileWatchDebounce = null;

// 被开机自启拉起时带 --hidden：只留托盘，不弹窗，不打断用户
const START_HIDDEN = process.argv.includes('--hidden');

const boardServer = createBoardServer({
  port: 7788,
  onUpdate: ({ patch, read }) => {
    if (read) return store.getBoard();
    const r = store.updateBoard(patch);
    if (r.changed) broadcastBoard();
    return r;
  },
  onLog: (m) => console.log('[server]', m)
});

const RendererBridge = (win, channels) => {
  const wc = win && win.webContents;
  if (wc && !wc.isDestroyed()) wc.send(channels.event, channels.payload);
};

function broadcastBoard() {
  const board = store.getBoard();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('board:updated', board);
  }
}

function statusPayload() {
  return {
    output: { active: !!outputWin, blacked, displayId: outputDisplayId },
    displays: listDisplays(),
    server: boardServer.status(),
    file: { watching: !!fileWatcher, path: fileWatchPath },
    autolaunch: autoLaunchState(),
    version: app.getVersion()
  };
}

function broadcastStatus() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('status:updated', statusPayload());
  }
  refreshTrayMenu();
}

/* ───────────────────────── 开机自启 ───────────────────────── */

const AUTOLAUNCH_PLATFORM = process.platform === 'win32' || process.platform === 'darwin';

/** 用户开关 + 系统真实状态一起报给界面，便于发现被系统清理掉的情况 */
function autoLaunchState() {
  const wanted = store.getBoard().settings.autoLaunch !== false;
  let os = wanted;
  if (AUTOLAUNCH_PLATFORM && app.isPackaged) {
    try { os = !!app.getLoginItemSettings().openAtLogin; } catch (_) { os = wanted; }
  }
  return {
    enabled: wanted,
    os,
    supported: AUTOLAUNCH_PLATFORM && app.isPackaged,
    platform: process.platform
  };
}

/** 把开关写进注册表（Windows Run / macOS 登录项）；开发态只记录不落系统 */
function applyAutoLaunch(enabled) {
  if (!AUTOLAUNCH_PLATFORM || !app.isPackaged) return false;
  try {
    const opts = { openAtLogin: !!enabled };
    if (process.platform === 'win32') {
      // 安装版 / 便携版都显式给路径，避免 Electron 默认指向 electron.exe
      opts.path = process.execPath;
      opts.args = ['--hidden'];
    } else {
      opts.openAsHidden = true;
    }
    app.setLoginItemSettings(opts);
    return true;
  } catch (e) {
    console.error('[autolaunch] set failed:', e.message);
    return false;
  }
}

/** 启动时对齐：用户偏好的开关与系统状态不一致就以偏好为准 */
function syncAutoLaunch() {
  const wanted = store.getBoard().settings.autoLaunch !== false;
  if (AUTOLAUNCH_PLATFORM && app.isPackaged) {
    let os = null;
    try { os = !!app.getLoginItemSettings().openAtLogin; } catch (_) {}
    if (os !== wanted) return applyAutoLaunch(wanted);
  }
  return false;
}

function setAutoLaunch(enabled) {
  const r = store.updateBoard({ settings: { autoLaunch: !!enabled } });
  if (r.changed) broadcastBoard();
  applyAutoLaunch(!!enabled);
  broadcastStatus();
  return { ...autoLaunchState(), applied: !!enabled };
}

/* ───────────────────────── 托盘 ───────────────────────── */

function trayImage() {
  const p = path.join(__dirname, '../assets/tray.png');
  let img = nativeImage.createFromPath(p);
  if (img.isEmpty()) return nativeImage.createEmpty();
  if (process.platform === 'darwin') img = img.resize({ width: 18, height: 18 });
  return img;
}

function createTray() {
  if (tray) return;
  tray = new Tray(trayImage());
  tray.setToolTip('Yuhox Board · 实时看板');
  tray.on('click', () => {
    if (controlWin && controlWin.isVisible() && !controlWin.isMinimized()) controlWin.hide();
    else showControlWindow();
  });
  tray.on('double-click', () => showControlWindow());
  buildTrayMenu();
}

/** 延后一点重建：菜单项自己的 click 里同步 setContextMenu 容易把菜单卡住 */
function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  clearTimeout(trayMenuTimer);
  trayMenuTimer = setTimeout(buildTrayMenu, 40);
}

function buildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const displays = listDisplays();
  const hasOutput = !!outputWin;

  const template = [
    { label: hasOutput ? '大屏输出中' : '未上屏', enabled: false },
    { type: 'separator' },
    { label: '显示控制台', click: () => showControlWindow() },
    {
      label: '上屏到大屏',
      submenu: displays.map((d) => ({
        label: `显示器 ${d.index + 1}　${d.size}${d.primary ? '（主屏）' : ''}`,
        type: 'radio',
        checked: hasOutput && outputDisplayId === d.id,
        click: () => { startOutput(d.id); refreshTrayMenu(); }
      })).concat([
        { type: 'separator' },
        { label: '识别显示器…', click: () => identifyDisplays() }
      ])
    },
    {
      label: blacked ? '取消黑屏（恢复画面）' : '黑屏待机',
      enabled: hasOutput,
      click: () => { setBlacked(!blacked); refreshTrayMenu(); }
    },
    {
      label: '撤下大屏',
      enabled: hasOutput,
      click: () => { stopOutput(); refreshTrayMenu(); }
    },
    { type: 'separator' },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: store.getBoard().settings.autoLaunch !== false,
      click: (item) => setAutoLaunch(item.checked)
    },
    { type: 'separator' },
    { label: '退出 Yuhox Board', click: () => { quitting = true; app.quit(); } }
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function showControlWindow() {
  if (!controlWin || controlWin.isDestroyed()) { createControlWindow(); return; }
  if (controlWin.isMinimized()) controlWin.restore();
  controlWin.show();
  controlWin.focus();
}

/* ───────────────────────── 显示器 ───────────────────────── */

function listDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    index: i,
    label: d.label || '',
    primary: d.id === primaryId,
    bounds: d.bounds,
    workArea: d.workArea,
    scaleFactor: d.scaleFactor,
    size: `${d.bounds.width}×${d.bounds.height}`
  }));
}

function findDisplay(id) {
  return screen.getAllDisplays().find((d) => d.id === id) || null;
}

/** 识别显示器：每块屏上闪一个带编号的角标，2.2 秒后自动消失 */
function identifyDisplays() {
  closeIdentify();
  const primaryId = screen.getPrimaryDisplay().id;
  identifyWins = screen.getAllDisplays().map((d, i) => {
    const w = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y,
      width: d.bounds.width, height: d.bounds.height,
      frame: false, transparent: true, resizable: false,
      skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
      focusable: false, show: false
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    const isPrimary = d.id === primaryId;
    w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
      <!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">
      <div style="position:fixed;inset:14px;border:3px dashed rgba(79,140,255,.85);border-radius:18px"></div>
      <div style="position:fixed;top:38%;left:50%;transform:translate(-50%,-50%);text-align:center;
        font:600 15px/1.7 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;color:#fff">
        <div style="font-size:56px;font-weight:800;text-shadow:0 2px 24px rgba(0,0,0,.5)">显示器 ${i + 1}${isPrimary ? '（主屏）' : ''}</div>
        <div style="opacity:.85">${d.bounds.width} × ${d.bounds.height}</div>
      </div></body></html>`));
    w.showInactive();
    return w;
  });
  setTimeout(closeIdentify, 2200);
}

function closeIdentify() {
  for (const w of identifyWins) { try { w.destroy(); } catch (_) {} }
  identifyWins = [];
}

/* ───────────────────────── 输出窗口 ───────────────────────── */

function createOutputWindow(display) {
  destroyOutput();
  outputDisplayId = display.id;   // 立刻记下目标屏，状态回报不用等 ready-to-show
  outputWin = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    show: false,
    frame: false,
    backgroundColor: '#04060d',
    fullscreen: true,
    autoHideMenuBar: true,
    skipTaskbar: true,
    title: 'Yuhox Board · 大屏输出',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      backgroundThrottling: false,   // 大屏窗口可能被遮挡，不许节流动画
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  outputWin.setMenuBarVisibility(false);
  outputWin.loadFile(path.join(__dirname, '../renderer/output/index.html'));
  outputWin.once('ready-to-show', () => {
    try {
      outputWin.setBounds(display.bounds);
      outputWin.setFullScreen(true);
      outputWin.showInactive();
      outputDisplayId = display.id;
      outputWin.webContents.send('board:updated', store.getBoard());
      broadcastStatus();
    } catch (e) { console.error('[output] show failed:', e.message); }
  });
  outputWin.on('closed', () => { outputWin = null; outputDisplayId = null; broadcastStatus(); });
}

function destroyOutput() {
  if (outputWin) {
    try { outputWin.destroy(); } catch (_) {}
    outputWin = null;
    outputDisplayId = null;
  }
}

function stopOutput() {
  destroyOutput();
  stopPowerSave();
  broadcastStatus();
}

function startPowerSave() {
  if (powerSaveId == null) {
    try { powerSaveId = powerSaveBlocker.start('prevent-display-sleep'); } catch (_) {}
  }
}

function stopPowerSave() {
  if (powerSaveId != null) {
    try { powerSaveBlocker.stop(powerSaveId); } catch (_) {}
    powerSaveId = null;
  }
}

function startOutput(displayId) {
  const display = findDisplay(displayId) || screen.getPrimaryDisplay();
  createOutputWindow(display);
  startPowerSave();
}

function setBlacked(v) {
  blacked = !!v;
  if (outputWin) outputWin.webContents.send('output:cmd', { type: 'black', value: blacked });
  broadcastStatus();
}

/* ───────────────────────── 文件监听 ───────────────────────── */

function applyFilePatch(file, silentOk) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    // 文件里允许只写 tasks 数组，也允许写完整看板对象
    const patch = Array.isArray(parsed) ? { tasks: parsed } : parsed;
    const r = store.updateBoard(patch);
    if (r.changed) broadcastBoard();
    return r.changed;
  } catch (e) {
    if (!silentOk) console.error('[file-watch] parse failed:', e.message);
    return false;
  }
}

function startFileWatch(file) {
  stopFileWatch();
  if (!file || !fs.existsSync(file)) throw new Error('文件不存在：' + file);
  fileWatchPath = file;
  let lastMtime = 0;

  const onChange = () => {
    clearTimeout(fileWatchDebounce);
    fileWatchDebounce = setTimeout(() => {
      const changed = applyFilePatch(fileWatchPath, true);
      if (changed) broadcastStatus();
    }, 300);
  };

  // 用轮询而不是 fs.watch：Windows 上编辑器保存常是「写临时文件再替换」，
  // inode 换了以后 fs.watch 就哑了；watchFile 只看 mtime/size，替换也跟得住。
  fs.watchFile(file, { interval: 500 }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) onChange();
  });
  fileWatcher = { close: () => fs.unwatchFile(file) };

  // 先立即吃一次文件内容
  applyFilePatch(file, true);
  broadcastBoard();
}

function stopFileWatch() {
  if (fileWatcher) { try { fileWatcher.close(); } catch (_) {} fileWatcher = null; }
  clearTimeout(fileWatchDebounce);
  fileWatchPath = null;
}

/* ───────────────────────── IPC ───────────────────────── */

function ipc() {
  ipcMain.handle('status:get', () => statusPayload());
  ipcMain.handle('board:get', () => store.getBoard());
  ipcMain.handle('board:set', (_e, patch) => {
    const r = store.updateBoard(patch || {});
    if (r.changed) broadcastBoard();
    return r.board;
  });
  ipcMain.handle('displays:list', () => listDisplays());
  ipcMain.handle('displays:identify', () => identifyDisplays());
  ipcMain.handle('output:start', (_e, displayId) => { startOutput(displayId); return statusPayload(); });
  ipcMain.handle('output:stop', () => { stopOutput(); return statusPayload(); });
  ipcMain.handle('output:black', (_e, v) => { setBlacked(v); return statusPayload(); });

  /* ── 开机自启 ── */
  ipcMain.handle('autolaunch:get', () => autoLaunchState());
  ipcMain.handle('autolaunch:set', (_e, v) => setAutoLaunch(!!v));

  ipcMain.handle('server:start', async (_e, port) => {
    if (Number.isFinite(port) && port > 0) boardServer.port = port;
    try { await boardServer.start(); } catch (e) { return { ...statusPayload(), error: e.message }; }
    broadcastStatus();
    return statusPayload();
  });
  ipcMain.handle('server:stop', async () => {
    await boardServer.stop();
    broadcastStatus();
    return statusPayload();
  });

  ipcMain.handle('file:watch', (_e, file) => {
    try {
      if (!file) { stopFileWatch(); broadcastStatus(); return statusPayload(); }
      startFileWatch(file);
      broadcastStatus();
      return statusPayload();
    } catch (e) {
      return { ...statusPayload(), error: e.message };
    }
  });
  ipcMain.handle('file:pick', async () => {
    const { dialog } = require('electron');
    const r = await dialog.showOpenDialog(controlWin, {
      title: '选择看板数据 JSON 文件',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('file:export', async () => {
    const { dialog } = require('electron');
    const r = await dialog.showSaveDialog(controlWin, {
      title: '导出看板数据',
      defaultPath: 'yuhox-board-data.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (r.canceled) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(store.getBoard(), null, 2), 'utf8');
    return r.filePath;
  });

  /* ── 输入历史（自动补全） ── */
  ipcMain.handle('dict:add', (_e, payload) => {
    const p = payload || {};
    return store.addDict(p.key, p.value);
  });
  ipcMain.handle('dict:merge', (_e, payload) => {
    const p = payload || {};
    return store.addDictMany(p.key, p.values || []);
  });

  /* ── Excel 导入 / 导出 ── */
  ipcMain.handle('excel:export', async () => {
    const { dialog } = require('electron');
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const r = await dialog.showSaveDialog(controlWin, {
      title: '导出 Excel',
      defaultPath: `施工动态-${stamp}.xlsx`,
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (r.canceled) return null;
    try {
      return excel.exportBoard(store.getBoard(), r.filePath);
    } catch (e) {
      return { error: e.message };
    }
  });
  ipcMain.handle('excel:import', async () => {
    const { dialog } = require('electron');
    const r = await dialog.showOpenDialog(controlWin, {
      title: '选择要导入的 Excel',
      filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile']
    });
    if (r.canceled) return null;
    try {
      const data = excel.readSheet(r.filePaths[0]);
      return Object.assign({ path: r.filePaths[0], name: path.basename(r.filePaths[0]) }, data);
    } catch (e) {
      return { error: e.message };
    }
  });
}

/* ───────────────────────── 窗口 ───────────────────────── */

function createControlWindow() {
  const primary = screen.getPrimaryDisplay();
  const wa = primary.workArea;
  controlWin = new BrowserWindow({
    x: wa.x + 24, y: wa.y + 24,
    width: Math.min(1240, wa.width - 48),
    height: Math.min(860, wa.height - 48),
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#070b14',
    title: 'Yuhox Board · 控制台',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  controlWin.setMenuBarVisibility(false);
  controlWin.loadFile(path.join(__dirname, '../renderer/control/index.html'));
  controlWin.once('ready-to-show', () => controlWin.show());

  // 点右上角 × 只是收进托盘，大屏继续推；真要退出走托盘菜单「退出」
  controlWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    controlWin.hide();
    // 每个会话只提示一次，免得每次收窗都弹
    if (!closeTipShown && tray && !tray.isDestroyed() && process.platform === 'win32') {
      closeTipShown = true;
      try { tray.displayBalloon({ title: 'Yuhox Board 仍在运行', content: '已收进托盘，大屏继续推送。' }); } catch (_) {}
    }
  });
  controlWin.on('closed', () => { controlWin = null; });
}

/* 显示器热插拔：输出窗口跟着搬家或退回主屏 */
function wireDisplayEvents() {
  screen.on('display-removed', (_e, old) => {
    if (outputWin && outputDisplayId === old.id) {
      createOutputWindow(screen.getPrimaryDisplay());
    }
    broadcastStatus();
  });
  screen.on('display-metrics-changed', () => {
    if (outputWin && outputDisplayId != null) {
      const d = findDisplay(outputDisplayId);
      if (d) { try { outputWin.setBounds(d.bounds); outputWin.setFullScreen(true); } catch (_) {} }
    }
    broadcastStatus();
  });
}

/* 开机自启 + 手动双击可能撞车，只留一个实例；第二个实例把控制台叫出来 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showControlWindow());

  app.whenReady().then(() => {
    store.load();
    ipc();
    wireDisplayEvents();
    createTray();
    syncAutoLaunch();                 // 首次运行 autoLaunch 默认 true，直接写入系统
    if (!START_HIDDEN) createControlWindow();
    app.on('activate', () => { showControlWindow(); });
  });
}

app.on('window-all-closed', () => {
  // 有托盘就常驻后台（关窗只是隐藏），真要退出由托盘菜单置 quitting
  if (quitting || !tray) {
    stopPowerSave();
    boardServer.stop();
    if (process.platform !== 'darwin') app.quit();
  }
});

app.on('before-quit', () => {
  quitting = true;
  clearTimeout(trayMenuTimer);
  stopFileWatch();
  store.saveNow();
  if (tray && !tray.isDestroyed()) { try { tray.destroy(); } catch (_) {} tray = null; }
});
