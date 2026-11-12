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
  Tray, Menu, nativeImage, globalShortcut, shell, clipboard
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
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
// 任务栏跳转列表「直接上屏」：即使带 --hidden 也把上次的大屏拉起来
const FORCE_OUTPUT = process.argv.includes('--output');

const boardServer = createBoardServer({
  port: 7788,
  pagePath: path.join(__dirname, 'mobile.html'),
  getPin: () => (store.getBoard().settings.mobilePin || ''),
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

/** 本机局域网 IPv4，手机遥控页要用 */
function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function statusPayload() {
  const s = store.getSettings();
  return {
    output: { active: !!outputWin, blacked, displayId: outputDisplayId },
    displays: listDisplays(),
    server: boardServer.status(),
    file: { watching: !!fileWatcher, path: fileWatchPath },
    autolaunch: autoLaunchState(),
    data: {
      file: store.FILE(),
      dir: store.dataDir(),
      backupDir: store.backupDir(),
      portable: store.isPortable()
    },
    lan: lanAddresses(),
    mobile: { pinRequired: !!s.mobilePin },
    hotkeys: {
      enabled: s.hotkeys !== false,
      active: hotkeyActive.map((a) => ({ accel: a, label: HOTKEY_LABELS[a] || a }))
    },
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
  const wanted = store.getSettings().autoLaunch !== false;
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

/** 便携版要指向用户双击的那个 exe：process.execPath 是解包后的临时副本，重启就没了 */
function launchTarget() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

/** 把开关写进注册表（Windows Run / macOS 登录项）；开发态只记录不落系统 */
function applyAutoLaunch(enabled) {
  if (!AUTOLAUNCH_PLATFORM || !app.isPackaged) return false;
  try {
    const opts = { openAtLogin: !!enabled };
    if (process.platform === 'win32') {
      // 安装版 / 便携版都显式给路径，避免 Electron 默认指向 electron.exe
      opts.path = launchTarget();
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
  const wanted = store.getSettings().autoLaunch !== false;
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

/* ───────────────────────── 全局快捷键 ───────────────────────── */

const HOTKEY_DEFS = [
  { accel: 'CommandOrControl+Alt+B', label: '黑屏 / 取消黑屏', action: 'black' },
  { accel: 'CommandOrControl+Alt+H', label: '显示 / 收起控制台', action: 'control' },
  { accel: 'CommandOrControl+Alt+S', label: '上屏 / 撤下大屏', action: 'output' }
];
const HOTKEY_LABELS = {
  'CommandOrControl+Alt+B': 'Ctrl + Alt + B',
  'CommandOrControl+Alt+H': 'Ctrl + Alt + H',
  'CommandOrControl+Alt+S': 'Ctrl + Alt + S'
};

let hotkeyActive = [];

/** 优先用上次那块屏；没有就用副屏，只有一个屏就用主屏 */
function preferredDisplayId() {
  const s = store.getSettings();
  if (s.lastDisplayId != null && findDisplay(s.lastDisplayId)) return s.lastDisplayId;
  const primary = screen.getPrimaryDisplay();
  const other = screen.getAllDisplays().find((d) => d.id !== primary.id);
  return (other || primary).id;
}

function applyHotkeys(enabled) {
  try { globalShortcut.unregisterAll(); } catch (_) {}
  hotkeyActive = [];
  if (!enabled) return;
  const acts = {
    black: () => { if (outputWin) setBlacked(!blacked); },
    control: () => {
      if (controlWin && controlWin.isVisible() && !controlWin.isMinimized()) controlWin.hide();
      else showControlWindow();
    },
    output: () => {
      if (outputWin) stopOutput();
      else startOutput(preferredDisplayId());
    }
  };
  for (const d of HOTKEY_DEFS) {
    try {
      if (globalShortcut.register(d.accel, acts[d.action])) hotkeyActive.push(d.accel);
    } catch (_) { /* 被别的软件占了就跳过 */ }
  }
}

/** 启动时回到上次的大屏（开机自启也生效，现场开机即出画面） */
function restoreOutput() {
  if (outputWin) return false;            // 用户已经手动上屏了，别抢
  const s = store.getSettings();
  if (s.autoRestoreOutput === false && !FORCE_OUTPUT) return false;
  if (s.lastDisplayId == null) return false;
  const d = findDisplay(s.lastDisplayId);
  if (!d) return false;
  startOutput(d.id);
  return true;
}

/** Windows 任务栏右键菜单 */
function applyJumpList() {
  if (process.platform !== 'win32') return;
  try {
    app.setAppUserModelId('com.yuhox.board');
    app.setUserTasks([
      {
        program: launchTarget(), arguments: '', title: '显示控制台',
        description: '打开 Yuhox Board 控制台', iconPath: launchTarget(), iconIndex: 0
      },
      {
        program: launchTarget(), arguments: '--hidden --output', title: '直接上屏',
        description: '后台启动并推送到上次的大屏', iconPath: launchTarget(), iconIndex: 0
      },
      {
        program: launchTarget(), arguments: '--hidden', title: '仅托盘待命',
        description: '不弹窗，只留右下角托盘', iconPath: launchTarget(), iconIndex: 0
      }
    ]);
  } catch (e) {
    console.error('[jumplist]', e.message);
  }
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

/** 手机遥控页地址（取第一个局域网 IP） */
function mobileUrl() {
  const ip = lanAddresses()[0] || '127.0.0.1';
  return `http://${ip}:${boardServer.port}/m`;
}

function buildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const displays = listDisplays();
  const hasOutput = !!outputWin;
  const srv = boardServer.status();
  const mUrl = mobileUrl();

  const template = [
    { label: hasOutput ? '大屏输出中' : '未上屏', enabled: false },
    { type: 'separator' },
    { label: '显示控制台', click: () => showControlWindow() },
    {
      label: '手机遥控',
      enabled: srv.running,
      submenu: [
        { label: mUrl, click: () => shell.openExternal(mUrl) },
        { label: '复制地址', click: () => { clipboard.writeText(mUrl); } },
        { type: 'separator' },
        { label: '打开数据目录', click: () => { shell.openPath(store.dataDir()); } }
      ]
    },
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
  tray.setToolTip('Yuhox Board · ' + (hasOutput ? (blacked ? '黑屏待机' : '大屏输出中') : '未上屏'));
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
  // 记住这块屏，下次启动 / 快捷键可以直接回到这里
  try { store.updateBoard({ settings: { lastDisplayId: display.id } }); } catch (_) {}
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

  /* ── 偏好（影响主进程行为，不只是画面） ── */
  ipcMain.handle('prefs:set', (_e, p) => {
    const patch = { settings: {} };
    const src = p || {};
    if ('hotkeys' in src) patch.settings.hotkeys = !!src.hotkeys;
    if ('autoRestoreOutput' in src) patch.settings.autoRestoreOutput = !!src.autoRestoreOutput;
    if ('serverAuto' in src) patch.settings.serverAuto = !!src.serverAuto;
    const r = store.updateBoard(patch);
    if (r.changed) broadcastBoard();
    if ('hotkeys' in src) applyHotkeys(!!src.hotkeys);
    if ('serverAuto' in src) {
      if (src.serverAuto) boardServer.start().catch((e) => console.error('[server]', e.message));
      else boardServer.stop();
    }
    broadcastStatus();
    return statusPayload();
  });

  /* ── 打开外部链接（手机遥控地址） ── */
  ipcMain.handle('app:openUrl', (_e, url) => {
    if (!/^https?:\/\//i.test(String(url || ''))) return false;
    shell.openExternal(String(url));
    return true;
  });

  /* ── 数据文件 ── */
  ipcMain.handle('data:open', async () => {
    const dir = store.dataDir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    return shell.openPath(dir);
  });
  ipcMain.handle('data:reset', (_e, kind) => {
    const b = store.resetBoard(kind === 'empty' ? 'empty' : 'sample');
    broadcastBoard();
    broadcastStatus();
    return b;
  });
  ipcMain.handle('data:import', async () => {
    const { dialog } = require('electron');
    const r = await dialog.showOpenDialog(controlWin, {
      title: '导入看板 JSON（覆盖当前数据）',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (r.canceled) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
      const b = store.importBoard(Array.isArray(parsed) ? { rows: parsed } : parsed);
      broadcastBoard();
      broadcastStatus();
      return { path: r.filePaths[0], name: path.basename(r.filePaths[0]), board: b };
    } catch (e) {
      return { error: e.message };
    }
  });

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
    applyJumpList();
    syncAutoLaunch();                 // 首次运行 autoLaunch 默认 true，直接写入系统
    applyHotkeys(store.getSettings().hotkeys !== false);
    // 推送接口默认随软件启动，手机遥控页才打得开
    if (store.getSettings().serverAuto !== false) {
      boardServer.start().catch((e) => console.error('[server] autostart failed:', e.message));
    }
    if (!START_HIDDEN) createControlWindow();
    // 等窗口和显示器信息就绪再回到上次的大屏
    setTimeout(restoreOutput, 700);
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
  try { globalShortcut.unregisterAll(); } catch (_) {}
  stopFileWatch();
  store.saveNow();
  if (tray && !tray.isDestroyed()) { try { tray.destroy(); } catch (_) {} tray = null; }
});
