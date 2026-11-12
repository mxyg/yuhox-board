/**
 * Yuhox Board · 大屏渲染
 * 两条数据通道：IPC（真实输出窗口）/ postMessage（控制台预览 iframe）。
 * 渲染策略：按任务 id 对账（新增滑入、字段原地过渡、缺失淡出），
 * 数字 KPI 做滚动补间，内容溢出时自动循环滚动。
 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const stage = $('#stage');
const boardEl = $('#board');

const STATUS = {
  todo: { label: '待启动', color: 'var(--st-todo)' },
  doing: { label: '进行中', color: 'var(--st-doing)' },
  done: { label: '已完成', color: 'var(--st-done)' },
  blocked: { label: '受阻', color: 'var(--st-blocked)' }
};

let current = null;              // 当前渲染的 board
let lastKpi = { total: 0, doing: 0, done: 0, overall: 0 };
const knownCardIds = new Set();  // 用于判断「新卡片」发光
const marquees = [];             // 活动的自动滚动 rAF
const previewMode = new URLSearchParams(location.search).has('preview');

/* ═════════ 数据通道 ═════════ */

if (!previewMode && window.yuhox) {
  window.yuhox.getBoard().then(applyBoard);
  window.yuhox.onBoardUpdated(applyBoard);
  window.yuhox.onOutputCmd((cmd) => {
    if (cmd.type === 'black') stage.classList.toggle('blacked', !!cmd.value);
  });
} else {
  // 预览模式：由控制台 postMessage 推送
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.type === 'yuhox-board' && d.board) applyBoard(d.board);
  });
}

function applyBoard(b) {
  if (!b) return;
  const prev = current;
  current = b;
  render(b, prev);
}

/* ═════════ 主题与设置 ═════════ */

function applyTheme(s) {
  const root = document.documentElement;
  root.style.setProperty('--ob-accent', s.accent || '#4f8cff');
  root.style.setProperty('--ob-accent2', s.accent2 || '#22d3ee');
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
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * DPR; cv.height = H * DPR;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const n = Math.min(90, Math.floor(W * H / 26000));
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
      if (d.x < -20) d.x = W + 20; if (d.x > W + 20) d.x = -20;
      if (d.y < -20) d.y = H + 20; if (d.y > H + 20) d.y = -20;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${accent[0]},${accent[1]},${accent[2]},${d.a})`;
      ctx.fill();
    }
    // 近距连线
    ctx.lineWidth = 0.5;
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const a = dots[i], b = dots[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < 15000) {
          const alpha = (1 - dist2 / 15000) * 0.08;
          ctx.strokeStyle = `rgba(${accent[0]},${accent[1]},${accent[2]},${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(frame);
  })();

  // 主题色变化时刷新粒子颜色
  setInterval(syncAccent, 2000);
  syncAccent();
}
startParticles();

/* ═════════ KPI 数字补间 ═════════ */

function tweenNumber(el, from, to, dur = 900, suffix = '') {
  const t0 = performance.now();
  (function step(t) {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * eased) + suffix;
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}

function computeKpi(tasks) {
  const total = tasks.length;
  const doing = tasks.filter((t) => t.status === 'doing' || t.status === 'blocked').length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const overall = total ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / total) : 0;
  return { total, doing, done, overall };
}

function renderKpi(kpi) {
  tweenNumber($('#kpiTotal'), lastKpi.total, kpi.total);
  tweenNumber($('#kpiDoing'), lastKpi.doing, kpi.doing);
  tweenNumber($('#kpiDone'), lastKpi.done, kpi.done);
  tweenNumber($('#kpiOverall'), lastKpi.overall, kpi.overall, 900, '%');
  $('#kpiRing').style.setProperty('--p', kpi.overall);
  // 三张卡的小进度条
  const max = Math.max(1, kpi.total);
  $('[data-kpi="total"] .kpi-spark i').style.width = '100%';
  $('[data-kpi="doing"] .kpi-spark i').style.width = (kpi.doing / max * 100) + '%';
  $('[data-kpi="done"] .kpi-spark i').style.width = (kpi.done / max * 100) + '%';
  lastKpi = kpi;
}

/* ═════════ 看板渲染 ═════════ */

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ownerChip(owner) {
  if (!owner) return '';
  const initial = escapeHtml(owner.slice(0, 1).toUpperCase());
  return `<span class="owner-chip"><b>${initial}</b>${escapeHtml(owner)}</span>`;
}

/** 卡片内部字段（新建时使用，进度条先 0 再过渡到目标值） */
function cardFields(t) {
  const st = STATUS[t.status] || STATUS.todo;
  const note = (current.settings.showNote && t.note)
    ? `<span class="card-note">${escapeHtml(t.note)}</span>` : '';
  const blocked = t.status === 'blocked' ? '<span class="blocked-flag">受阻</span>' : '';
  return `
    <div class="card-name">${escapeHtml(t.name)}</div>
    <div class="card-meta">${ownerChip(t.owner)}${note}${blocked}</div>
    <div class="bar-row">
      <div class="bar"><i class="${t.progress >= 100 ? 'done-stop' : ''}" style="width:0%"></i></div>
      <span class="pct">0%</span>
    </div>`;
}

/** 泳道卡片原地对账更新（保留元素，进度条走 CSS 过渡） */
function updateCardInPlace(el, t) {
  el.querySelector('.card-name').textContent = t.name;
  el.querySelector('.card-meta').innerHTML =
    ownerChip(t.owner) +
    ((current.settings.showNote && t.note) ? `<span class="card-note">${escapeHtml(t.note)}</span>` : '') +
    (t.status === 'blocked' ? '<span class="blocked-flag">受阻</span>' : '');
  const bar = el.querySelector('.bar i');
  bar.classList.toggle('done-stop', t.progress >= 100);
  bar.style.width = t.progress + '%';
  el.querySelector('.pct').textContent = t.progress + '%';
}

/** 卡片对账：容器内按 id 同步 DOM */
function reconcileCards(container, tasks, isRow) {
  const map = new Map();
  for (const el of [...container.children]) {
    if (el.dataset.tid) map.set(el.dataset.tid, el);
  }
  const keep = new Set();

  tasks.forEach((t) => {
    keep.add(t.id);
    let el = map.get(t.id);
    const isNew = !el;
    if (isNew) {
      el = document.createElement(isRow ? 'div' : 'div');
      el.className = isRow ? 'row-ob' : 'card-ob';
      el.style.setProperty('--st', (STATUS[t.status] || STATUS.todo).color);
      el.dataset.tid = t.id;
      container.appendChild(el);
    }
    if (isRow) {
      const idx = tasks.indexOf(t);
      el.classList.toggle('top1', idx === 0);
      el.classList.toggle('top2', idx === 1);
      el.classList.toggle('top3', idx === 2);
      // 榜单行 = 排名 + 名称 + 条 + 百分比
      if (!el.querySelector('.row-rank')) {
        el.innerHTML = `
          <div class="row-rank">${idx + 1}</div>
          <div class="row-main">
            <div class="card-name"></div>
            <div class="row-meta-mini"></div>
          </div>
          <div class="bar"><i></i></div>
          <div class="pct"></div>`;
        requestAnimationFrame(() => {
          const bi = el.querySelector('.bar i');
          if (bi) bi.style.width = t.progress + '%';
        });
      }
      el.querySelector('.row-rank').textContent = idx + 1;
      el.querySelector('.card-name').textContent = t.name;
      el.querySelector('.row-meta-mini').innerHTML =
        ownerChip(t.owner) +
        (current.settings.showNote && t.note ? `<span>${escapeHtml(t.note)}</span>` : '') +
        (t.status === 'blocked' ? '<span class="blocked-flag">受阻</span>' : '');
      const bi = el.querySelector('.bar i');
      bi.classList.toggle('done-stop', t.progress >= 100);
      bi.style.width = t.progress + '%';
      el.querySelector('.pct').textContent = t.progress + '%';
      // 榜单按进度排序：appendChild 把已有元素挪到正确位置
      container.appendChild(el);
    } else {
      // 泳道卡片：原地对账更新，进度条保留 CSS 过渡
      el.style.setProperty('--st', (STATUS[t.status] || STATUS.todo).color);
      if (el.querySelector('.bar i')) {
        updateCardInPlace(el, t);
        container.appendChild(el);
      } else {
        el.innerHTML = cardFields(t);
        container.appendChild(el);
        requestAnimationFrame(() => {
          const bi = el.querySelector('.bar i');
          if (bi) bi.style.width = t.progress + '%';
          const pct = el.querySelector('.pct');
          if (pct) pct.textContent = t.progress + '%';
        });
      }
    }
    if (isNew && !knownCardIds.has(t.id) && knownCardIds.size > 0) {
      el.classList.add('glow');
      setTimeout(() => el.classList.remove('glow'), 1700);
    }
  });

  // 移除消失的任务
  for (const [id, el] of map) {
    if (!keep.has(id)) {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 320);
    }
  }
}

function renderColumns(b, prev) {
  boardEl.className = 'board columns';
  if (boardEl.dataset.mode !== 'columns') {
    boardEl.innerHTML = '';
    boardEl.dataset.mode = 'columns';
  }
  const groups = [
    { key: 'todo', label: '待启动' },
    { key: 'doing', label: '进行中' },
    { key: 'done', label: '已完成' }
  ];
  // 受阻卡片并入「进行中」列，用红色状态标识
  const pick = (key) => b.tasks.filter((t) =>
    key === 'doing' ? (t.status === 'doing' || t.status === 'blocked')
      : key === 'done' ? t.status === 'done'
      : t.status === 'todo');

  groups.forEach((g, gi) => {
    let col = boardEl.children[gi];
    if (!col) {
      col = document.createElement('div');
      col.className = 'col';
      col.style.animation = `fadeUp .6s ${0.15 + gi * 0.08}s ease both`;
      col.innerHTML = `
        <div class="col-head">
          <div class="col-title"><i style="--st:${STATUS[g.key].color};background:${STATUS[g.key].color}"></i>${g.label}</div>
          <div class="col-count">0</div>
        </div>
        <div class="col-body"><div class="col-scroll"></div></div>`;
      boardEl.appendChild(col);
    }
    const tasks = pick(g.key);
    col.querySelector('.col-count').textContent = tasks.length;
    const body = col.querySelector('.col-body');
    reconcileCards(col.querySelector('.col-scroll'), tasks, false);
    // 空列占位，避免大片死黑
    let empty = body.querySelector('.col-empty');
    if (!tasks.length) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'col-empty';
        empty.textContent = '暂无任务';
        body.appendChild(empty);
      }
    } else if (empty) {
      empty.remove();
    }
  });
}

function renderList(b, prev) {
  boardEl.className = 'board list';
  if (boardEl.dataset.mode !== 'list') {
    boardEl.innerHTML = '<div class="list-scroll"></div>';
    boardEl.dataset.mode = 'list';
  }
  const tasks = [...b.tasks].sort((a, x) => x.progress - a.progress);
  reconcileCards(boardEl.querySelector('.list-scroll'), tasks, true);
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
  document.querySelectorAll('.col-scroll, .list-scroll').forEach((n) => { n.style.transform = ''; });
}

function setupMarquees(speedSetting) {
  stopMarquees();
  if (!current.settings.autoScroll) return;
  const wrappers = boardEl.querySelectorAll('.col-body, .board.list');
  wrappers.forEach((wrap) => {
    const inner = wrap.querySelector('.col-scroll, .list-scroll');
    if (!inner || inner.scrollHeight <= wrap.clientHeight + 4) return;
    const dup = inner.cloneNode(true);
    dup.classList.add('mq-vdup');
    wrap.appendChild(dup);
    const state = { y: 0 };
    const speed = Math.max(8, Number(speedSetting) || 36) / 60; // px per frame(60fps)
    // 数据更新后先停在开头 2.5 秒，让人看清新内容
    const pauseUntil = performance.now() + 2500;
    function frame(t) {
      if (t > pauseUntil) {
        state.y += speed;
        const half = inner.scrollHeight;
        if (state.y >= half) state.y -= half;
        inner.style.transform = `translateY(${-state.y}px)`;
        dup.style.transform = `translateY(${-state.y}px)`;
      }
      m.raf = requestAnimationFrame(frame);
    }
    const m = { raf: 0 };
    marquees.push(m);
    m.raf = requestAnimationFrame(frame);
  });
}

/* ═════════ 底部字幕 ═════════ */

function renderTicker() {
  const wrap = $('#ticker');
  const inner = $('#tickerInner');
  const items = (current.settings.tickers || []).filter(Boolean);
  if (!items.length) {
    wrap.classList.add('hidden');
    inner.innerHTML = '';
    return;
  }
  wrap.classList.remove('hidden');
  inner.innerHTML = items.map((s) => `<span>${escapeHtml(s)}</span>`).join('');
  // 无缝循环：内容不够宽就复制一份
  inner.querySelectorAll('.mq-hdup').forEach((n) => n.remove());
  if (inner.scrollWidth > wrap.clientWidth) {
    const dup = inner.cloneNode(true);
    dup.classList.add('mq-hdup');
    dup.removeAttribute('id');
    wrap.appendChild(dup);
    // 字幕跑马灯交给 CSS 动画
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

function render(b, prev) {
  applyTheme(b.settings);

  $('#obTitle').textContent = b.title || 'YUHOX BOARD';
  $('#obSub').textContent = b.subtitle || '';
  $('#obSub').style.display = b.subtitle ? '' : 'none';
  $('#clockTime').style.display = b.settings.showClock ? '' : 'none';
  $('#clockDate').style.display = b.settings.showClock ? '' : 'none';

  // KPI 总览开关
  $('#kpi').style.display = b.settings.showSummary ? '' : 'none';

  const kpi = computeKpi(b.tasks);
  renderKpi(kpi);

  if (!b.tasks.length) {
    renderEmpty();
  } else if (b.settings.layout === 'list') {
    renderList(b, prev);
  } else {
    renderColumns(b, prev);
  }

  renderTicker();
  requestAnimationFrame(() => setupMarquees(b.settings.scrollSpeed));
}
