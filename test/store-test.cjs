/**
 * 数据层测试（纯 Node，不需要 Electron 窗口）
 *
 * 用 Module._load 钩子把 require('electron') 换成一个只提供 app.getPath 的假对象，
 * 这样就能在普通 Node 里跑 store.js 的全部逻辑。
 *
 *   node test/store-test.cjs
 */
'use strict';

const Module = require('module');
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'yuhox-store-'));
const DATA_FILE = path.join(TMP, 'board.json');
process.env.YUHOX_BOARD_FILE = DATA_FILE;

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => TMP } };
  }
  return origLoad.apply(this, arguments);
};

const store = require('../src/main/store');

let pass = 0;
function ok(name, fn) {
  fn();
  pass++;
  console.log('  ✓ ' + name);
}

console.log('\n[1] 首次启动');
ok('默认设置：开机自启 / 恢复上屏都开着', () => {
  const s = store.getBoard().settings;
  assert.strictEqual(s.autoLaunch, true);
  assert.strictEqual(s.autoRestoreOutput, true);
  assert.strictEqual(s.fontScale, 1);
  assert.strictEqual(s.mobilePin, '');
});

ok('默认列结构：金宇建安小修作业 9 列，默认卡片版式', () => {
  const b = store.getBoard();
  assert.strictEqual(b.title, '金宇建安小修作业');
  assert.strictEqual(b.settings.layout, 'list');
  assert.deepStrictEqual(b.columns.map((c) => c.label), [
    '小队', '原井号', '施工项目', '区域', '施工进度',
    '新井号', '新施工项目', '新区域', '备注'
  ]);
  assert.strictEqual(b.rows.length, 18);
  assert.strictEqual(b.rows[0].cells.well, '杜813-34-45');
  assert.strictEqual(b.rows[0].cells.status, '完井');
  assert.strictEqual(b.rows[11].cells.status, '下机械堵水管完 待校深');
  assert.ok(b.dict.job.includes('重新完井'), '默认应带输入历史');
});

console.log('\n[2] 单格更新（手机遥控用）');
ok('rowPatch 只改目标单元格', () => {
  const before = store.getBoard();
  const target = before.rows[0];
  const other = before.rows[1];

  const r = store.updateBoard({ rowPatch: { id: target.id, cells: { status: '完井 交井' } } });
  assert.strictEqual(r.changed, true);
  const after = r.board;
  assert.strictEqual(after.rows[0].cells.status, '完井 交井');
  assert.strictEqual(after.rows[1].cells.status, other.cells.status, '别的行不能被动到');
});

ok('进度列的值被钳到 0–100', () => {
  const cols = store.getBoard().columns.concat([{ key: 'pct', label: '完成率', type: 'progress', width: 160 }]);
  store.updateBoard({ columns: cols });
  const id = store.getBoard().rows[0].id;
  let r = store.updateBoard({ rowPatch: { id, cells: { pct: '135%' } } });
  assert.strictEqual(r.board.rows[0].cells.pct, 100);
  r = store.updateBoard({ rowPatch: { id, cells: { pct: -8 } } });
  assert.strictEqual(r.board.rows[0].cells.pct, 0);
  store.updateBoard({ columns: cols.filter((c) => c.key !== 'pct') });
});

ok('不存在的行 id 不报错也不改数据', () => {
  const r = store.updateBoard({ rowPatch: { id: 'nope', cells: { status: 'x' } } });
  assert.strictEqual(r.changed, false);
});

console.log('\n[3] 设置与字典');
ok('fontScale / mobilePin / lastDisplayId 能存', () => {
  const r = store.updateBoard({ settings: { fontScale: 1.25, mobilePin: '2468', lastDisplayId: 12345 } });
  assert.strictEqual(r.board.settings.fontScale, 1.25);
  assert.strictEqual(r.board.settings.mobilePin, '2468');
  assert.strictEqual(r.board.settings.lastDisplayId, 12345);
});

ok('getSettings 不进深拷贝也能读到开关', () => {
  assert.strictEqual(store.getSettings().mobilePin, '2468');
});

ok('dictMerge 批量记忆', () => {
  const r = store.updateBoard({ dictMerge: { key: 'team', values: ['甲班', '乙班'] } });
  assert.strictEqual(r.board.dict.team[0], '乙班');
  assert.ok(r.board.dict.team.includes('甲班'));
});

console.log('\n[4] 重置与备份');
ok('清空数据保留列结构与设置', () => {
  const b = store.resetBoard('empty');
  assert.strictEqual(b.rows.length, 0);
  assert.strictEqual(b.columns.length, 9);
  assert.strictEqual(b.settings.mobilePin, '2468');
});

ok('恢复示例数据', () => {
  const b = store.resetBoard('sample');
  assert.ok(b.rows.length >= 5);
});

ok('数据文件落盘可读回', () => {
  const onDisk = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  assert.ok(Array.isArray(onDisk.columns));
  assert.ok(onDisk.rows.length >= 5);
});

ok('导入 JSON 整份替换，缺的设置回落默认', () => {
  const b = store.importBoard({
    title: '导入的看板',
    columns: [{ key: 'a', label: '甲', type: 'text', width: 200 }],
    rows: [{ id: 'x1', cells: { a: '甲值' } }],
    settings: { accent: '#ff0000' }
  });
  assert.strictEqual(b.title, '导入的看板');
  assert.strictEqual(b.columns.length, 1);
  assert.strictEqual(b.rows[0].cells.a, '甲值');
  assert.strictEqual(b.settings.accent, '#ff0000');
  assert.strictEqual(b.settings.autoLaunch, true, '没给的设置应该回落到默认值');
});

ok('二次启动留一份备份', () => {
  // 重新加载模块 = 模拟下次启动
  delete require.cache[require.resolve('../src/main/store')];
  const again = require('../src/main/store');
  again.getBoard();
  const dir = path.join(TMP, 'backup');
  const files = fs.readdirSync(dir);
  assert.ok(files.length >= 1, '应该有备份，实际：' + files.length);
  const latest = JSON.parse(fs.readFileSync(path.join(dir, files.sort().pop()), 'utf8'));
  assert.ok(Array.isArray(latest.columns));
});

console.log('\n[5] 旧版迁移');
ok('v1 tasks 自动迁移成五列', () => {
  const legacy = path.join(TMP, 'legacy.json');
  fs.writeFileSync(legacy, JSON.stringify({
    title: '老看板',
    tasks: [{ id: 't1', name: '焊接', owner: '二班', progress: 55, note: '注意防火' }]
  }), 'utf8');

  // 另起一份模块实例，指向 legacy 文件
  delete require.cache[require.resolve('../src/main/store')];
  const prev = process.env.YUHOX_BOARD_FILE;
  process.env.YUHOX_BOARD_FILE = legacy;
  const store2 = require('../src/main/store');
  const b = store2.getBoard();
  process.env.YUHOX_BOARD_FILE = prev;

  assert.strictEqual(b.version, 2);
  assert.strictEqual(b.title, '老看板');
  assert.strictEqual(b.rows.length, 1);
  assert.strictEqual(b.rows[0].cells.act, '焊接');
  assert.strictEqual(b.rows[0].cells.team, '二班');
  assert.strictEqual(b.rows[0].cells.prog, 55);
  assert.strictEqual(b.rows[0].cells.proc, '注意防火');
});

console.log('\n[6] 便携版路径');
ok('PORTABLE_EXECUTABLE_DIR 生效时数据跟着 exe 走', () => {
  const prev = process.env.YUHOX_BOARD_FILE;
  delete process.env.YUHOX_BOARD_FILE;
  process.env.PORTABLE_EXECUTABLE_DIR = path.join(TMP, 'Portable');

  delete require.cache[require.resolve('../src/main/store')];
  const store3 = require('../src/main/store');
  assert.strictEqual(store3.isPortable(), true);
  assert.strictEqual(store3.FILE(), path.join(TMP, 'Portable', 'YuhoxBoardData', 'board.json'));

  delete process.env.PORTABLE_EXECUTABLE_DIR;
  process.env.YUHOX_BOARD_FILE = prev;
});

console.log(`\n🎉 数据层测试通过（${pass} 项）\n`);
fs.rmSync(TMP, { recursive: true, force: true });
