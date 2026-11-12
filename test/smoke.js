/**
 * 冒烟测试：用 Electron 真实渲染大屏与控制台页面，截图并收集控制台错误。
 * 运行：npx electron test/smoke.js
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const SAMPLE = {
  title: '项目交付进度看板',
  subtitle: 'YUHOX · 实时任务动态',
  updatedAt: Date.now(),
  tasks: [
    { id: 't1', name: '需求确认与原型评审', owner: '产品组', status: 'done', progress: 100, note: '评审通过，原型冻结' },
    { id: 't2', name: '大屏视觉设计', owner: '设计组', status: 'done', progress: 100, note: '' },
    { id: 't3', name: '数据接口联调', owner: '后端组', status: 'doing', progress: 68, note: '推送通道已通' },
    { id: 't4', name: '现场部署与调试', owner: '交付组', status: 'doing', progress: 35, note: '等待大屏进场' },
    { id: 't5', name: '验收资料整理', owner: '产品组', status: 'todo', progress: 0, note: '' },
    { id: 't6', name: '操作培训', owner: '交付组', status: 'blocked', progress: 10, note: '待排期' }
  ],
  settings: {
    accent: '#4f8cff', accent2: '#22d3ee',
    showClock: true, showSummary: true, showNote: true, autoScroll: true,
    scrollSpeed: 36, layout: 'columns',
    tickers: ['数据每 3 秒自动刷新 · 支持 HTTP 推送与文件监听', '例会：每周五 17:00']
  }
};

const errors = [];

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
  // 大屏（泳道模式）
  const out = new BrowserWindow({
    width: 1600, height: 900, show: true,
    webPreferences: { offscreen: false }
  });
  watch(out, 'output');
  await out.loadFile(path.join(__dirname, '../src/renderer/output/index.html'), { query: { preview: '1' } });
  await new Promise((r) => setTimeout(r, 1200));
  await out.webContents.executeJavaScript(`window.postMessage({ type: 'yuhox-board', board: ${JSON.stringify(SAMPLE)} }, '*')`);
  await new Promise((r) => setTimeout(r, 2600));
  await shot(out, 'screen-columns.png');

  // 大屏（榜单模式）
  await out.webContents.executeJavaScript(
    `window.postMessage({ type: 'yuhox-board', board: ${JSON.stringify({ ...SAMPLE, settings: { ...SAMPLE.settings, layout: 'list' } })} }, '*')`
  );
  await new Promise((r) => setTimeout(r, 2200));
  await shot(out, 'screen-list.png');

  // 控制台
  const ctl = new BrowserWindow({
    width: 1280, height: 860, show: true,
    webPreferences: {
      preload: path.join(__dirname, '../src/preload/index.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  watch(ctl, 'control');
  await ctl.loadFile(path.join(__dirname, '../src/renderer/control/index.html'));
  await new Promise((r) => setTimeout(r, 2400));
  await shot(ctl, 'control-smoke.png');

  const nav = await ctl.webContents.executeJavaScript(
    `document.querySelectorAll('.nav-item')[1].click(); 'ok'`
  );
  await new Promise((r) => setTimeout(r, 1200));
  await shot(ctl, 'control-content-smoke.png');

  console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
  app.exit(errors.length ? 1 : 0);
});
