/**
 * 端到端测试：连接已启动的 Electron（--remote-debugging-port=9333）
 *  1. 校验显示器枚举
 *  2. 启动 HTTP 推送接口，外部 POST 数据 → 回读校验
 *  3. 上屏到指定显示器，检查大屏窗口渲染结果
 *  4. 截图留档
 * 运行：node test/e2e.mjs
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 9333;
const API_PORT = 7799;

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

(async () => {
  const list = await targets();
  const controlTarget = list.find((t) => t.url.includes('renderer/control/index.html'));
  if (!controlTarget) throw new Error('控制台窗口没找到：' + JSON.stringify(list.map((t) => t.url)));
  const cdp = await connect(controlTarget.webSocketDebuggerUrl);
  console.log('✅ 控制台窗口已连接');

  const displays = await evalIn(cdp, 'window.yuhox.listDisplays()');
  console.log('✅ 显示器枚举：', displays.map((d) => `${d.index + 1}:${d.size}${d.primary ? '(主)' : ''}`).join(' | '));
  if (!displays.length) throw new Error('未枚举到显示器');

  const started = await evalIn(cdp, `window.yuhox.serverStart(${API_PORT})`);
  console.log('✅ 推送接口：', JSON.stringify(started.server), started.error || '');
  if (started.error) throw new Error('server start failed: ' + started.error);

  const payload = {
    title: '车间生产实时看板',
    subtitle: 'E2E · HTTP PUSH',
    tasks: [
      { name: '一号线装配', owner: '甲班', status: 'doing', progress: 82, note: '节拍 42s' },
      { name: '二号线焊接', owner: '乙班', status: 'doing', progress: 47 },
      { name: '物料齐套', owner: '仓储', status: 'done', progress: 100 },
      { name: '设备点检', owner: '设备科', status: 'blocked', progress: 20, note: '待备件' }
    ]
  };
  const pr = await fetch(`http://127.0.0.1:${API_PORT}/api/board`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const pj = await pr.json();
  console.log('✅ POST /api/board →', pr.status, 'tasks:', pj.data.tasks.length);

  const gr = await (await fetch(`http://127.0.0.1:${API_PORT}/api/board`)).json();
  if (gr.data.tasks.length !== 4 || gr.data.title !== payload.title) throw new Error('回读数据不一致');

  await wait(600);
  const domTitle = await evalIn(cdp, `document.querySelector('#inpTitle').value`);
  console.log('✅ 控制台已同步标题：', domTitle);
  await shot(cdp, 'control.png');

  // 上屏
  const targetDisplay = displays.find((d) => d.primary) || displays[0];
  const out = await evalIn(cdp, `window.yuhox.startOutput(${targetDisplay.id})`);
  console.log('✅ 上屏：', JSON.stringify(out.output), out.error || '');
  await wait(2200);

  const list2 = await targets();
  const outTarget = list2.find((t) => t.url.includes('renderer/output/index.html'));
  if (!outTarget) throw new Error('大屏输出窗口没找到');
  const ocdp = await connect(outTarget.webSocketDebuggerUrl);
  const cardCount = await evalIn(ocdp, `document.querySelectorAll('.card-ob').length`);
  const kpi = await evalIn(ocdp, `document.querySelector('#kpiDoing').textContent + '/' + document.querySelector('#kpiTotal').textContent`);
  console.log(`✅ 大屏渲染：卡片 ${cardCount} 张，进行中/总数 = ${kpi}`);
  if (cardCount !== 4) throw new Error('大屏卡片数量不对：' + cardCount);

  await shot(ocdp, 'screen-live.png');

  // 黑屏
  const black = await evalIn(cdp, `window.yuhox.setBlacked(true)`);
  await wait(700);
  const blacked = await evalIn(ocdp, `document.querySelector('#stage').classList.contains('blacked')`);
  console.log('✅ 黑屏待机：', blacked);
  if (!blacked) throw new Error('黑屏未生效');

  await evalIn(cdp, `window.yuhox.setBlacked(false)`);
  const stopped = await evalIn(cdp, `window.yuhox.stopOutput()`);
  console.log('✅ 撤屏：', JSON.stringify(stopped.output));

  await evalIn(cdp, `window.yuhox.serverStop()`);
  console.log('✅ 推送接口已停止');

  ocdp.close();
  cdp.close();
  console.log('\n🎉 E2E 全部通过');
  process.exit(0);
})().catch((e) => {
  console.error('\n❌ E2E 失败：', e.message);
  process.exit(1);
});
