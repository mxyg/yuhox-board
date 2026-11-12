/**
 * Yuhox Board · 控制台逻辑
 * 所有编辑经主进程 state 广播回传；大屏预览 iframe 用 postMessage 同步。
 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const STATUS_META = {
  todo: { label: '待启动' },
  doing: { label: '进行中' },
  done: { label: '已完成' },
  blocked: { label: '受阻' }
};

let board = null;
let status = null;
let selectedDisplayId = null;
let selfPushAt = 0;        // 自己刚推过去的 updatedAt，避免回声重绘打字焦点
let toastTimer = null;

/* ───────── 小工具 ───────── */

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function pushBoard(patch) {
  const r = await window.yuhox.setBoard(patch);
  selfPushAt = r.updatedAt;
}

function forwardToPreview(boardData) {
  const frame = $('#previewFrame');
  if (frame && frame.contentWindow) {
    frame.contentWindow.postMessage({ type: 'yuhox-board', board: boardData }, '*');
  }
}

// 预览 iframe 加载完成后先灌一次当前看板，不必等第一次改动
$('#previewFrame').addEventListener('load', () => {
  if (board) forwardToPreview(board);
});

/* ───────── 导航 ───────── */

const PANEL_TITLES = {
  displays: '上屏控制',
  content: '看板内容',
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
}

/* ───────── 看板内容 ───────── */

function renderBoardTexts() {
  if (!board) return;
  $('#inpTitle').value = board.title || '';
  $('#inpSubtitle').value = board.subtitle || '';
  $('#inpTickers').value = (board.settings.tickers || []).join('\n');
}

function renderTasks() {
  if (!board) return;
  const list = $('#taskList');
  list.innerHTML = '';
  board.tasks.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'task-row';
    row.style.animationDelay = (i * 40) + 'ms';
    row.dataset.id = t.id;
    row.innerHTML = `
      <div class="tr-order">
        <button class="up" title="上移">▲</button>
        <button class="down" title="下移">▼</button>
      </div>
      <input class="t-name" value="${escapeAttr(t.name)}" placeholder="任务名称" />
      <input class="t-owner" value="${escapeAttr(t.owner)}" placeholder="负责组" />
      <select class="t-status">
        ${Object.entries(STATUS_META).map(([k, v]) =>
          `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}
      </select>
      <div class="tr-prog">
        <input type="range" class="t-range" min="0" max="100" value="${t.progress}" />
        <input type="number" class="t-num num" min="0" max="100" value="${t.progress}" />
      </div>
      <input class="t-note" value="${escapeAttr(t.note)}" placeholder="备注（可选）" />
      <button class="tr-del" title="删除">✕</button>
    `;
    wireTaskRow(row, i);
    list.appendChild(row);
  });
}

function escapeAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function collectTasks() {
  return $$('#taskList .task-row').map((row) => ({
    id: row.dataset.id,
    name: row.querySelector('.t-name').value.trim(),
    owner: row.querySelector('.t-owner').value.trim(),
    status: row.querySelector('.t-status').value,
    progress: Math.max(0, Math.min(100, Number(row.querySelector('.t-num').value) || 0)),
    note: row.querySelector('.t-note').value.trim()
  }));
}

const pushTasks = debounce(() => pushBoard({ tasks: collectTasks() }), 320);

function wireTaskRow(row) {
  row.querySelector('.t-name').addEventListener('input', pushTasks);
  row.querySelector('.t-owner').addEventListener('input', pushTasks);
  row.querySelector('.t-status').addEventListener('change', pushTasks);
  row.querySelector('.t-note').addEventListener('input', pushTasks);

  const range = row.querySelector('.t-range');
  const num = row.querySelector('.t-num');
  range.addEventListener('input', () => { num.value = range.value; pushTasks(); });
  num.addEventListener('input', () => {
    let v = Math.max(0, Math.min(100, Number(num.value) || 0));
    range.value = v;
    pushTasks();
  });

  row.querySelector('.up').addEventListener('click', () => moveTask(row, -1));
  row.querySelector('.down').addEventListener('click', () => moveTask(row, 1));
  row.querySelector('.tr-del').addEventListener('click', () => {
    row.remove();
    pushTasks();
  });
}

function moveTask(row, dir) {
  const list = $('#taskList');
  const rows = [...list.children];
  const i = rows.indexOf(row);
  const j = i + dir;
  if (j < 0 || j >= rows.length) return;
  list.insertBefore(row, dir > 0 ? rows[j + 1] : rows[j]);
  pushTasks();
}

$('#btnAddTask').addEventListener('click', async () => {
  const tasks = board.tasks.concat([{
    id: 't' + Math.random().toString(36).slice(2, 9),
    name: '新任务', owner: '', status: 'todo', progress: 0, note: ''
  }]);
  await pushBoard({ tasks });
  renderTasks();
  // 聚焦新行
  const rows = $$('#taskList .task-row');
  if (rows.length) rows[rows.length - 1].querySelector('.t-name').focus();
});

const SAMPLE_TASKS = [
  { name: '需求确认与原型评审', owner: '产品组', status: 'done', progress: 100, note: '评审通过' },
  { name: '数据接口联调', owner: '后端组', status: 'doing', progress: 68, note: '推送通道已通' },
  { name: '现场部署与调试', owner: '交付组', status: 'doing', progress: 35, note: '等待大屏进场' },
  { name: '验收资料整理', owner: '产品组', status: 'todo', progress: 0, note: '' },
  { name: '操作培训', owner: '交付组', status: 'blocked', progress: 10, note: '待排期' }
];

$('#btnSample').addEventListener('click', async () => {
  await pushBoard({ tasks: SAMPLE_TASKS });
  renderTasks();
  toast('已载入示例任务');
});

$('#inpTitle').addEventListener('input', debounce((e) => pushBoard({ title: e.target.value }), 300));
$('#inpSubtitle').addEventListener('input', debounce((e) => pushBoard({ subtitle: e.target.value }), 300));
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
  $('#swNote').checked = !!s.showNote;
  $('#swScroll').checked = !!s.autoScroll;
  $('#rngSpeed').value = s.scrollSpeed;
  $('#lblSpeed').textContent = s.scrollSpeed + ' px/s';
}

$('#inpAccent').addEventListener('input', debounce((e) => pushBoard({ settings: { accent: e.target.value } }), 250));
$('#inpAccent2').addEventListener('input', debounce((e) => pushBoard({ settings: { accent2: e.target.value } }), 250));
$('#selLayout').addEventListener('change', (e) => pushBoard({ settings: { layout: e.target.value } }));
$('#swClock').addEventListener('change', (e) => pushBoard({ settings: { showClock: e.target.checked } }));
$('#swSummary').addEventListener('change', (e) => pushBoard({ settings: { showSummary: e.target.checked } }));
$('#swNote').addEventListener('change', (e) => pushBoard({ settings: { showNote: e.target.checked } }));
$('#swScroll').addEventListener('change', (e) => pushBoard({ settings: { autoScroll: e.target.checked } }));
$('#rngSpeed').addEventListener('input', (e) => {
  $('#lblSpeed').textContent = e.target.value + ' px/s';
  pushBoard({ settings: { scrollSpeed: Number(e.target.value) } });
});

/* ───────── 主进程广播 ───────── */

window.yuhox.onBoardUpdated((b) => {
  board = b;
  forwardToPreview(b);
  if (b.updatedAt !== selfPushAt) {
    // 别人（HTTP / 文件 / 别处）改的：全面刷新编辑区
    renderBoardTexts();
    renderTasks();
    renderSettings();
  }
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
  renderTasks();
  renderSettings();
  renderDisplays();
  renderStatus();
  fitPreview();
  forwardToPreview(board);
})();
