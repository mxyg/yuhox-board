/**
 * 冒烟测试：用 Electron 真实渲染大屏与控制台页面，截图并收集控制台错误。
 * 运行：npx electron test/smoke.js
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const COLUMNS = [
  { key: 'idx', label: '序号', type: 'index', width: 60, visible: true },
  { key: 'team', label: '施工队伍', type: 'text', width: 150, visible: true },
  { key: 'act', label: '施工动态', type: 'text', width: 290, visible: true },
  { key: 'prog', label: '施工进度', type: 'progress', width: 190, visible: true },
  { key: 'proc', label: '施工工序', type: 'text', width: 130, visible: true }
];

const RAW = [
  ['一号施工队', '三层顶板钢筋绑扎', 72, '钢筋工程'],
  ['二号施工队', '地下室剪力墙模板安装', 55, '模板工程'],
  ['机电班', '一层桥架敷设与穿线', 38, '机电安装'],
  ['三号施工队', '二层梁板混凝土浇筑', 100, '混凝土工程'],
  ['防水班', '屋面防水卷材铺贴', 20, '防水工程'],
  ['四号施工队', '外脚手架搭设与验收', 88, '脚手架工程'],
  ['机电班', '消防管道压力试验', 0, '消防工程'],
  ['二号施工队', '四层砌体工程样板段', 46, '砌体工程']
];

const SAMPLE = {
  version: 2,
  title: '施工动态总览',
  subtitle: 'YUHOX · 现场实时进度',
  columns: COLUMNS,
  rows: RAW.map((r, i) => ({
    id: 'r' + (i + 1),
    cells: { team: r[0], act: r[1], prog: r[2], proc: r[3] }
  })),
  dict: {
    team: ['一号施工队', '二号施工队', '三号施工队', '四号施工队', '机电班', '防水班'],
    act: ['三层顶板钢筋绑扎', '地下室剪力墙模板安装', '一层桥架敷设与穿线'],
    proc: ['钢筋工程', '模板工程', '机电安装', '混凝土工程']
  },
  settings: {
    accent: '#4f8cff', accent2: '#22d3ee',
    showClock: true, showSummary: true, zebra: true, autoScroll: true,
    scrollSpeed: 36, layout: 'table',
    tickers: ['数据实时同步 · 控制台编辑 / HTTP 推送 / Excel 导入', '今日 17:00 现场安全例会']
  }
};

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
  server: { running: false, port: 7788 },
  file: { watching: false, path: null },
  version: '1.1.0'
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
  await out.webContents.executeJavaScript(`window.postMessage({ type: 'yuhox-board', board: ${JSON.stringify(SAMPLE)} }, '*')`);
  await new Promise((r) => setTimeout(r, 2600));
  await shot(out, 'screen-table.png');

  // 榜单模式
  await out.webContents.executeJavaScript(
    `window.postMessage({ type: 'yuhox-board', board: ${JSON.stringify({ ...SAMPLE, settings: { ...SAMPLE.settings, layout: 'list' } })} }, '*')`
  );
  await new Promise((r) => setTimeout(r, 2200));
  await shot(out, 'screen-list.png');

  // 很长内容 + 自定义列（验证滚动与列宽比例）
  const custom = {
    ...SAMPLE,
    columns: [
      { key: 'idx', label: '序号', type: 'index', width: 60, visible: true },
      { key: 'team', label: '施工队伍', type: 'text', width: 130, visible: true },
      { key: 'act', label: '施工动态', type: 'text', width: 320, visible: true },
      { key: 'prog', label: '施工进度', type: 'progress', width: 170, visible: true },
      { key: 'proc', label: '施工工序', type: 'text', width: 120, visible: true },
      { key: 'zone', label: '作业区域', type: 'text', width: 120, visible: true }
    ],
    rows: SAMPLE.rows.concat(SAMPLE.rows.map((r, i) => ({
      id: 'x' + i,
      cells: { ...r.cells, act: r.cells.act + '（跨区协同作业，含材料转运与成品保护）', zone: 'A 区' }
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
