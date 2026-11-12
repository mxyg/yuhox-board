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
const FILE = () => {
  if (process.env.YUHOX_BOARD_FILE) return process.env.YUHOX_BOARD_FILE;
  // 便携版：数据放在 exe 同目录，整个文件夹拷到别的电脑就能继续用
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'YuhoxBoardData', 'board.json');
  }
  return path.join(app.getPath('userData'), 'board.json');
};

const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_DIR;
const dataDir = () => path.dirname(FILE());
const backupDir = () => path.join(dataDir(), 'backup');

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
    { key: 'team', label: '小队', type: 'text', width: 96, visible: true },
    { key: 'well', label: '原井号', type: 'text', width: 150, visible: true },
    { key: 'job', label: '施工项目', type: 'text', width: 120, visible: true },
    { key: 'zone', label: '区域', type: 'text', width: 92, visible: true },
    { key: 'status', label: '施工进度', type: 'text', width: 232, visible: true },
    { key: 'newWell', label: '新井号', type: 'text', width: 150, visible: true },
    { key: 'newJob', label: '新施工项目', type: 'text', width: 120, visible: true },
    { key: 'newZone', label: '新区域', type: 'text', width: 92, visible: true },
    { key: 'note', label: '备注', type: 'text', width: 84, visible: true }
  ];
}

/**
 * 默认数据：金宇建安小修作业表（2026-11-12）
 * 列顺序：小队 / 原井号 / 施工项目 / 区域 / 施工进度 / 新井号 / 新施工项目 / 新区域 / 备注
 */
const DEFAULT_TABLE = [
  ['1', '杜813-34-45', '热采', '欢采', '完井', '杜813-40-33', '下泵', '欢采', '三级'],
  ['2', '锦2-丙6-A116', '堵水补层', '锦采', '下射孔管完 待校深', '锦2-7-A236', '解堵', '锦采', '三级'],
  ['3', '杜80-28-66C', '测固井质量', '1区新9', '起探砂管完', '', '', '', '二级'],
  ['4', '杜80-28-K54', '热采', '1区新5', '完井', '杜80-28-52', '热采', '1区新5', '三级'],
  ['5', '曙1-52-020', '热采', '3区46', '完井', '曙1-107-204', '热采', '1区新2', '二级'],
  ['6', '曙1-39-31', '检泵', '3区16', '下杆5根', '曙1-49-034', '下泵', '3区47', '二级'],
  ['7', '曙2-04-04', '转抽', '2区1', '下泵管完 油管压力1.2MPa', '待定', '', '', '三级'],
  ['8', '曙1-46-29CR', '检泵', '3区37', '完井', '曙1-44-046R', '下泵', '3区31', '三级'],
  ['9', '曙1-06-15', '热采', '2区34', '完井', '曙1-50-025', '下泵', '3区42', '三级'],
  ['10', '曙1-50-034', '检隔热管', '3区47', '套铣未完 H:909.90m', '', '', '', '二级'],
  ['11', '曙1-37-K40', '热采', '3区54', '起泵管80根', '曙1-35-56', '下泵', '3区36', '三级'],
  ['12', '曙2-07-015', '测压下泵', '2区6', '下机械堵水管完 待校深', '曙2-06-06', '机械堵水', '2区6', '四级'],
  ['大修1', '杜212-23-293', '重新完井', '5区89', '固井 候凝', '', '', '', '三级'],
  ['大修2', '静67-163', '解卡打捞', '沈采', '套铣 打捞', '', '', '', '三级'],
  ['大修3队', '杜813-44-56', '重新完井', '6区新3', '设备安装', '', '', '', '三级'],
  ['大修4队', '茨14-153', '重新完井', '茨采', '等搬迁', '茨9-13-3', '重新完井', '茨采', '三级'],
  ['大修5队', '茨631-2', '重新完井', '茨采', '定向钻进 起钻头未完', '', '', '', '三级'],
  ['大修6队', '杜125', '弃置井封井', '2区23', '保养设备 看井', '', '', '', '三级']
];

const DEFAULT_KEYS = ['team', 'well', 'job', 'zone', 'status', 'newWell', 'newJob', 'newZone', 'note'];

function defaultRows() {
  return DEFAULT_TABLE.map((r, i) => {
    const cells = {};
    DEFAULT_KEYS.forEach((k, j) => { if (r[j]) cells[k] = r[j]; });
    return { id: 'r' + (i + 1), cells };
  });
}

/** 默认输入历史：开箱即用的下拉候选，取自默认表里出现过的值 */
function defaultDict() {
  const uniq = (key) => {
    const i = DEFAULT_KEYS.indexOf(key);
    return Array.from(new Set(DEFAULT_TABLE.map((r) => r[i]).filter(Boolean)));
  };
  return {
    team: uniq('team'), well: uniq('well'), job: uniq('job'),
    zone: uniq('zone'), status: uniq('status'),
    newWell: uniq('newWell'), newJob: uniq('newJob'),
    newZone: uniq('newZone'), note: ['三级', '二级', '四级', '一级']
  };
}

function sampleBoard() {
  return {
    version: 2,
    title: '金宇建安小修作业',
    subtitle: '现场实时进度 · 实时更新',
    updatedAt: 0,
    columns: defaultColumns(),
    rows: defaultRows(),
    dict: defaultDict(),
    settings: {
      accent: '#4f8cff',
      accent2: '#22d3ee',
      showClock: true,
      showSummary: true,
      zebra: true,
      autoScroll: true,
      scrollSpeed: 36,          // px/s，内容溢出时的自动滚动速度
      layout: 'table',          // table(带表头的整表，默认) | list(竖向列表)
      fontScale: 1,             // 大屏字号缩放
      autoLaunch: true,         // 开机自动启动（默认开）
      autoRestoreOutput: true,  // 启动后自动回到上次上屏的那块屏
      lastDisplayId: null,      // 上次上屏的显示器
      hotkeys: true,            // 全局快捷键
      serverAuto: true,         // 随软件启动推送接口（手机遥控要用）
      mobilePin: '',            // 手机遥控页口令，空 = 不校验
      tickers: ['金宇建安 · 小修作业动态 实时同步（控制台 / 手机 / Excel）', '每日 18:00 前上报当日完井与待定井情况']
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
/** 1.x 时代的老五列，只用于迁移旧数据，保留原样不再新增 */
function legacyColumns() {
  return [
    { key: 'idx', label: '序号', type: 'index', width: 60, visible: true },
    { key: 'team', label: '施工队伍', type: 'text', width: 150, visible: true },
    { key: 'act', label: '施工动态', type: 'text', width: 290, visible: true },
    { key: 'prog', label: '施工进度', type: 'progress', width: 190, visible: true },
    { key: 'proc', label: '施工工序', type: 'text', width: 130, visible: true }
  ];
}

function migrateLegacy(parsed) {
  const columns = legacyColumns();
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
    title: parsed.title || sampleBoard().title,
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

/** 启动时留一份备份：半小时内不重复，最多留 5 份，误删误改能捞回来 */
function backupOnce(raw) {
  try {
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    const list = () => fs.readdirSync(dir)
      .filter((f) => f.startsWith('board-') && f.endsWith('.json')).sort();
    const before = list();
    if (before.length) {
      const last = path.join(dir, before[before.length - 1]);
      if (Date.now() - fs.statSync(last).mtimeMs < 30 * 60 * 1000) return;
    }
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    fs.writeFileSync(path.join(dir, `board-${stamp}.json`), raw, 'utf8');
    const after = list();
    for (const f of after.slice(0, Math.max(0, after.length - 5))) {
      try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
    }
  } catch (e) {
    console.error('[store] backup failed:', e.message);
  }
}

/** 把任意来源的看板对象规范成完整 v2 结构（读文件、导入备份都走这里） */
function fromParsed(parsed) {
  if (!isV2(parsed)) return migrateLegacy(parsed || {});
  const base = sampleBoard();
  const b = {
    version: 2,
    title: typeof parsed.title === 'string' ? parsed.title.slice(0, 60) : base.title,
    subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle.slice(0, 80) : base.subtitle,
    updatedAt: Number(parsed.updatedAt) || 0,
    columns: normalizeColumns(parsed.columns),
    rows: [],
    dict: normalizeDict(parsed.dict),
    settings: Object.assign(base.settings, parsed.settings || {})
  };
  b.rows = pruneCells(normalizeRows(parsed.rows, b.columns) || [], b.columns);
  return b;
}

function load() {
  if (board) return board;
  try {
    const raw = fs.readFileSync(FILE(), 'utf8');
    backupOnce(raw);
    const parsed = JSON.parse(raw);
    board = fromParsed(parsed);
    if (!isV2(parsed)) saveNow();   // 旧版迁移后立刻落盘
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
  'autoScroll', 'scrollSpeed', 'layout', 'tickers', 'autoLaunch',
  'autoRestoreOutput', 'lastDisplayId', 'fontScale', 'hotkeys',
  'serverAuto', 'mobilePin'
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

  // 单行局部更新：手机遥控页改一格就只发这一格，不会覆盖别处同时改的内容
  if (patch.rowPatch && patch.rowPatch.id) {
    const target = b.rows.find((r) => r.id === String(patch.rowPatch.id));
    if (target) {
      const src = patch.rowPatch.cells || {};
      for (const c of b.columns) {
        if (c.type === 'index' || !(c.key in src)) continue;
        const v = c.type === 'progress'
          ? toProgress(src[c.key])
          : String(src[c.key] == null ? '' : src[c.key]).slice(0, 200);
        if (target.cells[c.key] !== v) { target.cells[c.key] = v; changed = true; }
      }
    }
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

/** 只取设置，不复制整份数据（状态广播很频繁，别为了几个开关克隆上千行） */
function getSettings() {
  load();
  return Object.assign({}, board.settings);
}

/** 从备份 / 别处拷来的 JSON 整份替换当前看板 */
function importBoard(parsed) {
  load();
  board = fromParsed(parsed);
  board.updatedAt = Date.now();
  saveNow();
  return clone(board);
}

/** 恢复到出厂示例 / 清空数据（列结构与设置保留） */
function resetBoard(kind) {
  load();
  const base = sampleBoard();
  if (kind === 'empty') {
    base.rows = [];
    base.title = board.title;
    base.subtitle = board.subtitle;
    base.columns = board.columns;
    base.settings = Object.assign(base.settings, board.settings);
  }
  base.updatedAt = Date.now();
  board = base;
  saveNow();
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
  load, save, saveNow, getBoard, getSettings, updateBoard, replaceBoard, resetBoard,
  importBoard,
  addDict, addDictMany, sampleBoard, defaultColumns, defaultRows,
  FILE, isPortable, dataDir, backupDir
};
