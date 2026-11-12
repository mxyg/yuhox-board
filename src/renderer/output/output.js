/**
 * Yuhox Board · 大屏渲染
 *
 * 两条数据通道：IPC（真实输出窗口）/ postMessage（控制台预览 iframe）。
 * 渲染策略：按行 id 对账（新增滑入、单元格原地更新、内容变化闪一下），
 * 数字 KPI 做滚动补间，内容溢出时自动循环滚动。
 *
 * 版式由 board.columns 驱动，列宽按比例铺满屏幕，不写死字段。
 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const stage = $('#stage');
const boardEl = $('#board');

let current = null;
let lastKpi = { total: 0, doing: 0, done: 0, overall: 0, teams: 0 };
const knownRows = new Set();
const marquees = [];
const lastCells = new Map();     // rid → { colKey: value } 用于判断内容变化
const previewMode = new URLSearchParams(location.search).has('preview');

/* ═════════ 数据通道 ═════════ */

if (!previewMode && window.yuhox) {
  window.yuhox.getBoard().then(applyBoard);
  window.yuhox.onBoardUpdated(applyBoard);
  window.yuhox.onOutputCmd((cmd) => {
    if (cmd.type === 'black') stage.classList.toggle('blacked', !!cmd.value);
  });
} else {
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.type === 'yuhox-board' && d.board) applyBoard(d.board);
  });
}

function applyBoard(b) {
  if (!b || !Array.isArray(b.columns)) return;
  current = b;
  render(b);
}

/* ═════════ 主题 ═════════ */

function applyTheme(s) {
  const root = document.documentElement;
  root.style.setProperty('--ob-accent', s.accent || '#4f8cff');
  root.style.setProperty('--ob-accent2', s.accent2 || '#22d3ee');
  root.style.setProperty('--st-doing', s.accent || '#4f8cff');
  // 大屏字号缩放：所有尺寸单位都由 --u 派生，改这一处整块屏同比例放大
  const scale = Math.max(0.7, Math.min(1.6, Number(s.fontScale) || 1));
  root.style.setProperty('--u', `calc(clamp(9px, 1.35vh, 22px) * ${scale})`);
}

/* ═════════ 时钟 ═════════ */

function tickClock() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  $('#clockTime').textContent = `${p(now.getHours())}:${p(now.getMinutes())}`;
  const week = '日一二三四五六'[now.getDay()];
  $('#clockDate').textContent = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · 星期${week}`;
}
setInterval(tickClock, 1000);
tickClock();

/* ═════════ 粒子背景 ═════════ */

function startParticles() {
  const cv = $('#fx');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dots = [];
  // 大屏多为 1080p/4K，DPR 拉满会让每帧填充像素翻四倍；粒子本身是柔光点，1.5 足够
  const DPR = Math.min(window.devicePixelRatio || 1, 1.5);

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * DPR; cv.height = H * DPR;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const n = Math.min(70, Math.floor(W * H / 34000));
    dots = Array.from({ length: n }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      r: Math.random() * 1.6 + 0.6,
      a: Math.random() * 0.4 + 0.15
    }));
  }
  resize();
  window.addEventListener('resize', resize);

  let accent = [79, 140, 255];
  function syncAccent() {
    const s = current && current.settings;
    if (s && s.accent) {
      const m = s.accent.match(/^#(\w{2})(\w{2})(\w{2})$/);
      if (m) accent = [1, 2, 3].map((i) => parseInt(m[i], 16));
    }
  }

  (function frame() {
    ctx.clearRect(0, 0, W, H);
    for (const d of dots) {
      d.x += d.vx; d.y += d.vy;
      if (d.x < -20) d.x = W + 20;
      if (d.x > W + 20) d.x = -20;
      if (d.y < -20) d.y = H + 20;
      if (d.y > H + 20) d.y = -20;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${accent[0]},${accent[1]},${accent[2]},${d.a})`;
      ctx.fill();
    }
    // 连线分两档透明度，各自合成一条路径一次描边；
    // 原来每条线单独 beginPath/stroke，几千次状态切换是卡顿主因
    const NEAR = 6000, FAR = 15000;
    ctx.lineWidth = 0.5;
    for (const bucket of [{ limit: NEAR, alpha: 0.09 }, { limit: FAR, alpha: 0.04 }]) {
      ctx.strokeStyle = `rgba(${accent[0]},${accent[1]},${accent[2]},${bucket.alpha})`;
      ctx.beginPath();
      for (let i = 0; i < dots.length; i++) {
        const a = dots[i];
        for (let j = i + 1; j < dots.length; j++) {
          const b = dots[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 >= bucket.limit) continue;
          if (bucket.limit === FAR && dist2 < NEAR) continue;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      }
      ctx.stroke();
    }
    requestAnimationFrame(frame);
  })();

  setInterval(syncAccent, 2000);
  syncAccent();
}
startParticles();

/* ═════════ KPI ═════════ */

function tweenNumber(el, from, to, dur = 900, suffix = '') {
  const t0 = performance.now();
  (function step(t) {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * eased) + suffix;
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}

function teamColumn(b) {
  const texts = b.columns.filter((c) => c.type === 'text' && c.visible !== false);
  return texts.find((c) => /队伍|班组|单位|施工队/.test(c.label)) ||
    texts.find((c) => c.key === 'team') || texts[0] || null;
}

function computeKpi(b) {
  const rows = b.rows || [];
  const pcol = b.columns.find((c) => c.type === 'progress' && c.visible !== false);

  const teamCol = teamColumn(b);
  const teams = teamCol
    ? new Set(rows.map((r) => String(r.cells[teamCol.key] || '').trim()).filter(Boolean)).size
    : 0;

  if (!pcol) {
    return { total: rows.length, doing: 0, done: 0, overall: 0, teams, hasProgress: false };
  }
  const vals = rows.map((r) => Number(r.cells[pcol.key]) || 0);
  return {
    total: rows.length,
    doing: vals.filter((v) => v > 0 && v < 100).length,
    done: vals.filter((v) => v >= 100).length,
    overall: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0,
    teams,
    hasProgress: true
  };
}

function renderKpi(kpi) {
  tweenNumber($('#kpiTotal'), lastKpi.total, kpi.total);
  $('#kpiTeams').textContent = kpi.teams;

  const cardDoing = $('[data-kpi="doing"]');
  const cardDone = $('[data-kpi="done"]');
  const cardRing = $('[data-kpi="overall"]');
  const cardTeams = $('#kpiTeamsCard');

  if (kpi.hasProgress) {
    cardDoing.style.display = '';
    cardDone.style.display = '';
    cardRing.style.display = '';
    cardTeams.style.display = 'none';
    $('#kpi').style.gridTemplateColumns = '';

    tweenNumber($('#kpiDoing'), lastKpi.doing, kpi.doing);
    tweenNumber($('#kpiDone'), lastKpi.done, kpi.done);
    tweenNumber($('#kpiOverall'), lastKpi.overall, kpi.overall, 900, '%');
    $('#kpiRing').style.setProperty('--p', kpi.overall);

    const max = Math.max(1, kpi.total);
    $('[data-kpi="total"] .kpi-spark i').style.width = '100%';
    $('[data-kpi="doing"] .kpi-spark i').style.width = (kpi.doing / max * 100) + '%';
    $('[data-kpi="done"] .kpi-spark i').style.width = (kpi.done / max * 100) + '%';
  } else {
    cardDoing.style.display = 'none';
    cardDone.style.display = 'none';
    cardRing.style.display = 'none';
    cardTeams.style.display = '';
    $('#kpi').style.gridTemplateColumns = 'repeat(2, 1fr)';
    $('[data-kpi="total"] .kpi-spark i').style.width = '100%';
    cardTeams.querySelector('.kpi-spark i').style.width = '100%';
  }
  lastKpi = kpi;
}

/* ═════════ 公共 ═════════ */

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function visibleColumns(b) {
  return b.columns.filter((c) => c.visible !== false);
}

/** 主文字列：宽度最大的文字列，视觉上加粗 */
function primaryTextKey(cols) {
  const texts = cols.filter((c) => c.type === 'text');
  if (!texts.length) return null;
  return texts.reduce((a, b) => (b.width > a.width ? b : a), texts[0]).key;
}

function flash(cell) {
  if (!cell) return;
  cell.classList.remove('flash');
  void cell.offsetWidth;
  cell.classList.add('flash');
  clearTimeout(cell._flashTimer);
  cell._flashTimer = setTimeout(() => cell.classList.remove('flash'), 1200);
}

function cellTag(col) {
  if (col.type === 'index') return '<div class="td idx"></div>';
  if (col.type === 'progress') {
    return '<div class="td prog"><div class="bar"><i></i></div><span class="pct">0%</span></div>';
  }
  return '<div class="td txt"></div>';
}

function fillCell(cell, col, row, i, opts) {
  const v = row.cells ? row.cells[col.key] : '';
  if (col.type === 'index') {
    cell.textContent = i + 1;
    return;
  }
  if (col.type === 'progress') {
    const n = Math.max(0, Math.min(100, Number(v) || 0));
    const bar = cell.querySelector('.bar i');
    bar.style.width = n + '%';
    bar.classList.toggle('done-stop', n >= 100);
    cell.querySelector('.pct').textContent = n + '%';
    cell.classList.toggle('done', n >= 100);
    cell.classList.toggle('idle', n === 0);
    if (opts.changed) flash(cell);
    return;
  }
  const text = String(v == null ? '' : v);
  if (cell.textContent !== text) cell.textContent = text;
  cell.classList.toggle('primary', opts.primary);
  if (opts.changed) flash(cell);
}

/* ═════════ 表格版式 ═════════ */

function ensureTableShell(cols) {
  if (boardEl.dataset.mode !== 'table') {
    boardEl.className = 'board table';
    boardEl.innerHTML =
      '<div class="tbl">' +
        '<div class="tbl-head"></div>' +
        '<div class="tbl-body"><div class="tbl-scroll"></div></div>' +
      '</div>';
    boardEl.dataset.mode = 'table';
    knownRows.clear();
    lastCells.clear();
  }
  const tpl = cols.map((c) => `minmax(0, ${Math.max(40, Math.round(c.width))}fr)`).join(' ');
  boardEl.style.setProperty('--cols', tpl);
}

function renderTable(b) {
  const cols = visibleColumns(b);
  if (!cols.length) { renderEmpty(); return; }
  ensureTableShell(cols);

  const head = boardEl.querySelector('.tbl-head');
  const sig = cols.map((c) => c.key + ':' + c.type + ':' + c.label).join('|');
  if (head.dataset.sig !== sig) {
    head.dataset.sig = sig;
    head.innerHTML = cols.map((c) =>
      `<div class="th ${c.type}">${escapeHtml(c.label)}</div>`).join('');
  }

  const scroll = boardEl.querySelector('.tbl-scroll');
  const rows = b.rows || [];
  const primary = primaryTextKey(cols);
  const pcol = cols.find((c) => c.type === 'progress') || null;

  const existing = new Map();
  for (const el of [...scroll.children]) {
    if (el.dataset.rid) existing.set(el.dataset.rid, el);
  }
  const keep = new Set();

  rows.forEach((r, i) => {
    keep.add(r.id);
    let el = existing.get(r.id);
    const isNew = !el;
    if (isNew) {
      el = document.createElement('div');
      el.className = 'tr';
      el.dataset.rid = r.id;
      el.style.animationDelay = (Math.min(i, 14) * 0.035) + 's';
      el.innerHTML = cols.map(cellTag).join('');
      el.dataset.sig = sig;
      scroll.appendChild(el);
    }

    if (el.dataset.sig !== sig) {
      el.innerHTML = cols.map(cellTag).join('');
      el.dataset.sig = sig;
    }

    const prev = lastCells.get(r.id) || {};
    const now = {};
    cols.forEach((c, ci) => {
      const cell = el.children[ci];
      if (!cell) return;
      const v = c.type === 'index' ? i : (r.cells ? r.cells[c.key] : '');
      now[c.key] = v;
      const changed = !isNew && knownRows.has(r.id) && prev[c.key] !== v;
      fillCell(cell, c, r, i, { primary: c.key === primary, changed });
    });
    lastCells.set(r.id, now);
    // 行首光条跟随进度状态：完成变绿，其余用主题色
    const pv = pcol ? Number(r.cells[pcol.key]) || 0 : 0;
    el.style.setProperty('--st', pcol && pv >= 100 ? 'var(--st-done)' : 'var(--ob-accent)');

    if (isNew && knownRows.size > 0) {
      el.classList.add('glow');
      setTimeout(() => el.classList.remove('glow'), 1700);
    }
    knownRows.add(r.id);
    scroll.appendChild(el); // 保证顺序与数据一致
  });

  for (const [id, el] of existing) {
    if (!keep.has(id)) {
      el.classList.add('leaving');
      lastCells.delete(id);
      knownRows.delete(id);
      setTimeout(() => el.remove(), 300);
    }
  }

  stretchRows(scroll, rows.length);
}

/** 行数少时把行高撑开铺满可视区，避免大屏下方一大片空白 */
function stretchRows(scroll, n, gapPx = 0) {
  const body = scroll.parentElement;
  if (!body || !n) return;
  const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 14;
  const usable = body.clientHeight - gapPx * (n - 1);
  const h = Math.max(base * 3.2, Math.min(base * 7.4, usable / n));
  scroll.style.setProperty('--row-h', Math.round(h) + 'px');
}

/* ═════════ 榜单版式 ═════════ */

function renderList(b) {
  const cols = visibleColumns(b);
  const pcol = cols.find((c) => c.type === 'progress');
  const texts = cols.filter((c) => c.type === 'text');
  const nameCol = texts[0] || null;
  const metaCols = texts.slice(1, 3);

  if (!pcol || !nameCol) { renderTable(b); return; }

  if (boardEl.dataset.mode !== 'list') {
    boardEl.className = 'board list';
    boardEl.innerHTML = '<div class="list-scroll"></div>';
    boardEl.dataset.mode = 'list';
    knownRows.clear();
    lastCells.clear();
  }

  const rows = [...(b.rows || [])].sort((a, c) =>
    (Number(c.cells[pcol.key]) || 0) - (Number(a.cells[pcol.key]) || 0));

  const scroll = boardEl.querySelector('.list-scroll');
  const existing = new Map();
  for (const el of [...scroll.children]) if (el.dataset.rid) existing.set(el.dataset.rid, el);
  const keep = new Set();

  rows.forEach((r, i) => {
    keep.add(r.id);
    let el = existing.get(r.id);
    const isNew = !el;
    if (isNew) {
      el = document.createElement('div');
      el.className = 'row-ob';
      el.dataset.rid = r.id;
      el.innerHTML =
        '<div class="row-rank"></div>' +
        '<div class="row-main"><div class="card-name"></div><div class="row-meta-mini"></div></div>' +
        '<div class="bar"><i></i></div><div class="pct"></div>';
      scroll.appendChild(el);
    }
    el.classList.toggle('top1', i === 0);
    el.classList.toggle('top2', i === 1);
    el.classList.toggle('top3', i === 2);
    el.querySelector('.row-rank').textContent = i + 1;
    el.querySelector('.card-name').textContent = r.cells[nameCol.key] || '—';
    el.querySelector('.row-meta-mini').innerHTML = metaCols
      .map((c) => `<span>${escapeHtml(r.cells[c.key] || '')}</span>`)
      .filter((s) => s !== '<span></span>').join('');
    const n = Math.max(0, Math.min(100, Number(r.cells[pcol.key]) || 0));
    const bar = el.querySelector('.bar i');
    bar.style.width = n + '%';
    bar.classList.toggle('done-stop', n >= 100);
    el.querySelector('.pct').textContent = n + '%';
    scroll.appendChild(el);
    knownRows.add(r.id);
  });

  for (const [id, el] of existing) {
    if (!keep.has(id)) {
      el.classList.add('leaving');
      knownRows.delete(id);
      setTimeout(() => el.remove(), 300);
    }
  }

  stretchRows(scroll, rows.length, (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 14) * 0.9);
}

function renderEmpty() {
  if (boardEl.dataset.mode !== 'empty') {
    boardEl.dataset.mode = 'empty';
    boardEl.className = 'board';
    boardEl.innerHTML = '<div class="empty-hint">等待数据 · NO DATA</div>';
  }
}

/* ═════════ 自动滚动（溢出时循环） ═════════ */

function stopMarquees() {
  marquees.forEach((m) => cancelAnimationFrame(m.raf));
  marquees.length = 0;
  document.querySelectorAll('.mq-vdup').forEach((n) => n.remove());
  document.querySelectorAll('.col-scroll, .list-scroll, .tbl-scroll').forEach((n) => {
    n.style.transform = '';
  });
}

function setupMarquees(speedSetting) {
  stopMarquees();
  if (!current.settings.autoScroll) return;
  const wrappers = boardEl.querySelectorAll('.col-body, .board.list, .tbl-body');
  wrappers.forEach((wrap) => {
    const inner = wrap.querySelector('.col-scroll, .list-scroll, .tbl-scroll');
    if (!inner || inner.scrollHeight <= wrap.clientHeight + 4) return;

    const dup = inner.cloneNode(true);
    dup.classList.add('mq-vdup');
    dup.style.paddingTop = '0';
    wrap.appendChild(dup);

    const pxPerMs = Math.max(8, Number(speedSetting) || 36) / 1000;
    const pauseUntil = performance.now() + 2600;
    const m = { raf: 0 };
    const state = { y: 0 };
    let lastT = 0;

    // 按真实时间推进（而不是按帧计数），窗口被节流时速度也一致
    function frame(t) {
      const dt = lastT ? Math.min(400, t - lastT) : 16.7;
      lastT = t;
      if (t > pauseUntil) {
        state.y += pxPerMs * dt;
        const half = inner.scrollHeight;
        if (state.y >= half) state.y -= half;
        inner.style.transform = `translateY(${-state.y}px)`;
        dup.style.transform = `translateY(${-state.y}px)`;
      }
      m.raf = requestAnimationFrame(frame);
    }
    marquees.push(m);
    m.raf = requestAnimationFrame(frame);
  });
}

/* ═════════ 底部字幕 ═════════ */

function renderTicker() {
  const wrap = $('#ticker');
  const inner = $('#tickerInner');
  const items = (current.settings.tickers || []).filter(Boolean);
  wrap.querySelectorAll('.mq-hdup').forEach((n) => n.remove());
  if (!items.length) {
    wrap.classList.add('hidden');
    inner.innerHTML = '';
    return;
  }
  wrap.classList.remove('hidden');
  inner.innerHTML = items.map((s) => `<span>${escapeHtml(s)}</span>`).join('');
  if (inner.scrollWidth > wrap.clientWidth) {
    const dup = inner.cloneNode(true);
    dup.classList.add('mq-hdup');
    dup.removeAttribute('id');
    wrap.appendChild(dup);
    const styleId = 'ticker-mq-style';
    if (!document.getElementById(styleId)) {
      const st = document.createElement('style');
      st.id = styleId;
      st.textContent = `
        #tickerInner { animation: tickerMove linear infinite; }
        @keyframes tickerMove { to { transform: translateX(-100%); } }`;
      document.head.appendChild(st);
    }
    inner.style.animationDuration = Math.max(12, inner.scrollWidth / 60) + 's';
    wrap.querySelector('.mq-hdup').style.animation = 'none';
  }
}

/* ═════════ 总渲染 ═════════ */

function render(b) {
  applyTheme(b.settings);

  $('#obTitle').textContent = b.title || 'YUHOX BOARD';
  $('#obSub').textContent = b.subtitle || '';
  $('#obSub').style.display = b.subtitle ? '' : 'none';
  $('#clockTime').style.display = b.settings.showClock ? '' : 'none';
  $('#clockDate').style.display = b.settings.showClock ? '' : 'none';

  $('#kpi').style.display = b.settings.showSummary ? '' : 'none';
  renderKpi(computeKpi(b));

  if (!b.rows || !b.rows.length) {
    renderEmpty();
  } else if (b.settings.layout === 'list') {
    renderList(b);
  } else {
    renderTable(b);
  }

  boardEl.classList.toggle('no-zebra', b.settings.zebra === false);
  renderTicker();
  requestAnimationFrame(() => setupMarquees(b.settings.scrollSpeed));
}
