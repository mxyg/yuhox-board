/**
 * 冒烟测试：用 Electron 真实渲染大屏与控制台页面，截图并收集控制台错误。
 * 运行：npx electron test/smoke.js
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

/* 默认数据直接取主进程 store 的示例，保证截图和软件开箱一致 */
const SAMPLE = require('../src/main/store').sampleBoard();

const errors = [];

/* 冒烟测试只加载渲染进程，这里补一套最小 IPC，让控制台拿到真数据 */
let localBoard = JSON.parse(JSON.stringify(SAMPLE));
ipcMain.handle('board:get', () => localBoard);
ipcMain.handle('board:set', (_e, patch) => {
  localBoard = Object.assign({}, localBoard, patch, { updatedAt: Date.now() });
  return localBoard;
});
ipcMain.handle('dict:add', () => true);
ipcMain.handle('dict:merge', () => true);
ipcMain.handle('status:get', () => ({
  output: { active: false, blacked: false, displayId: null },
  displays: [{
    id: 1, index: 0, label: 'Built-in', primary: true,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    scaleFactor: 2, size: '1920×1080'
  }],
  server: { running: true, port: 7788 },
  file: { watching: false, path: null },
  autolaunch: { enabled: true, os: true, supported: true, platform: process.platform },
  data: { file: '/Users/demo/Library/Application Support/yuhox-board/board.json', dir: '/Users/demo/Library/Application Support/yuhox-board', backupDir: '/Users/demo/Library/Application Support/yuhox-board/backup', portable: false },
  lan: ['192.168.1.23'],
  mobile: { pinRequired: false },
  hotkeys: {
    enabled: true,
    active: [
      { accel: 'CommandOrControl+Alt+B', label: 'Ctrl + Alt + B' },
      { accel: 'CommandOrControl+Alt+H', label: 'Ctrl + Alt + H' },
      { accel: 'CommandOrControl+Alt+S', label: 'Ctrl + Alt + S' }
    ]
  },
  version: '1.3.0'
}));

function watch(win, tag) {
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(`[${tag}] ${message}`);
    console.log(`[${tag}] ${message}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => errors.push(`[${tag}] renderer gone: ${JSON.stringify(d)}`));
}

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  const dir = path.join(__dirname, '../docs/images');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), img.toPNG());
  console.log('saved', name);
}

app.whenReady().then(async () => {
  const out = new BrowserWindow({
    width: 1600, height: 900, show: true,
    webPreferences: { offscreen: false, backgroundThrottling: false }
  });
  watch(out, 'output');
  await out.loadFile(path.join(__dirname, '../src/renderer/output/index.html'), { query: { preview: '1' } });
  await new Promise((r) => setTimeout(r, 1200));
  const TAB = { ...SAMPLE, settings: { ...SAMPLE.settings, layout: 'table' } };
  await out.webContents.executeJavaScript(`window.postMessage({ type: 'yuhox-board', board: ${JSON.stringify(TAB)} }, '*')`);
  await new Promise((r) => setTimeout(r, 2600));
  await shot(out, 'screen-table.png');

  // 默认卡片版式（推荐画面）
  await out.webContents.executeJavaScript(
    `window.postMessage({ type: 'yuhox-board', board: ${JSON.stringify(SAMPLE)} }, '*')`
  );
  await new Promise((r) => setTimeout(r, 2400));
  await shot(out, 'screen-list.png');

  // 很长内容（验证多列挤压与自动滚动）
  const custom = {
    ...SAMPLE,
    rows: SAMPLE.rows.concat(SAMPLE.rows.map((r, i) => ({
      id: 'x' + i,
      cells: {
        ...r.cells,
        status: (r.cells.status || '') + '（含下泵、洗井、试压，资料待交接）',
        note: '四级'
      }
    }))),
    settings: { ...SAMPLE.settings, layout: 'table', scrollSpeed: 46 }
  };
  await out.webContents.executeJavaScript(
    `window.postMessage({ type: 'yuhox-board', board: ${JSON.stringify(custom)} }, '*')`
  );
  await new Promise((r) => setTimeout(r, 3800));
  await shot(out, 'screen-scroll.png');

  // 控制台
  const ctl = new BrowserWindow({
    width: 1360, height: 900, show: true,
    webPreferences: {
      preload: path.join(__dirname, '../src/preload/index.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
    }
  });
  watch(ctl, 'control');
  await ctl.loadFile(path.join(__dirname, '../src/renderer/control/index.html'));
  await new Promise((r) => setTimeout(r, 2200));
  await shot(ctl, 'control-smoke.png');

  await ctl.webContents.executeJavaScript(`document.querySelectorAll('.nav-item')[1].click(); 'ok'`);
  await new Promise((r) => setTimeout(r, 1000));
  await shot(ctl, 'control-content-smoke.png');

  await ctl.webContents.executeJavaScript(`document.querySelector('#btnCols').click(); 'ok'`);
  await new Promise((r) => setTimeout(r, 900));
  await ctl.webContents.executeJavaScript(`document.querySelector('.panels').scrollTop = 99999; 'ok'`);
  await new Promise((r) => setTimeout(r, 400));
  await shot(ctl, 'control-columns-smoke.png');

  console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
  app.exit(errors.length ? 1 : 0);
});
