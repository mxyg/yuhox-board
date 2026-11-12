/**
 * 端到端测试：连接已启动的 Electron（--remote-debugging-port=9333）
 *  1. 显示器枚举 / HTTP 推送 / 上屏
 *  2. 控制台改单元格 → 主进程状态、大屏实时跟着变
 *  3. 新增列 / 改列头 / 拖拽行序 / 拖拽列序 / 拖列宽
 *  4. 输入自动补全（历史值）
 *  5. 截图留档
 * 运行：node test/e2e.mjs
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 9333;
const API_PORT = 7799;

const COLS = [
  { key: 'idx', label: '序号', type: 'index', width: 60, visible: true },
  { key: 'team', label: '施工队伍', type: 'text', width: 150, visible: true },
  { key: 'act', label: '施工动态', type: 'text', width: 290, visible: true },
  { key: 'prog', label: '施工进度', type: 'progress', width: 190, visible: true },
  { key: 'proc', label: '施工工序', type: 'text', width: 130, visible: true }
];

function seedBoard() {
  const raw = [
    ['一号施工队', '三层顶板钢筋绑扎', 72, '钢筋工程'],
    ['二号施工队', '地下室剪力墙模板安装', 55, '模板工程'],
    ['机电班', '一层桥架敷设与穿线', 38, '机电安装'],
    ['三号施工队', '二层梁板混凝土浇筑', 100, '混凝土工程'],
    ['防水班', '屋面防水卷材铺贴', 20, '防水工程']
  ];
  return {
    title: '施工动态总览',
    subtitle: 'E2E · 实时同步',
    columns: COLS,
    rows: raw.map((r, i) => ({
      id: 'r' + (i + 1),
      cells: { team: r[0], act: r[1], prog: r[2], proc: r[3] }
    })),
    dict: {
      team: ['一号施工队', '二号施工队', '三号施工队', '机电班', '防水班'],
      act: ['三层顶板钢筋绑扎', '地下室剪力墙模板安装', '一层桥架敷设与穿线'],
      proc: ['钢筋工程', '模板工程', '机电安装']
    },
    settings: {
      accent: '#4f8cff', accent2: '#22d3ee',
      showClock: true, showSummary: true, zebra: true, autoScroll: true,
      scrollSpeed: 40, layout: 'table', tickers: ['E2E 实时同步测试']
    }
  };
}

async function targets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`);
  return r.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () => resolve(api));
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      }
    });
    const api = {
      send(method, params) {
        return new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close: () => ws.close()
    };
  });
}

async function evalIn(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true
  });
  if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails.text));
  return r.result.value;
}

async function shot(cdp, file) {
  await cdp.send('Page.enable');
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const dir = path.join(__dirname, '../docs/images');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), Buffer.from(r.data, 'base64'));
  console.log('📸', file);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg) {
  if (!cond) throw new Error('断言失败：' + msg);
}

/** 轮询等待异步链路落定（IPC + 防抖 + 主进程广播） */
async function waitFor(fn, desc, timeout = 4000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await fn();
    if (last) return last;
    await wait(120);
  }
  throw new Error(`等待超时：${desc}（最后结果 ${JSON.stringify(last)}）`);
}

(async () => {
  const list = await targets();
  const controlTarget = list.find((t) => t.url.includes('renderer/control/index.html'));
  if (!controlTarget) throw new Error('控制台窗口没找到：' + JSON.stringify(list.map((t) => t.url)));
  const cdp = await connect(controlTarget.webSocketDebuggerUrl);
  console.log('✅ 控制台窗口已连接');

  const displays = await evalIn(cdp, 'window.yuhox.listDisplays()');
  console.log('✅ 显示器枚举：', displays.map((d) => `${d.index + 1}:${d.size}${d.primary ? '(主)' : ''}`).join(' | '));
  assert(displays.length > 0, '未枚举到显示器');

  // 铺一份确定的初始数据
  await evalIn(cdp, `window.yuhox.setBoard(${JSON.stringify(seedBoard())})`);
  await wait(500);

  // ── HTTP 推送（1.2.0 起服务随软件自启，优先沿用当前端口）
  const st0 = await evalIn(cdp, 'window.yuhox.getStatus()');
  let apiPort = st0.server && st0.server.running ? st0.server.port : 0;
  if (!apiPort) {
    const started = await evalIn(cdp, `window.yuhox.serverStart(${API_PORT})`);
    assert(!started.error, '推送接口启动失败：' + started.error);
    apiPort = API_PORT;
  }
  console.log('✅ 推送接口端口：', apiPort);
  const push = { rows: seedBoard().rows.map((r) => ({ id: r.id, cells: { ...r.cells } })) };
  push.rows[0].cells.prog = 80;
  const pr = await fetch(`http://127.0.0.1:${apiPort}/api/board`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(push)
  });
  const pj = await pr.json();
  console.log('✅ POST /api/board →', pr.status, '行数:', pj.data.rows.length, '进度:', pj.data.rows[0].cells.prog);
  assert(pj.data.rows[0].cells.prog === 80, 'HTTP 推送未生效');

  // ── 上屏
  const targetDisplay = displays.find((d) => d.primary) || displays[0];
  await evalIn(cdp, `window.yuhox.startOutput(${targetDisplay.id})`);
  await wait(2200);
  const list2 = await targets();
  const outTarget = list2.find((t) => t.url.includes('renderer/output/index.html'));
  assert(outTarget, '大屏输出窗口没找到');
  const ocdp = await connect(outTarget.webSocketDebuggerUrl);

  const trCount = await evalIn(ocdp, `document.querySelectorAll('.tr').length`);
  const thCount = await evalIn(ocdp, `document.querySelectorAll('.th').length`);
  console.log(`✅ 大屏表格：${trCount} 行 / ${thCount} 列`);
  assert(trCount === 5 && thCount === 5, `大屏列行数不对：${trCount}/${thCount}`);

  // ── 切到数据表面板
  await evalIn(cdp, `document.querySelectorAll('.nav-item')[1].click(); 'ok'`);
  await wait(500);

  // ── 控制台改单元格 → 大屏实时变
  const editKey = await evalIn(cdp, `(() => {
    const input = document.querySelector('#teBody .te-row .cell-input');
    input.value = '一号施工队（夜班）';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.dataset.key;
  })()`);
  await waitFor(async () => {
    const b = await evalIn(cdp, `window.yuhox.getBoard()`);
    return b.rows[0] && b.rows[0].cells[editKey] === '一号施工队（夜班）';
  }, '控制台编辑进主进程');
  const outCell = await evalIn(ocdp, `document.querySelector('.tr .td.txt').textContent`);
  console.log(`✅ 实时同步：控制台改了「${editKey}」，大屏显示「${outCell}」`);
  assert(outCell === '一号施工队（夜班）', '大屏没有跟着变');

  // ── 主标题 / 副标题（上屏控制页的快捷输入）
  await evalIn(cdp, `(() => {
    document.querySelectorAll('.nav-item')[0].click();
    const t = document.querySelector('#inpTitle2');
    t.value = '智慧工地 · 实时动态';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    const s2 = document.querySelector('#inpSubtitle2');
    s2.value = '辽宁昱弘 · 现场同步';
    s2.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(async () => {
    const b = await evalIn(cdp, `window.yuhox.getBoard()`);
    return b.title === '智慧工地 · 实时动态' && b.subtitle === '辽宁昱弘 · 现场同步';
  }, '标题副标题写入');
  const outTitle = await waitFor(async () => {
    const t = await evalIn(ocdp, `document.querySelector('#obTitle').textContent`);
    return t === '智慧工地 · 实时动态' ? t : null;
  }, '大屏标题同步');
  console.log('✅ 主副标题可改并实时上屏：', outTitle);
  await evalIn(cdp, `document.querySelectorAll('.nav-item')[1].click(); 'ok'`);
  await wait(400);

  // ── 自动补全
  const ac = await evalIn(cdp, `(() => {
    const input = document.querySelector('#teBody .te-row:nth-child(2) .cell-input');
    input.focus();
    input.value = '二号';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const pop = document.querySelector('#acPop');
    return { show: pop.classList.contains('show'), n: pop.querySelectorAll('.ac-item').length,
             first: pop.querySelector('.ac-item b') ? pop.querySelector('.ac-item b').textContent : '' };
  })()`);
  console.log('✅ 自动补全：', JSON.stringify(ac));
  assert(ac.show && ac.n > 0, '历史值没有弹出候选');
  await evalIn(cdp, `document.querySelector('#acPop .ac-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); 'ok'`);
  await wait(500);
  const filled = await evalIn(cdp, `document.querySelector('#teBody .te-row:nth-child(2) .cell-input').value`);
  assert(filled === ac.first, '补全没有填进输入框');
  console.log('✅ 选中候选后填入：', filled);

  // ── 新增列
  await evalIn(cdp, `(() => {
    const card = document.querySelector('#colCard');
    if (card.style.display === 'none') document.querySelector('#btnCols').click();
    document.querySelector('#inpNewCol').value = '作业区域';
    document.querySelector('#selNewColType').value = 'text';
    document.querySelector('#btnAddCol').click();
  })()`);
  const b2 = await waitFor(async () => {
    const b = await evalIn(cdp, `window.yuhox.getBoard()`);
    return b.columns.length === 6 && b.columns[5].label === '作业区域' ? b : null;
  }, '新增列');
  console.log('✅ 新增列 →', b2.columns.map((c) => c.label).join(' / '));

  // ── 改列头
  await evalIn(cdp, `(() => {
    const row = document.querySelectorAll('#colList .col-row')[5];
    const input = row.querySelector('.cr-label');
    input.value = '施工区域';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const b3 = await waitFor(async () => {
    const b = await evalIn(cdp, `window.yuhox.getBoard()`);
    return b.columns[5] && b.columns[5].label === '施工区域' ? b : null;
  }, '列头改名');
  console.log('✅ 改列头 →', b3.columns[5].label);

  // ── 拖拽列序：把最后一列拖到第 2 位
  await evalIn(cdp, `(() => {
    const rows = [...document.querySelectorAll('#colList .col-row')];
    const drag = rows[5];
    const handle = drag.querySelector('.drag');
    const dt = new DataTransfer();
    handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const over = rows[0];
    const rc = over.getBoundingClientRect();
    over.dispatchEvent(new DragEvent('dragover', {
      bubbles: true, dataTransfer: dt, clientX: rc.left + 20, clientY: rc.top + 2
    }));
    handle.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  })()`);
  const b4 = await waitFor(async () => {
    const b = await evalIn(cdp, `window.yuhox.getBoard()`);
    return b.columns[0] && b.columns[0].label === '施工区域' ? b : null;
  }, '列拖拽排序');
  console.log('✅ 拖拽列序 →', b4.columns.map((c) => c.label).join(' / '));

  // ── 拖拽行序：第 1 行拖到第 3 行之后
  const firstId = await evalIn(cdp, `(() => {
    const rows = [...document.querySelectorAll('#teBody .te-row')];
    const drag = rows[0];
    const handle = drag.querySelector('.drag');
    const dt = new DataTransfer();
    handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const over = rows[2];
    const rc = over.getBoundingClientRect();
    over.dispatchEvent(new DragEvent('dragover', {
      bubbles: true, dataTransfer: dt, clientX: rc.left + 20, clientY: rc.bottom - 2
    }));
    handle.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return rows.map((r) => r.dataset.id).join(',');
  })()`);
  const orderBefore = firstId.split(',');
  const b5 = await waitFor(async () => {
    const b = await evalIn(cdp, `window.yuhox.getBoard()`);
    return b.rows[0] && b.rows[0].id !== orderBefore[0] ? b : null;
  }, '行拖拽排序');
  const orderAfter = b5.rows.map((r) => r.id);
  console.log('✅ 拖拽行序 →', orderBefore.join('>'), '=>', orderAfter.join('>'));

  // ── 拖列宽：把第 2 列拖宽 60px
  const wBefore = b5.columns.map((c) => c.width);
  await evalIn(cdp, `(() => {
    const handles = document.querySelectorAll('.th-resize');
    const h = handles[1];
    const r = h.getBoundingClientRect();
    const x = r.left + 5;
    h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: x, clientY: r.top + 10 }));
    h.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: x + 60, clientY: r.top + 10 }));
    h.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: x + 60, clientY: r.top + 10 }));
  })()`);
  const b6 = await waitFor(async () => {
    const b = await evalIn(cdp, `window.yuhox.getBoard()`);
    return b.columns.some((c, i) => c.width !== wBefore[i]) ? b : null;
  }, '拖列宽');
  const wAfter = b6.columns.map((c) => c.width);
  console.log('✅ 拖列宽 →', wBefore.join('/'), '=>', wAfter.join('/'));

  // ── 大屏同步：列数/行数
  const th2 = await evalIn(ocdp, `document.querySelectorAll('.th').length`);
  const tr2 = await evalIn(ocdp, `document.querySelectorAll('.tr').length`);
  console.log(`✅ 大屏已同步：${tr2} 行 / ${th2} 列`);
  assert(th2 === 6, '大屏列数没同步');

  await wait(600);
  await shot(ocdp, 'screen-live.png');
  await evalIn(cdp, `window.yuhox.setBoard({ title: '施工动态总览' }); 'ok'`);
  await wait(400);
  await evalIn(cdp, `document.querySelector('.panels').scrollTop = 0; 'ok'`);
  await shot(cdp, 'control.png');

  // 黑屏
  await evalIn(cdp, `window.yuhox.setBlacked(true)`);
  await wait(600);
  const blacked = await evalIn(ocdp, `document.querySelector('#stage').classList.contains('blacked')`);
  assert(blacked, '黑屏未生效');
  console.log('✅ 黑屏待机');
  await evalIn(cdp, `window.yuhox.setBlacked(false)`);
  await evalIn(cdp, `window.yuhox.stopOutput()`);
  await evalIn(cdp, `window.yuhox.serverStop()`);
  console.log('✅ 撤屏、停止推送接口');

  ocdp.close();
  cdp.close();
  console.log('\n🎉 E2E 全部通过');
  process.exit(0);
})().catch((e) => {
  console.error('\n❌ E2E 失败：', e.message);
  if (process.env.E2E_STACK) console.error(e.stack);
  process.exit(1);
});
