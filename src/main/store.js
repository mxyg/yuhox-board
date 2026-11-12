/**
 * Yuhox Board · 数据存储
 * 看板状态的唯一真源（main 进程持有），控制端 / 大屏端 / HTTP 推送 / 文件监听
 * 四条路都汇到这里，再统一广播。
 */
'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE = () => path.join(app.getPath('userData'), 'board.json');

/** 首次启动的示例看板 */
function sampleBoard() {
  return {
    title: '项目交付进度看板',
    subtitle: 'YUHOX · 实时任务动态',
    updatedAt: 0,
    tasks: [
      { id: 't1', name: '需求确认与原型评审', owner: '产品组', status: 'done', progress: 100, note: '评审通过，原型冻结' },
      { id: 't2', name: '大屏视觉设计', owner: '设计组', status: 'done', progress: 100, note: '' },
      { id: 't3', name: '数据接口联调', owner: '后端组', status: 'doing', progress: 68, note: '推送通道已通' },
      { id: 't4', name: '现场部署与调试', owner: '交付组', status: 'doing', progress: 35, note: '等待大屏进场' },
      { id: 't5', name: '验收资料整理', owner: '产品组', status: 'todo', progress: 0, note: '' },
      { id: 't6', name: '操作培训', owner: '交付组', status: 'todo', progress: 0, note: '暂定下周' }
    ],
    settings: {
      accent: '#4f8cff',
      accent2: '#22d3ee',
      showClock: true,
      showSummary: true,
      showNote: true,
      autoScroll: true,
      scrollSpeed: 36,          // px/s，过大屏内容溢出时的自动滚动速度
      layout: 'columns',        // columns(泳道) | list(进度条榜)
      tickers: ['数据每 3 秒自动刷新 · 支持 HTTP 推送与文件监听']
    }
  };
}

let board = null;
let saveTimer = null;

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function load() {
  if (board) return board;
  try {
    const raw = fs.readFileSync(FILE(), 'utf8');
    const parsed = JSON.parse(raw);
    board = Object.assign(sampleBoard(), parsed);
    board.settings = Object.assign(sampleBoard().settings, parsed.settings || {});
  } catch (e) {
    board = sampleBoard();
    saveNow();
  }
  return board;
}

function saveNow() {
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify(board, null, 2), 'utf8');
  } catch (e) {
    console.error('[store] save failed:', e.message);
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

/** 规范化任务列表 */
function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) return null;
  const seen = new Set();
  const out = [];
  for (const t of tasks) {
    if (!t || typeof t !== 'object' || !t.name) continue;
    let id = String(t.id || '').trim();
    while (!id || seen.has(id)) id = 't' + Math.random().toString(36).slice(2, 9);
    seen.add(id);
    const status = ['todo', 'doing', 'done', 'blocked'].includes(t.status) ? t.status : 'todo';
    let p = Number(t.progress);
    if (!Number.isFinite(p)) p = status === 'done' ? 100 : 0;
    p = Math.max(0, Math.min(100, Math.round(p)));
    out.push({
      id,
      name: String(t.name).slice(0, 80),
      owner: String(t.owner || '').slice(0, 30),
      status,
      progress: p,
      note: String(t.note || '').slice(0, 120)
    });
  }
  return out;
}

/**
 * 合并更新（控制端编辑、HTTP 推送、文件监听共用同一套规则）
 * 允许的顶层键：title / subtitle / tasks / settings / tickers
 */
function updateBoard(patch) {
  load();
  const b = board;
  let changed = false;

  if (typeof patch.title === 'string' && patch.title !== b.title) { b.title = patch.title.slice(0, 60); changed = true; }
  if (typeof patch.subtitle === 'string' && patch.subtitle !== b.subtitle) { b.subtitle = patch.subtitle.slice(0, 80); changed = true; }

  const tasks = normalizeTasks(patch.tasks);
  if (tasks) {
    if (JSON.stringify(tasks) !== JSON.stringify(b.tasks)) { b.tasks = tasks; changed = true; }
  }

  if (patch.settings && typeof patch.settings === 'object') {
    const allowed = ['accent', 'accent2', 'showClock', 'showSummary', 'showNote', 'autoScroll', 'scrollSpeed', 'layout', 'tickers'];
    for (const k of allowed) {
      if (k in patch.settings && JSON.stringify(patch.settings[k]) !== JSON.stringify(b.settings[k])) {
        b.settings[k] = patch.settings[k];
        changed = true;
      }
    }
  }

  if (changed) {
    b.updatedAt = Date.now();
    save();
  }
  return { board: clone(b), changed };
}

function getBoard() {
  load();
  return clone(board);
}

function exportPath() {
  return FILE();
}

module.exports = { load, save, saveNow, getBoard, updateBoard, sampleBoard, FILE };
