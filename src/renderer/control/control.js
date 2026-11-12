/**
 * Yuhox Board · 控制台逻辑
 *
 * 数据表编辑器：列可增删改、可拖拽排序、可拖右边缘调宽；
 * 行可拖拽排序；输入框自动匹配历史内容（dict）；Excel 导入按表头自动映射列。
 * 所有改动经主进程规范化后广播，大屏与预览同步刷新。
 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let board = null;
let status = null;
let selectedDisplayId = null;
let selfPushAt = 0;        // 自己刚推过去的 updatedAt，避免回声重绘打断输入
let lastLocalAt = 0;
let toastTimer = null;
let pendingSync = false;

/* ───────── 小工具 ───────── */

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function uid(p) {
  return p + Math.random().toString(36).slice(2, 9);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function pushBoard(patch) {
  lastLocalAt = Date.now();
  const r = await window.yuhox.setBoard(patch);
  selfPushAt = r.updatedAt;
  board = r;
  forwardToPreview(r);
  return r;
}

function forwardToPreview(boardData) {
  const frame = $('#previewFrame');
  if (frame && frame.contentWindow) {
    frame.contentWindow.postMessage({ type: 'yuhox-board', board: boardData }, '*');
  }
}

$('#previewFrame').addEventListener('load', () => {
  if (board) forwardToPreview(board);
});

/* ───────── 导航 ───────── */

const PANEL_TITLES = {
  displays: '上屏控制',
  content: '数据表',
  data: '实时数据源',
  look: '外观与动效'
};

$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (!btn) return;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b === btn));
  const key = btn.dataset.panel;
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + key));
  $('#panelTitle').textContent = PANEL_TITLES[key] || '';
});

/* ───────── 显示器 ───────── */

function renderDisplays() {
  const grid = $('#displayGrid');
  grid.innerHTML = '';
  const displays = (status && status.displays) || [];
  if (!selectedDisplayId && displays.length) {
    const cand = displays.find((d) => !d.primary) || displays[0];
    selectedDisplayId = cand.id;
  }
  displays.forEach((d, i) => {
    const live = status.output.active && status.output.displayId === d.id;
    const el = document.createElement('div');
    el.className = 'display-card' + (d.id === selectedDisplayId ? ' selected' : '');
    el.style.animationDelay = (i * 60) + 'ms';
    el.innerHTML = `
      ${d.primary ? '<span class="dc-tag">主屏</span>' : ''}
      ${live ? '<span class="dc-live">● 大屏输出中</span>' : ''}
      <div class="dc-screen">${d.size}</div>
      <div class="dc-name">显示器 ${d.index + 1}${d.primary ? '（本窗口所在）' : ''}</div>
      <div class="dc-meta">${d.size} · 缩放 ${Math.round(d.scaleFactor * 100)}%</div>
    `;
    el.addEventListener('click', () => {
      selectedDisplayId = d.id;
      renderDisplays();
    });
    grid.appendChild(el);
  });
}

$('#btnIdentify').addEventListener('click', () => window.yuhox.identifyDisplays());

$('#btnStart').addEventListener('click', async () => {
  status = await window.yuhox.startOutput(selectedDisplayId);
  renderDisplays();
  renderStatus();
  const d = (status.displays || []).find((x) => x.id === selectedDisplayId);
  toast(`已上屏：显示器 ${(d ? d.index + 1 : '?')}`);
});

$('#btnStop').addEventListener('click', async () => {
  status = await window.yuhox.stopOutput();
  renderDisplays();
  renderStatus();
  toast('大屏画面已撤下');
});

$('#btnBlack').addEventListener('click', async () => {
  const want = !(status.output && status.output.blacked);
  status = await window.yuhox.setBlacked(want);
  renderStatus();
  $('#btnBlack').textContent = want ? '☀ 取消黑屏' : '⚗ 黑屏待机';
});

/* ───────── 状态徽标 ───────── */

function renderStatus() {
  if (!status) return;
  const o = status.output || {};
  const so = $('#stOutput');
  so.className = 'badge ' + (o.active ? (o.blacked ? '' : 'on') : 'off');
  so.innerHTML = `<span class="dot"></span>${o.active ? (o.blacked ? '大屏黑屏待机' : '大屏输出中') : '未上屏'}`;

  const srv = status.server || {};
  const ss = $('#stServer');
  ss.className = 'badge ' + (srv.running ? 'on' : 'off');
  ss.innerHTML = `<span class="dot"></span>${srv.running ? `推送接口 :${srv.port}` : '推送接口未启动'}`;
  const ss2 = $('#stServer2');
  ss2.className = 'badge ' + (srv.running ? 'on' : 'off');
  ss2.innerHTML = `<span class="dot"></span>${srv.running ? '已启动' : '未启动'}`;

  const fw = status.file || {};
  const sf = $('#stFile');
  sf.className = 'badge ' + (fw.watching ? 'on' : 'off');
  sf.innerHTML = `<span class="dot"></span>${fw.watching ? '监听文件中' : '未监听文件'}`;
  const sf2 = $('#stFile2');
  sf2.className = 'badge ' + (fw.watching ? 'on' : 'off');
  sf2.innerHTML = `<span class="dot"></span>${fw.watching ? '监听中' : '未监听'}`;
  if (fw.watching && fw.path) $('#filePath').textContent = fw.path;

  $('#verLine').textContent = 'v' + (status.version || '—');
  renderAutoLaunch();
  renderMobile();
  renderData();
  renderHotkeys();
}

/* ───────── 手机遥控 ───────── */

function mobileUrl() {
  const lan = (status && status.lan) || [];
  const port = (status && status.server && status.server.port) || 7788;
  return `http://${lan[0] || '127.0.0.1'}:${port}/m`;
}

function renderMobile() {
  const srv = (status && status.server) || {};
  const pin = (board && board.settings && board.settings.mobilePin) || '';
  const badge = $('#stMobile');
  if (badge) {
    badge.className = 'badge ' + (srv.running ? 'on' : 'off');
    badge.innerHTML = `<span class="dot"></span>${srv.running ? (pin ? '需口令' : '局域网可访问') : '未开启'}`;
  }
  const el = $('#mobileUrl');
  if (el) el.textContent = srv.running ? mobileUrl() : '先启动下面的「HTTP 实时推送」';
  const inp = $('#inpPin');
  if (inp && document.activeElement !== inp) inp.value = pin;
  const tip = $('#pinTip');
  if (tip) {
    tip.textContent = pin
      ? '已设口令：手机首次打开需要输入这个口令。'
      : '现场网络人多时建议设个口令，手机第一次打开会要求输入。';
  }
}

/* ───────── 数据与维护 ───────── */

function renderData() {
  const d = (status && status.data) || {};
  $('#dataPath').textContent = d.file || '—';
  const b = $('#stPortable');
  b.className = 'badge ' + (d.portable ? 'on' : '');
  b.innerHTML = `<span class="dot"></span>${d.portable ? '便携版 · 数据跟着文件夹' : '安装版 · 数据在用户目录'}`;
}

/* ───────── 全局快捷键 ───────── */

const HK_DESC = {
  'CommandOrControl+Alt+B': '黑屏 / 恢复画面',
  'CommandOrControl+Alt+H': '收起 / 唤出控制台',
  'CommandOrControl+Alt+S': '上屏 / 撤下大屏'
};

function renderHotkeys() {
  const h = (status && status.hotkeys) || {};
  const list = $('#hotkeyList');
  if (!list) return;
  if (h.enabled === false) {
    list.innerHTML = '<span class="hk-row off">全局快捷键已关闭</span>';
    return;
  }
  const active = h.active || [];
  if (!active.length) {
    list.innerHTML = '<span class="hk-row off">快捷键被其它软件占用，未能注册</span>';
    return;
  }
  list.innerHTML = active.map((a) =>
    `<span class="hk-row"><b>${a.label}</b><em>${HK_DESC[a.accel] || ''}</em></span>`
  ).join('');
}

/* 开机自启开关：状态来自主进程（用户偏好 + 系统真实状态） */
function renderAutoLaunch() {
  const a = (status && status.autolaunch) || {};
  const sw = $('#swAutoLaunch');
  if (!sw) return;
  sw.checked = a.enabled !== false;
  const tip = $('#autoLaunchTip');
  if (tip) {
    tip.textContent = a.supported
      ? (sw.checked
        ? '开机后自动在托盘待命，不弹窗打扰。'
        : '已关闭，开机需手动打开 Yuhox Board。')
      : '开发模式下只记录开关，安装版启动后由系统接管（写入开机启动项）。';
  }
}

const swAuto = $('#swAutoLaunch');
if (swAuto) {
  swAuto.addEventListener('change', async (e) => {
    const on = e.target.checked;
    const r = await window.yuhox.setAutoLaunch(on);
    status = Object.assign({}, status, { autolaunch: r });
    renderAutoLaunch();
    toast(on ? '已开启开机自动启动' : '已关闭开机自动启动');
  });
}

/* ═════════ 数据表编辑器 ═════════ */

const teWrap = $('.te-wrap');
const teHead = $('#teHead');
const teBody = $('#teBody');

function visibleCols() {
  if (!board || !Array.isArray(board.columns)) return [];
  return board.columns.filter((c) => c.visible !== false);
}

function colsTemplate() {
  return visibleCols().map((c) => `minmax(0, ${Math.max(40, Math.round(c.width))}fr)`).join(' ');
}

function applyColsTemplate() {
  teWrap.style.setProperty('--cols', colsTemplate());
}

function typeTag(type) {
  return type === 'index' ? '序号' : type === 'progress' ? '进度' : '文字';
}

function renderEditor() {
  if (!board) return;
  const cols = visibleCols();
  applyColsTemplate();

  teHead.innerHTML = cols.map((c) => `
    <div class="th" data-key="${c.key}" title="${escapeAttr(c.label)}（${typeTag(c.type)}）">
      <span>${escapeHtml(c.label)}</span>
      <i class="th-resize" data-key="${c.key}" title="拖动调整列宽"></i>
    </div>`).join('') + '<div class="th"></div>';

  teBody.innerHTML = '';
  board.rows.forEach((r, i) => teBody.appendChild(buildRow(r, i, cols)));
  $('#teCount').textContent = `${board.rows.length} 行 · ${cols.length} 列`;
  bindResizers();
}

function cellHtml(row, col) {
  if (col.type === 'index') return '';
  if (col.type === 'progress') {
    const v = clampPct(row.cells[col.key]);
    return `<div class="te-prog">
      <input class="cell-num" data-key="${col.key}" type="number" min="0" max="100" value="${v}" />
      <div class="mini-bar"><i style="width:${v}%"></i></div>
    </div>`;
  }
  return `<input class="cell-input" data-key="${col.key}" value="${escapeAttr(row.cells[col.key])}" />`;
}

function buildRow(row, i, cols) {
  const el = document.createElement('div');
  el.className = 'te-row';
  el.dataset.id = row.id;
  el.innerHTML = cols.map((c) =>
    c.type === 'index'
      ? `<div class="te-idx">${i + 1}</div>`
      : cellHtml(row, c)
  ).join('') + `
    <div class="te-act">
      <button class="ico-btn drag" draggable="true" title="拖动排序">⠿</button>
      <button class="ico-btn up" title="上移">↑</button>
      <button class="ico-btn down" title="下移">↓</button>
      <button class="ico-btn del" title="删除此行">✕</button>
    </div>`;
  wireRow(el);
  return el;
}

function collectRows() {
  const cols = visibleCols();
  return $$('#teBody .te-row').map((row) => {
    const cells = {};
    cols.forEach((c) => {
      if (c.type === 'index') return;
      const input = row.querySelector(`[data-key="${c.key}"]`);
      if (!input) return;
      cells[c.key] = c.type === 'progress' ? clampPct(input.value) : input.value;
    });
    return { id: row.dataset.id, cells };
  });
}

const pushRows = debounce(() => {
  const rows = collectRows();
  board.rows = rows;
  pushBoard({ rows });
}, 280);

function renumber() {
  $$('#teBody .te-row').forEach((row, i) => {
    const idx = row.querySelector('.te-idx');
    if (idx) idx.textContent = i + 1;
  });
}

function wireRow(row) {
  row.querySelectorAll('.cell-input').forEach((input) => {
    input.addEventListener('input', () => {
      row.dataset.dirty = '1';
      pushRows();
      openAC(input);
    });
    input.addEventListener('focus', () => openAC(input));
    input.addEventListener('blur', () => {
      remember(input.dataset.key, input.value);
      setTimeout(hideAC, 140);
    });
    input.addEventListener('keydown', onInputKeydown);
  });

  row.querySelectorAll('.cell-num').forEach((num) => {
    const bar = row.querySelector('.mini-bar i');
    num.addEventListener('input', () => {
      const v = clampPct(num.value);
      if (bar) bar.style.width = v + '%';
      pushRows();
    });
    num.addEventListener('blur', () => {
      num.value = clampPct(num.value);
      if (bar) bar.style.width = num.value + '%';
    });
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); focusSiblingCell(num, e.shiftKey ? -1 : 1) || num.blur(); }
    });
  });

  row.querySelector('.up').addEventListener('click', () => {
    const prev = row.previousElementSibling;
    if (!prev) return;
    teBody.insertBefore(row, prev);
    renumber(); pushRows();
  });
  row.querySelector('.down').addEventListener('click', () => {
    const next = row.nextElementSibling;
    if (!next) return;
    teBody.insertBefore(next, row);
    renumber(); pushRows();
  });
  row.querySelector('.del').addEventListener('click', () => {
    row.classList.add('leaving');
    setTimeout(() => { row.remove(); renumber(); pushRows(); }, 120);
  });
}

/* ───────── 行拖拽排序 ───────── */

let dragRow = null;

teBody.addEventListener('dragstart', (e) => {
  const handle = e.target.closest('.drag');
  if (!handle) return;
  dragRow = handle.closest('.te-row');
  if (!dragRow) return;
  dragRow.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', dragRow.dataset.id); } catch (_) {}
  try { e.dataTransfer.setDragImage(dragRow, 24, 18); } catch (_) {}
});

teBody.addEventListener('dragover', (e) => {
  if (!dragRow) return;
  e.preventDefault();
  const over = e.target.closest('.te-row');
  if (!over || over === dragRow) return;
  const r = over.getBoundingClientRect();
  const after = e.clientY > r.top + r.height / 2;
  teBody.insertBefore(dragRow, after ? over.nextSibling : over);
});

teBody.addEventListener('drop', (e) => { if (dragRow) e.preventDefault(); });

teBody.addEventListener('dragend', () => {
  if (!dragRow) return;
  dragRow.classList.remove('dragging');
  dragRow = null;
  renumber();
  pushRows();
});

/* ───────── 列宽拖拽 ───────── */

function bindResizers() {
  teHead.querySelectorAll('.th-resize').forEach((h) => {
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = h.dataset.key;
      const first = board.columns.find((c) => c.key === key);
      if (!first) return;

      const th = h.closest('.th');
      const rect = th.getBoundingClientRect();
      // 网格按比例分配宽度：算出「1 个设计单位 = 多少像素」，拖动才跟手
      const k = rect.width / Math.max(1, first.width);
      const vis = visibleCols();
      const nextKey = (vis[vis.indexOf(first) + 1] || {}).key || null;

      const startX = e.clientX;
      const startW = first.width;
      const nextAtStart = board.columns.find((c) => c.key === nextKey);
      const startNextW = nextAtStart ? nextAtStart.width : null;
      let moved = false;

      try { h.setPointerCapture(e.pointerId); } catch (_) {}

      const move = (ev) => {
        const col = board.columns.find((c) => c.key === key);
        if (!col) return;
        const delta = (ev.clientX - startX) / (k || 1);
        const w = Math.max(60, Math.min(900, Math.round(startW + delta)));
        if (w === col.width) return;
        col.width = w;
        // 相邻列让出/收回宽度，整表总宽保持不变
        const nextCol = board.columns.find((c) => c.key === nextKey);
        if (nextCol && startNextW != null) {
          nextCol.width = Math.max(60, Math.min(900, Math.round(startNextW - (w - startW))));
        }
        moved = true;
        applyColsTemplate();
      };
      const up = () => {
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        h.removeEventListener('pointercancel', up);
        if (moved) {
          pushBoard({ columns: board.columns });
          if ($('#colCard').style.display !== 'none') renderColumns();
        }
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
    });
  });
}

/* ───────── 输入自动补全 ───────── */

const acPop = $('#acPop');
let acTarget = null;
let acItems = [];
let acIndex = -1;

function remember(key, value) {
  if (!key) return;
  const v = String(value == null ? '' : value).trim();
  if (!v) return;
  const dict = board.dict || (board.dict = {});
  const list = dict[key] || (dict[key] = []);
  dict[key] = [v, ...list.filter((x) => x !== v)].slice(0, 200);
  window.yuhox.addDict(key, v).catch(() => {});
}

function openAC(input) {
  const key = input.dataset.key;
  if (!key) return;
  const dict = board.dict || {};
  const all = dict[key] || [];
  if (!all.length) { hideAC(); return; }
  const q = String(input.value || '').trim().toLowerCase();
  const items = all.filter((v) => !q || v.toLowerCase().includes(q)).slice(0, 8);
  if (!items.length) { hideAC(); return; }
  acTarget = input;
  acItems = items;
  acIndex = 0;
  renderAC();
  const r = input.getBoundingClientRect();
  const width = Math.max(190, Math.min(420, r.width));
  acPop.style.width = width + 'px';
  acPop.style.left = Math.min(r.left, window.innerWidth - width - 12) + 'px';
  const below = r.bottom + 6;
  const h = Math.min(232, acItems.length * 33 + 12);
  acPop.style.top = (below + h > window.innerHeight - 10 ? r.top - h - 6 : below) + 'px';
  acPop.classList.add('show');
}

function renderAC() {
  acPop.innerHTML = acItems.map((v, i) => `
    <div class="ac-item ${i === acIndex ? 'active' : ''}" data-i="${i}">
      <b>${escapeHtml(v)}</b><small>${i === 0 ? '最近' : '历史'}</small>
    </div>`).join('');
}

function hideAC() {
  acPop.classList.remove('show');
  acTarget = null;
  acItems = [];
  acIndex = -1;
}

function applyAC(i) {
  if (!acTarget || !acItems[i]) return;
  const input = acTarget;
  input.value = acItems[i];
  const row = input.closest('.te-row');
  if (row) { row.dataset.dirty = '1'; }
  remember(input.dataset.key, input.value);
  pushRows();
  hideAC();
  input.focus();
}

acPop.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const item = e.target.closest('.ac-item');
  if (item) applyAC(Number(item.dataset.i));
});

function onInputKeydown(e) {
  const shown = acPop.classList.contains('show');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!shown) { openAC(e.target); return; }
    acIndex = Math.min(acItems.length - 1, acIndex + 1);
    renderAC();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!shown) return;
    acIndex = Math.max(0, acIndex - 1);
    renderAC();
  } else if (e.key === 'Enter') {
    if (shown && acIndex >= 0) { e.preventDefault(); applyAC(acIndex); return; }
    remember(e.target.dataset.key, e.target.value);
    hideAC();
    // 回车往下走一格，方便连续录一整列；到最后一行再回车自动加一行
    e.preventDefault();
    focusSiblingCell(e.target, e.shiftKey ? -1 : 1);
  } else if (e.key === 'Escape') {
    hideAC();
  } else if (e.key === 'Tab') {
    remember(e.target.dataset.key, e.target.value);
    hideAC();
  }
}

/** 同列上下移动焦点；到底了就新增一行（返回是否处理了） */
function focusSiblingCell(input, dir) {
  const key = input.dataset.key;
  const row = input.closest('.te-row');
  if (!key || !row) return false;
  let sib = dir > 0 ? row.nextElementSibling : row.previousElementSibling;
  while (sib && !sib.classList.contains('te-row')) {
    sib = dir > 0 ? sib.nextElementSibling : sib.previousElementSibling;
  }
  if (!sib) {
    if (dir > 0) { $('#btnAddRow').click(); return true; }
    return false;
  }
  const sel = `.cell-input[data-key="${key}"], .cell-num[data-key="${key}"]`;
  const target = sib.querySelector(sel) || sib.querySelector('.cell-input');
  if (!target) return false;
  target.focus();
  if (target.select) target.select();
  return true;
}

window.addEventListener('scroll', hideAC, true);
window.addEventListener('resize', hideAC);

/* ───────── 行操作 ───────── */

$('#btnAddRow').addEventListener('click', async () => {
  const cells = {};
  board.columns.forEach((c) => {
    if (c.type === 'progress') cells[c.key] = 0;
    else if (c.type !== 'index') cells[c.key] = '';
  });
  const rows = collectRows().concat([{ id: uid('r'), cells }]);
  await pushBoard({ rows });
  renderEditor();
  const last = teBody.lastElementChild;
  if (last) {
    const first = last.querySelector('.cell-input');
    if (first) first.focus();
    last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
});

/* ───────── 列设置 ───────── */

$('#btnCols').addEventListener('click', () => {
  const card = $('#colCard');
  const show = card.style.display === 'none';
  card.style.display = show ? '' : 'none';
  if (show) {
    renderColumns();
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});

function renderColumns() {
  if (!board) return;
  const list = $('#colList');
  list.innerHTML = board.columns.map((c) => `
    <div class="col-row" data-key="${c.key}">
      <button class="ico-btn drag" draggable="true" title="拖动调整列序">⠿</button>
      <span class="cr-key" title="${escapeAttr(c.key)}">${escapeHtml(c.key)}</span>
      <input class="cr-label" value="${escapeAttr(c.label)}" maxlength="20" placeholder="列头名称" />
      <select class="cr-type">
        <option value="text" ${c.type === 'text' ? 'selected' : ''}>文字</option>
        <option value="progress" ${c.type === 'progress' ? 'selected' : ''}>进度</option>
        <option value="index" ${c.type === 'index' ? 'selected' : ''}>序号</option>
      </select>
      <input class="cr-width" type="number" min="60" max="900" step="10" value="${c.width}" title="列宽（像素）" />
      <label class="cr-vis"><input type="checkbox" ${c.visible !== false ? 'checked' : ''} />显示</label>
      <button class="ico-btn del" title="删除这一列">✕</button>
    </div>`).join('');
  wireColumns();
}

function wireColumns() {
  $$('#colList .col-row').forEach((row) => {
    const key = row.dataset.key;
    // 每次都按 key 现查：主进程广播可能替换 board 对象，闭包里存旧对象会丢失修改
    const getCol = () => board.columns.find((c) => c.key === key);
    if (!getCol()) return;

    const label = row.querySelector('.cr-label');
    const commitLabel = debounce(async () => {
      const col = getCol();
      if (!col) return;
      col.label = label.value.trim().slice(0, 20) || '未命名列';
      await pushBoard({ columns: board.columns });
      syncHeaderLabels();
    }, 320);
    label.addEventListener('input', commitLabel);
    label.addEventListener('blur', () => {
      const col = getCol();
      if (!col) return;
      col.label = label.value.trim().slice(0, 20) || '未命名列';
      label.value = col.label;
      pushBoard({ columns: board.columns }).then(syncHeaderLabels);
    });

    row.querySelector('.cr-type').addEventListener('change', async (e) => {
      const col = getCol();
      if (!col) return;
      col.type = e.target.value;
      if (col.type === 'progress') {
        board.rows.forEach((r) => { r.cells[col.key] = clampPct(r.cells[col.key]); });
      }
      await pushBoard({ columns: board.columns, rows: board.rows });
      renderEditor();
    });

    const width = row.querySelector('.cr-width');
    width.addEventListener('change', async () => {
      const col = getCol();
      if (!col) return;
      col.width = Math.max(60, Math.min(900, Number(width.value) || 200));
      width.value = col.width;
      await pushBoard({ columns: board.columns });
      applyColsTemplate();
    });

    row.querySelector('.cr-vis').addEventListener('change', async (e) => {
      const col = getCol();
      if (!col) return;
      col.visible = e.target.checked;
      await pushBoard({ columns: board.columns });
      renderEditor();
    });

    row.querySelector('.del').addEventListener('click', async () => {
      const col = getCol();
      if (!col) return;
      if (board.columns.length <= 1) { toast('至少保留一列'); return; }
      if (!window.confirm(`删除列「${col.label}」？该列数据会一并删除。`)) return;
      board.columns = board.columns.filter((c) => c.key !== key);
      await pushBoard({ columns: board.columns });
      renderColumns();
      renderEditor();
      toast(`已删除列「${col.label}」`);
    });
  });
}

function syncHeaderLabels() {
  visibleCols().forEach((c) => {
    const th = teHead.querySelector(`.th[data-key="${c.key}"] span`);
    if (th) { th.textContent = c.label; th.title = c.label; }
  });
}

/* 列拖拽排序 */
let dragCol = null;
$('#colList').addEventListener('dragstart', (e) => {
  const handle = e.target.closest('.drag');
  if (!handle) return;
  dragCol = handle.closest('.col-row');
  if (!dragCol) return;
  dragCol.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', dragCol.dataset.key); } catch (_) {}
  try { e.dataTransfer.setDragImage(dragCol, 24, 18); } catch (_) {}
});
$('#colList').addEventListener('dragover', (e) => {
  if (!dragCol) return;
  e.preventDefault();
  const over = e.target.closest('.col-row');
  if (!over || over === dragCol) return;
  const r = over.getBoundingClientRect();
  const after = e.clientY > r.top + r.height / 2;
  over.parentElement.insertBefore(dragCol, after ? over.nextSibling : over);
});
$('#colList').addEventListener('drop', (e) => { if (dragCol) e.preventDefault(); });
$('#colList').addEventListener('dragend', async () => {
  if (!dragCol) return;
  dragCol.classList.remove('dragging');
  dragCol = null;
  const order = $$('#colList .col-row').map((el) => el.dataset.key);
  board.columns.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  await pushBoard({ columns: board.columns });
  renderEditor();
  toast('列顺序已更新');
});

$('#btnAddCol').addEventListener('click', async () => {
  const label = $('#inpNewCol').value.trim().slice(0, 20);
  const type = $('#selNewColType').value;
  if (!label) { toast('先填列名'); $('#inpNewCol').focus(); return; }
  if (type === 'index' && board.columns.some((c) => c.type === 'index')) {
    toast('已经有序号列了');
    return;
  }
  const col = {
    key: uid('c'),
    label,
    type,
    width: type === 'progress' ? 200 : type === 'index' ? 70 : 160,
    visible: true
  };
  board.columns.push(col);
  board.rows.forEach((r) => { r.cells[col.key] = type === 'progress' ? 0 : ''; });
  await pushBoard({ columns: board.columns, rows: board.rows });
  $('#inpNewCol').value = '';
  renderColumns();
  renderEditor();
  toast(`已添加列「${label}」`);
});

$('#btnResetCols').addEventListener('click', async () => {
  if (!window.confirm('恢复成默认五列（序号 / 施工队伍 / 施工动态 / 施工进度 / 施工工序）？\n自定义的列及其数据会被删除。')) return;
  const cols = [
    { key: 'idx', label: '序号', type: 'index', width: 70, visible: true },
    { key: 'team', label: '施工队伍', type: 'text', width: 150, visible: true },
    { key: 'act', label: '施工动态', type: 'text', width: 290, visible: true },
    { key: 'prog', label: '施工进度', type: 'progress', width: 190, visible: true },
    { key: 'proc', label: '施工工序', type: 'text', width: 130, visible: true }
  ];
  await pushBoard({ columns: cols, rows: board.rows });
  renderColumns();
  renderEditor();
  toast('已恢复默认列');
});

/* ───────── Excel 导入 / 导出 ───────── */

let importBuf = null;

async function doImport() {
  const data = await window.yuhox.importExcel();
  if (!data) return;
  if (data.error) { toast('导入失败：' + data.error); return; }
  if (!data.header || !data.header.length) { toast('没读到表头'); return; }
  importBuf = data;
  showImportModal(data);
}

function planImport(header) {
  const existing = board.columns.slice();
  const map = [];
  const newCols = [];

  header.forEach((raw) => {
    const label = String(raw == null ? '' : raw).trim();
    if (!label) { map.push({ mode: 'skip' }); return; }

    const hit = existing.find((c) => c.label === label) ||
      existing.find((c) => c.label.toLowerCase() === label.toLowerCase());
    if (hit) { map.push({ mode: 'existing', key: hit.key, type: hit.type, label: hit.label }); return; }

    if (/^(序号|序|no\.?|#|编号)$/i.test(label)) {
      const idx = existing.find((c) => c.type === 'index');
      map.push(idx ? { mode: 'existing', key: idx.key, type: 'index', label: idx.label }
        : { mode: 'skip', label });
      return;
    }

    const type = /进度|完成率|百分比|占比|percent|progress/i.test(label) ? 'progress' : 'text';
    const key = uid('c');
    const col = { key, label: label.slice(0, 20), type, width: type === 'progress' ? 190 : 160, visible: true };
    newCols.push(col);
    map.push({ mode: 'new', key, type, label: col.label });
  });

  return { map, newCols };
}

function showImportModal(data) {
  const plan = planImport(data.header);
  $('#impFile').textContent = data.path || data.name || '';
  $('#impSummary').innerHTML =
    `工作表 <b>${escapeHtml(data.sheetName)}</b> · 表头在第 ${data.headerRow} 行 · ` +
    `<b>${data.rows.length}</b> 行数据 · 识别到 <b>${data.header.filter(Boolean).length}</b> 列`;

  $('#impCols').innerHTML = plan.map.map((m, i) => {
    const label = EscapeChip(m.label || data.header[i]);
    if (m.mode === 'skip') return '';
    if (m.mode === 'existing') {
      return `<span class="imp-chip">${label}<em>${m.type === 'index' ? '序号自动' : '已有列'}</em></span>`;
    }
    return `<span class="imp-chip new">${label}<em>新建 · ${typeTag(m.type)}</em></span>`;
  }).join('') + (plan.newCols.length
    ? `<span class="imp-chip new">共新增 ${plan.newCols.length} 列<em>自动创建</em></span>` : '');

  $('#importMask').classList.add('show');
  importBuf.plan = plan;
}

function EscapeChip(s) {
  return escapeHtml(String(s == null ? '' : s)) || '<em>空</em>';
}

function hideImportModal() {
  $('#importMask').classList.remove('show');
  importBuf = null;
}

function buildImportedRows(aoa, plan) {
  const rows = [];
  aoa.forEach((line) => {
    const cells = {};
    let hasText = false;
    plan.map.forEach((m, j) => {
      if (!m || m.mode === 'skip' || !m.key) return;
      if (m.type === 'index') return;
      const raw = line[j];
      if (m.type === 'progress') {
        const n = Number(String(raw == null ? '' : raw).replace(/[^\d.-]/g, ''));
        cells[m.key] = Number.isFinite(n) ? clampPct(n) : 0;
      } else {
        const v = String(raw == null ? '' : raw).trim().slice(0, 200);
        cells[m.key] = v;
        if (v) hasText = true;
      }
    });
    if (!hasText && !Object.values(cells).some((v) => v)) return;
    rows.push({ id: uid('r'), cells });
  });
  return rows;
}

/** 导入的文本值也进历史字典，下次输入即可补全 */
function learnFromImport(rows, plan) {
  plan.map.forEach((m) => {
    if (!m || m.mode === 'skip' || !m.key || m.type !== 'text') return;
    const vals = [...new Set(rows.map((r) => String(r.cells[m.key] || '').trim()).filter(Boolean))].slice(0, 200);
    if (vals.length) {
      board.dict[m.key] = [...new Set([...vals, ...(board.dict[m.key] || [])])].slice(0, 200);
      window.yuhox.mergeDict(m.key, vals).catch(() => {});
    }
  });
}

async function applyImport(mode) {
  if (!importBuf) return;
  const { plan, rows: aoa } = importBuf;
  const rows = buildImportedRows(aoa, plan);

  let columns = board.columns.slice();
  if (plan.newCols.length) columns = columns.concat(plan.newCols);

  let nextRows;
  if (mode === 'replace') nextRows = rows;
  else nextRows = collectRows().concat(rows);

  await pushBoard({ columns, rows: nextRows });
  learnFromImport(rows, plan);
  hideImportModal();
  renderEditor();
  $('#colCard').style.display = '';
  renderColumns();
  toast(mode === 'replace'
    ? `已覆盖导入 ${rows.length} 行`
    : `已追加 ${rows.length} 行`);
}

$('#btnImportExcel').addEventListener('click', doImport);
$('#btnImportExcel2').addEventListener('click', doImport);
$('#impClose').addEventListener('click', hideImportModal);
$('#impCancel').addEventListener('click', hideImportModal);
$('#impReplace').addEventListener('click', () => applyImport('replace'));
$('#impAppend').addEventListener('click', () => applyImport('append'));
$('#importMask').addEventListener('click', (e) => {
  if (e.target === $('#importMask')) hideImportModal();
});

async function doExport() {
  const r = await window.yuhox.exportExcel();
  if (!r) return;
  if (r.error) { toast('导出失败：' + r.error); return; }
  toast(`已导出 ${r.rows} 行到 ${r.file}`);
}

$('#btnExportExcel').addEventListener('click', doExport);
$('#btnExportExcel2').addEventListener('click', doExport);

/* ───────── 标题与字幕 ───────── */

function renderBoardTexts() {
  if (!board) return;
  $('#inpTitle').value = board.title || '';
  $('#inpSubtitle').value = board.subtitle || '';
  $('#inpTitle2').value = board.title || '';
  $('#inpSubtitle2').value = board.subtitle || '';
  $('#inpTickers').value = (board.settings.tickers || []).join('\n');
}

function setTitle(v) {
  $('#inpTitle').value = v;
  $('#inpTitle2').value = v;
  pushBoard({ title: v });
}
function setSubtitle(v) {
  $('#inpSubtitle').value = v;
  $('#inpSubtitle2').value = v;
  pushBoard({ subtitle: v });
}

$('#inpTitle').addEventListener('input', debounce((e) => setTitle(e.target.value), 280));
$('#inpTitle2').addEventListener('input', debounce((e) => setTitle(e.target.value), 280));
$('#inpSubtitle').addEventListener('input', debounce((e) => setSubtitle(e.target.value), 280));
$('#inpSubtitle2').addEventListener('input', debounce((e) => setSubtitle(e.target.value), 280));
$('#inpTickers').addEventListener('input', debounce((e) => pushBoard({
  settings: { tickers: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) }
}), 400));

/* ───────── 数据源 ───────── */

$('#btnServerStart').addEventListener('click', async () => {
  const port = Number($('#inpPort').value) || 7788;
  const r = await window.yuhox.serverStart(port);
  status = r;
  renderStatus();
  toast(r.error ? '启动失败：' + r.error : `推送接口已启动 · 端口 ${r.server.port}`);
});

$('#btnServerStop').addEventListener('click', async () => {
  status = await window.yuhox.serverStop();
  renderStatus();
  toast('推送接口已停止');
});

$('#btnCopyApi').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#apiDoc').innerText);
    toast('接口说明已复制');
  } catch (_) {
    toast('复制失败，请手动选择复制');
  }
});

$('#btnFilePick').addEventListener('click', async () => {
  const file = await window.yuhox.pickFile();
  if (!file) return;
  const r = await window.yuhox.fileWatch(file);
  status = r;
  renderStatus();
  toast(r.error ? '监听失败：' + r.error : '已开始监听该文件');
});

$('#btnFileClear').addEventListener('click', async () => {
  status = await window.yuhox.fileWatch(null);
  renderStatus();
  $('#filePath').textContent = '未选择文件';
  toast('已停止文件监听');
});

$('#btnExport').addEventListener('click', async () => {
  const p = await window.yuhox.exportBoard();
  if (p) toast('已导出到：' + p);
});

$('#btnGotoContent').addEventListener('click', () => {
  $$('.nav-item')[1].click();
});

/* ───────── 外观 ───────── */

function renderSettings() {
  if (!board) return;
  const s = board.settings;
  $('#inpAccent').value = s.accent;
  $('#inpAccent2').value = s.accent2;
  $('#selLayout').value = s.layout;
  $('#swClock').checked = !!s.showClock;
  $('#swSummary').checked = !!s.showSummary;
  $('#swZebra').checked = s.zebra !== false;
  $('#swScroll').checked = !!s.autoScroll;
  $('#rngSpeed').value = s.scrollSpeed;
  $('#lblSpeed').textContent = s.scrollSpeed + ' px/s';

  const fs2 = s.fontScale || 1;
  $('#rngFont').value = fs2;
  $('#lblFont').textContent = Math.round(fs2 * 100) + '%';

  $('#swRestore').checked = s.autoRestoreOutput !== false;
  $('#swHotkeys').checked = s.hotkeys !== false;
  $('#swServerAuto').checked = s.serverAuto !== false;
}

$('#inpAccent').addEventListener('input', debounce((e) => pushBoard({ settings: { accent: e.target.value } }), 250));
$('#inpAccent2').addEventListener('input', debounce((e) => pushBoard({ settings: { accent2: e.target.value } }), 250));
$('#selLayout').addEventListener('change', (e) => pushBoard({ settings: { layout: e.target.value } }));
$('#swClock').addEventListener('change', (e) => pushBoard({ settings: { showClock: e.target.checked } }));
$('#swSummary').addEventListener('change', (e) => pushBoard({ settings: { showSummary: e.target.checked } }));
$('#swZebra').addEventListener('change', (e) => pushBoard({ settings: { zebra: e.target.checked } }));
$('#swScroll').addEventListener('change', (e) => pushBoard({ settings: { autoScroll: e.target.checked } }));
$('#rngFont').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  $('#lblFont').textContent = Math.round(v * 100) + '%';
  previewFontScale(v);          // 拖的时候先让预览跟着变，松手才落库
}, { passive: true });
$('#rngFont').addEventListener('change', (e) => {
  pushBoard({ settings: { fontScale: Number(e.target.value) } });
});

function previewFontScale(v) {
  if (!board) return;
  forwardToPreview(Object.assign({}, board, {
    settings: Object.assign({}, board.settings, { fontScale: v })
  }));
}

/* 影响主进程行为的开关，走 prefs */
$('#swRestore').addEventListener('change', async (e) => {
  status = await window.yuhox.setPrefs({ autoRestoreOutput: e.target.checked });
  renderStatus();
  toast(e.target.checked ? '下次启动会自动回到上次的大屏' : '下次启动不再自动上屏');
});
$('#swHotkeys').addEventListener('change', async (e) => {
  status = await window.yuhox.setPrefs({ hotkeys: e.target.checked });
  renderStatus();
  toast(e.target.checked ? '全局快捷键已开启' : '全局快捷键已关闭');
});
$('#swServerAuto').addEventListener('change', async (e) => {
  status = await window.yuhox.setPrefs({ serverAuto: e.target.checked });
  renderStatus();
  toast(e.target.checked ? '以后启动会自动开推送接口' : '以后启动不再自动开推送接口');
});

/* ───────── 手机遥控 ───────── */

$('#btnCopyMobile').addEventListener('click', async () => {
  const url = mobileUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast('已复制：' + url);
  } catch (_) {
    toast('复制失败，请手动记下：' + url);
  }
});

$('#btnOpenMobile').addEventListener('click', () => {
  if (!(status && status.server && status.server.running)) {
    toast('先启动推送接口');
    return;
  }
  window.yuhox.openUrl(mobileUrl());
});

$('#btnSavePin').addEventListener('click', async () => {
  const v = $('#inpPin').value.trim().slice(0, 12);
  await pushBoard({ settings: { mobilePin: v } });
  renderMobile();
  toast(v ? '已设置口令：' + v : '已取消口令，局域网内可直接打开');
});

/* ───────── 数据与维护 ───────── */

$('#btnOpenData').addEventListener('click', async () => {
  const err = await window.yuhox.openDataDir();
  if (err) toast('打不开目录：' + err);
});

$('#btnSample').addEventListener('click', async () => {
  if (!confirm('用示例数据覆盖当前所有行？会立刻同步到大屏。')) return;
  board = await window.yuhox.resetBoard('sample');
  renderBoardTexts();
  renderEditor();
  renderSettings();
  toast('已恢复示例数据');
});

$('#btnClear').addEventListener('click', async () => {
  if (!confirm('清空所有行？列结构和设置会保留。')) return;
  board = await window.yuhox.resetBoard('empty');
  renderBoardTexts();
  renderEditor();
  renderSettings();
  toast('已清空数据');
});
$('#rngSpeed').addEventListener('input', (e) => {
  $('#lblSpeed').textContent = e.target.value + ' px/s';
  pushBoard({ settings: { scrollSpeed: Number(e.target.value) } });
});

/* ───────── 主进程广播 ───────── */

function editorBusy() {
  const a = document.activeElement;
  return !!(a && (a.closest('#teBody') || a.closest('#colList')));
}

function applyRemoteBoard(b) {
  board = b;
  forwardToPreview(b);
  if (editorBusy()) { pendingSync = true; return; }
  renderBoardTexts();
  renderEditor();
  if ($('#colCard').style.display !== 'none') renderColumns();
  renderSettings();
}

window.yuhox.onBoardUpdated((b) => {
  const echo = b.updatedAt === selfPushAt || Date.now() - lastLocalAt < 700;
  board = b;
  forwardToPreview(b);
  if (echo) return;
  applyRemoteBoard(b);
});

document.addEventListener('focusout', () => {
  if (!pendingSync) return;
  pendingSync = false;
  setTimeout(() => {
    if (!editorBusy() && board) {
      renderBoardTexts();
      renderEditor();
      if ($('#colCard').style.display !== 'none') renderColumns();
      renderSettings();
    }
  }, 200);
});

window.yuhox.onStatusUpdated((s) => {
  status = s;
  renderDisplays();
  renderStatus();
});

/* ───────── 预览缩放 ───────── */

function fitPreview() {
  const stage = document.querySelector('.preview-stage');
  const frame = $('#previewFrame');
  if (!stage || !frame) return;
  const k = stage.clientWidth / 1600;
  frame.style.transform = `scale(${k})`;
}

window.addEventListener('resize', fitPreview);
if (window.ResizeObserver) {
  const stage = document.querySelector('.preview-stage');
  if (stage) new ResizeObserver(fitPreview).observe(stage);
}

/* ───────── 启动 ───────── */

(async function init() {
  board = await window.yuhox.getBoard();
  status = await window.yuhox.getStatus();
  if (status.server && status.server.running) $('#inpPort').value = status.server.port;
  if (status.output && status.output.displayId != null) selectedDisplayId = status.output.displayId;
  $('#btnBlack').textContent = status.output.blacked ? '☀ 取消黑屏' : '⚗ 黑屏待机';
  renderBoardTexts();
  renderEditor();
  renderSettings();
  renderDisplays();
  renderStatus();
  fitPreview();
  forwardToPreview(board);
})();
