/**
 * 界面静态检查（不开窗口）
 *
 * 抓两个最容易犯的错：
 *   1. 脚本里 $('#xxx') 写错 id —— 运行时直接 TypeError，窗口里才看得出来；
 *   2. HTML 里 id 重复 —— querySelector 只认第一个，后面的绑定全落空。
 *
 *   node test/ui-ids-test.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

const PAIRS = [
  {
    name: '控制台',
    js: path.join(ROOT, 'src/renderer/control/control.js'),
    html: path.join(ROOT, 'src/renderer/control/index.html')
  },
  {
    name: '大屏',
    js: path.join(ROOT, 'src/renderer/output/output.js'),
    html: path.join(ROOT, 'src/renderer/output/index.html')
  }
];

let checked = 0;

for (const page of PAIRS) {
  const js = fs.readFileSync(page.js, 'utf8');
  const html = fs.readFileSync(page.html, 'utf8');

  const ids = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);

  // 重复 id
  const seen = new Set();
  const dup = [];
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
    if (seen.has(m[1])) dup.push(m[1]);
    seen.add(m[1]);
  }
  assert.deepStrictEqual(dup, [], `${page.name} 有重复 id：${dup.join(', ')}`);

  // 脚本里引用的 id
  const missing = [];
  for (const m of js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)) {
    checked++;
    if (!ids.has(m[1])) missing.push(m[1]);
  }
  assert.deepStrictEqual([...new Set(missing)], [], `${page.name} 引用了不存在的 id：${[...new Set(missing)].join(', ')}`);

  // 脚本里 querySelector('#x') 也查一遍
  const missing2 = [];
  for (const m of js.matchAll(/querySelector\('#([A-Za-z0-9_-]+)'\)/g)) {
    checked++;
    if (!ids.has(m[1])) missing2.push(m[1]);
  }
  assert.deepStrictEqual([...new Set(missing2)], [], `${page.name} querySelector 引用了不存在的 id：${[...new Set(missing2)].join(', ')}`);

  console.log(`  ✓ ${page.name}：${ids.size} 个 id，全部对得上`);
}

console.log(`\n🎉 界面静态检查通过（${checked} 处引用）\n`);
