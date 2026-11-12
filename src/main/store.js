/**
 * Yuhox Board · 数据存储
 *
 * 看板状态的唯一真源（main 进程持有）。控制端编辑 / HTTP 推送 / Excel 导入 /
 * 文件监听四条路都汇到这里，统一规范化后落盘、再广播。
 *
 * 数据模型 v2（可变列）：
 *   columns: [{ key, label, type, width, visible }]   type: index | text | progress
 *   rows:    [{ id, cells: { [columnKey]: value } }]
 *   dict:    { [columnKey]: [最近填过的值…] }          用于输入框自动补全
 *
 * 旧版 v1（tasks 固定字段）在读取时自动迁移，不丢数据。
 */
'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// 允许测试用独立数据文件，避免动到用户正在用的看板
const FILE = () => process.env.YUHOX_BOARD_FILE ||
  path.join(app.getPath('userData'), 'board.json');

const COLUMN_TYPES = ['index', 'text', 'progress'];
const MAX_ROWS = 3000;
const MAX_DICT = 200;

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function uid(prefix) {
  return prefix + Math.random().toString(36).slice(2, 9);
}

/* ───────────────────────── 默认结构 ───────────────────────── */

function defaultColumns() {
  return [
    { key: 'idx', label: '序号', type: 'index', width: 60, visible: true },
    { key: 'team', label: '施工队伍', type: 'text', width: 150, visible: true },
    { key: 'act', label: '施工动态', type: 'text', width: 290, visible: true },
    { key: 'prog', label: '施工进度', type: 'progress', width: 190, visible: true },
    { key: 'proc', label: '施工工序', type: 'text', width: 130, visible: true }
  ];
}

function defaultRows() {
  return [
    { id: 'r1', cells: { team: '一号施工队', act: '三层顶板钢筋绑扎', prog: 72, proc: '钢筋工程' } },
    { id: 'r2', cells: { team: '二号施工队', act: '地下室剪力墙模板安装', prog: 55, proc: '模板工程' } },
    { id: 'r3', cells: { team: '机电班', act: '一层桥架敷设与穿线', prog: 38, proc: '机电安装' } },
    { id: 'r4', cells: { team: '三号施工队', act: '二层梁板混凝土浇筑', prog: 100, proc: '混凝土工程' } },
    { id: 'r5', cells: { team: '防水班', act: '屋面防水卷材铺贴', prog: 20, proc: '防水工程' } },
    { id: 'r6', cells: { team: '四号施工队', act: '外脚手架搭设与验收', prog: 88, proc: '脚手架工程' } },
    { id: 'r7', cells: { team: '机电班', act: '消防管道压力试验', prog: 0, proc: '消防工程' } },
    { id: 'r8', cells: { team: '二号施工队', act: '四层砌体工程样板段', prog: 46, proc: '砌体工程' } }
  ];
}

function sampleBoard() {
  return {
    version: 2,
    title: '施工动态总览',
    subtitle: 'YUHOX · 现场实时进度',
    updatedAt: 0,
    columns: defaultColumns(),
    rows: defaultRows(),
    dict: {},
    settings: {
      accent: '#4f8cff',
      accent2: '#22d3ee',
      showClock: true,
      showSummary: true,
      zebra: true,
      autoScroll: true,
      scrollSpeed: 36,          // px/s，内容溢出时的自动滚动速度
      layout: 'table',          // table(施工数据表) | list(进度榜单)
      autoLaunch: true,         // 开机自动启动（默认开）
      tickers: ['数据实时同步 · 支持控制台编辑 / HTTP 推送 / Excel 导入']
    }
  };
}

/* ───────────────────────── 规范化 ───────────────────────── */

function normalizeColumns(cols) {
  if (!Array.isArray(cols) || !cols.length) return defaultColumns();
  const seen = new Set();
  const out = [];
  for (const c of cols) {
    if (!c || typeof c !== 'object') continue;
    let key = String(c.key || '').trim() || uid('c');
    while (seen.has(key)) key = uid('c');
    seen.add(key);

    const type = COLUMN_TYPES.includes(c.type) ? c.type : 'text';
    const label = String(c.label == null ? '' : c.label).trim().slice(0, 20) || '未命名列';
    let width = Number(c.width);
    if (!Number.isFinite(width)) width = type === 'index' ? 80 : type === 'progress' ? 300 : 220;
    width = Math.max(60, Math.min(900, Math.round(width)));

    out.push({ key, label, type, width, visible: c.visible !== false });
  }
  return out.length ? out : defaultColumns();
}

function toProgress(v) {
  const n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * 行规范化。允许两种写法：
 *   { id, cells: { team: '一班' } }
 *   { id, team: '一班' }            （HTTP 推送时更顺手，扁平结构自动收进 cells）
 */
function normalizeRows(rows, columns) {
  if (!Array.isArray(rows)) return null;
  const seen = new Set();
  const out = [];

  for (const r of rows) {
    if (out.length >= MAX_ROWS) break;
    if (!r || typeof r !== 'object') continue;

    let id = String(r.id || '').trim();
    while (!id || seen.has(id)) id = uid('r');
    seen.add(id);

    const src = r.cells && typeof r.cells === 'object' ? r.cells : r;
    const cells = {};
    for (const c of columns) {
      if (c.type === 'index') continue;
      const raw = src[c.key];
      if (c.type === 'progress') {
        cells[c.key] = toProgress(raw);
      } else {
        cells[c.key] = String(raw == null ? '' : raw).slice(0, 200);
      }
    }
    out.push({ id, cells });
  }
  return out;
}

/** 列被删掉后，把行里多余的单元格清掉 */
function pruneCells(rows, columns) {
  const keys = new Set(columns.map((c) => c.key));
  return rows.map((r) => {
    const cells = {};
    for (const k of Object.keys(r.cells || {})) {
      if (keys.has(k)) cells[k] = r.cells[k];
    }
    return { id: r.id, cells };
  });
}

function normalizeDict(dict) {
  if (!dict || typeof dict !== 'object') return {};
  const out = {};
  for (const k of Object.keys(dict)) {
    const arr = Array.isArray(dict[k]) ? dict[k] : [];
    const vals = arr
      .map((v) => String(v == null ? '' : v).trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, MAX_DICT);
    if (vals.length) out[k] = [...new Set(vals)];
  }
  return out;
}

/** v1 → v2 迁移：旧任务字段映射成默认五列 */
function migrateLegacy(parsed) {
  const columns = defaultColumns();
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const rows = tasks.map((t, i) => ({
    id: String(t.id || ('r' + (i + 1))),
    cells: {
      team: String(t.owner || ''),
      act: String(t.name || ''),
      prog: toProgress(t.progress),
      proc: String(t.note || '')
    }
  }));
  const settings = Object.assign(sampleBoard().settings, parsed.settings || {});
  if (settings.layout === 'columns') settings.layout = 'table';
  return {
    version: 2,
    title: parsed.title || '施工动态总览',
    subtitle: parsed.subtitle || '',
    updatedAt: parsed.updatedAt || 0,
    columns,
    rows,
    dict: {},
    settings
  };
}

function isV2(obj) {
  return !!obj && Array.isArray(obj.columns) && Array.isArray(obj.rows);
}

/* ───────────────────────── 读 / 写 ───────────────────────── */

let board = null;
let saveTimer = null;

function load() {
  if (board) return board;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    if (isV2(parsed)) {
      const base = sampleBoard();
      board = {
        version: 2,
        title: typeof parsed.title === 'string' ? parsed.title.slice(0, 60) : base.title,
        subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle.slice(0, 80) : base.subtitle,
        updatedAt: Number(parsed.updatedAt) || 0,
        columns: normalizeColumns(parsed.columns),
        rows: [],
        dict: normalizeDict(parsed.dict),
        settings: Object.assign(base.settings, parsed.settings || {})
      };
      board.rows = pruneCells(normalizeRows(parsed.rows, board.columns) || [], board.columns);
    } else {
      board = migrateLegacy(parsed || {});
      saveNow();
    }
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
  saveTimer = setTimeout(saveNow, 350);
}

/* ───────────────────────── 更新 ───────────────────────── */

const SETTING_KEYS = [
  'accent', 'accent2', 'showClock', 'showSummary', 'zebra',
  'autoScroll', 'scrollSpeed', 'layout', 'tickers', 'autoLaunch'
];

/**
 * 合并更新。允许的顶层键：
 *   title / subtitle / columns / rows / settings
 *   dictAdd: { key, value }         记一条历史值
 *   dictMerge: { key, values: [] }  批量记（Excel 导入后用）
 */
function updateBoard(patch) {
  load();
  const b = board;
  let changed = false;

  if (typeof patch.title === 'string' && patch.title !== b.title) {
    b.title = patch.title.slice(0, 60); changed = true;
  }
  if (typeof patch.subtitle === 'string' && patch.subtitle !== b.subtitle) {
    b.subtitle = patch.subtitle.slice(0, 80); changed = true;
  }

  // 列：变了就重建，并按新列裁剪行数据
  if (Array.isArray(patch.columns)) {
    const cols = normalizeColumns(patch.columns);
    if (JSON.stringify(cols) !== JSON.stringify(b.columns)) {
      b.columns = cols;
      b.rows = pruneCells(b.rows, cols);
      changed = true;
    }
  }

  const rows = normalizeRows(patch.rows, b.columns);
  if (rows) {
    rows.forEach((r) => { r.cells = r.cells; });
    if (JSON.stringify(rows) !== JSON.stringify(b.rows)) { b.rows = rows; changed = true; }
  }

  if (patch.settings && typeof patch.settings === 'object') {
    for (const k of SETTING_KEYS) {
      if (k in patch.settings && JSON.stringify(patch.settings[k]) !== JSON.stringify(b.settings[k])) {
        b.settings[k] = patch.settings[k];
        changed = true;
      }
    }
  }

  let dictChanged = false;
  if (patch.dict && typeof patch.dict === 'object' && !Array.isArray(patch.dict)) {
    for (const k of Object.keys(patch.dict)) {
      if (addDictInner(k, patch.dict[k] || [])) dictChanged = true;
    }
  }
  if (patch.dictAdd && patch.dictAdd.key) {
    dictChanged = addDictInner(patch.dictAdd.key, [patch.dictAdd.value]) || dictChanged;
  }
  if (patch.dictMerge && patch.dictMerge.key) {
    dictChanged = addDictInner(patch.dictMerge.key, patch.dictMerge.values || []) || dictChanged;
  }

  if (changed) {
    b.updatedAt = Date.now();
    save();
  } else if (dictChanged) {
    save();
  }
  return { board: clone(b), changed };
}

function addDictInner(key, values) {
  load();
  const k = String(key || '').trim();
  if (!k) return false;
  const list = board.dict[k] || [];
  const before = list.length;
  const incoming = (Array.isArray(values) ? values : [values])
    .map((v) => String(v == null ? '' : v).trim().slice(0, 200))
    .filter(Boolean);
  if (!incoming.length) return false;

  let next = list;
  for (const v of incoming) {
    next = [v, ...next.filter((x) => x !== v)];
  }
  next = next.slice(0, MAX_DICT);
  if (next.length === before && next.every((v, i) => v === list[i])) return false;
  board.dict[k] = next;
  return true;
}

/** 只记历史值：不广播看板（避免打断正在输入的光标） */
function addDict(key, value) {
  const ok = addDictInner(key, [value]);
  if (ok) save();
  return ok;
}

function addDictMany(key, values) {
  const ok = addDictInner(key, values);
  if (ok) save();
  return ok;
}

function getBoard() {
  load();
  return clone(board);
}

function replaceBoard(next) {
  load();
  return updateBoard(next);
}

function exportPath() {
  return FILE();
}

module.exports = {
  load, save, saveNow, getBoard, updateBoard, replaceBoard,
  addDict, addDictMany, sampleBoard, defaultColumns, defaultRows, FILE
};
