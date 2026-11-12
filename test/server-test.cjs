/**
 * HTTP 接口测试（纯 Node，不起窗口）
 *
 *   node test/server-test.cjs
 *
 * 覆盖：/m 手机页、/ 跳转、/api/health、/api/board 读写、口令校验、CORS 预检、404。
 */
'use strict';

const path = require('path');
const assert = require('assert');
const { createBoardServer } = require('../src/main/server');

const PORT = 7811;
const BASE = `http://127.0.0.1:${PORT}`;

const board = {
  title: '施工动态总览',
  subtitle: '',
  columns: [
    { key: 'idx', label: '序号', type: 'index', width: 60, visible: true },
    { key: 'team', label: '施工队伍', type: 'text', width: 150, visible: true },
    { key: 'prog', label: '施工进度', type: 'progress', width: 190, visible: true }
  ],
  rows: [{ id: 'r1', cells: { team: '一号队', prog: 40 } }],
  settings: { mobilePin: '' }
};

let pin = '';

const server = createBoardServer({
  port: PORT,
  pagePath: path.join(__dirname, '../src/main/mobile.html'),
  getPin: () => pin,
  onUpdate: ({ patch, read }) => {
    if (read) return board;
    if (patch && patch.rowPatch) {
      const row = board.rows.find((r) => r.id === patch.rowPatch.id);
      if (row) Object.assign(row.cells, patch.rowPatch.cells);
      return { board, changed: !!row };
    }
    Object.assign(board, patch || {});
    return { board, changed: true };
  }
});

const results = [];
async function ok(name, fn) {
  await fn();
  results.push(name);
  console.log('  ✓ ' + name);
}
const section = (t) => console.log('\n' + t);

(async () => {
  await server.start();

  section('[1] 手机页');
  let html = '';
  await ok('/m 返回手机遥控页', async () => {
    const res = await fetch(BASE + '/m');
    assert.strictEqual(res.status, 200);
    assert.ok((res.headers.get('content-type') || '').includes('text/html'));
    html = await res.text();
    assert.ok(html.includes('现场遥控'), '页面标题应存在');
    assert.ok(html.includes('/api/board'), '页面应调用接口');
  });

  await ok('根路径 302 跳到 /m', async () => {
    const res = await fetch(BASE + '/', { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/m');
  });

  section('[2] 健康检查');
  await ok('/api/health 报告手机能力', async () => {
    const body = await (await fetch(BASE + '/api/health')).json();
    assert.strictEqual(body.data.ok, true);
    assert.strictEqual(body.data.mobile, true);
    assert.strictEqual(body.data.pinRequired, false);
  });

  section('[3] 读写');
  await ok('GET 读回看板', async () => {
    const body = await (await fetch(BASE + '/api/board')).json();
    assert.strictEqual(body.data.title, '施工动态总览');
  });

  await ok('POST rowPatch 改一格', async () => {
    const body = await (await fetch(BASE + '/api/board', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowPatch: { id: 'r1', cells: { prog: 77 } } })
    })).json();
    assert.strictEqual(body.data.rows[0].cells.prog, 77);
  });

  section('[4] 口令');
  pin = '2468';
  await ok('未带口令 401', async () => {
    assert.strictEqual((await fetch(BASE + '/api/board')).status, 401);
  });
  await ok('口令错误 401', async () => {
    const res = await fetch(BASE + '/api/board', { headers: { 'x-board-pin': '0000' } });
    assert.strictEqual(res.status, 401);
  });
  await ok('请求头带对口令 200', async () => {
    const res = await fetch(BASE + '/api/board', { headers: { 'x-board-pin': '2468' } });
    assert.strictEqual(res.status, 200);
  });
  await ok('查询串带口令 200', async () => {
    assert.strictEqual((await fetch(BASE + '/api/board?pin=2468')).status, 200);
  });
  await ok('手机页本身不受口令限制', async () => {
    assert.strictEqual((await fetch(BASE + '/m')).status, 200);
  });

  section('[5] CORS 与异常');
  await ok('OPTIONS 预检放行自定义头', async () => {
    const res = await fetch(BASE + '/api/board', { method: 'OPTIONS' });
    assert.strictEqual(res.status, 204);
    assert.ok((res.headers.get('access-control-allow-headers') || '').includes('x-board-pin'));
  });
  await ok('未知路径 404', async () => {
    assert.strictEqual((await fetch(BASE + '/api/nope')).status, 404);
  });
  await ok('坏 JSON 返回 400 而不是崩', async () => {
    const res = await fetch(BASE + '/api/board', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-board-pin': '2468' },
      body: '{oops'
    });
    assert.strictEqual(res.status, 400);
  });

  await server.stop();
  console.log(`\n🎉 HTTP 接口测试通过（${results.length} 项）\n`);
})().catch(async (e) => {
  console.error('\n❌', e.message);
  try { await server.stop(); } catch (_) {}
  process.exit(1);
});
