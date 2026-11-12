/**
 * Excel 读写回归：导出 → 读回，校验表头、行数、进度数值、自动找表头行。
 * 运行：node test/excel-test.mjs
 */
'use strict';

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const excel = require('../src/main/excel.js');
const XLSX = require('xlsx');

const board = {
  columns: [
    { key: 'idx', label: '序号', type: 'index', width: 60, visible: true },
    { key: 'team', label: '施工队伍', type: 'text', width: 150, visible: true },
    { key: 'act', label: '施工动态', type: 'text', width: 290, visible: true },
    { key: 'prog', label: '施工进度', type: 'progress', width: 190, visible: true },
    { key: 'proc', label: '施工工序', type: 'text', width: 130, visible: true }
  ],
  rows: [
    { id: 'r1', cells: { team: '一号施工队', act: '三层顶板钢筋绑扎', prog: 72, proc: '钢筋工程' } },
    { id: 'r2', cells: { team: '机电班', act: '一层桥架敷设与穿线', prog: 38, proc: '机电安装' } },
    { id: 'r3', cells: { team: '三号施工队', act: '二层梁板混凝土浇筑', prog: 100, proc: '混凝土工程' } }
  ]
};

const out = path.join(os.tmpdir(), 'yuhox-board-test.xlsx');
const r = excel.exportBoard(board, out);
console.log('导出：', r.rows, '行 /', r.columns, '列 →', r.file);
if (!fs.existsSync(out)) throw new Error('导出文件不存在');

const back = excel.readSheet(out);
console.log('读回表头：', back.header.join(' | '));
console.log('读回行数：', back.rows.length, '表头行：', back.headerRow);

if (back.header.join('|') !== '序号|施工队伍|施工动态|施工进度|施工工序') {
  throw new Error('表头不一致：' + back.header.join('|'));
}
if (back.rows.length !== 3) throw new Error('行数不一致：' + back.rows.length);
if (String(back.rows[0][3]) !== '72') throw new Error('进度值不一致：' + back.rows[0][3]);
if (back.rows[2][0] !== 3) throw new Error('序号列不是数字：' + back.rows[2][0]);

// 表头上方带一行大标题也要能认出来
const wb = XLSX.utils.book_new();
const aoa = [['施工日报表'], [], back.header, ...back.rows];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
const out2 = path.join(os.tmpdir(), 'yuhox-board-test-title.xlsx');
XLSX.writeFile(wb, out2);
const back2 = excel.readSheet(out2);
console.log('带标题行：表头行 =', back2.headerRow, '/ 表头 =', back2.header.join('|'), '/ 行数 =', back2.rows.length);
if (back2.headerRow !== 2 || back2.rows.length !== 3) throw new Error('标题行识别失败');

// 缺表头的 CSV 也要能读
const csvPath = path.join(os.tmpdir(), 'yuhox-board-test.csv');
fs.writeFileSync(csvPath, '施工队伍,施工动态,施工进度\n班组A,支模,55\n班组B,绑筋,90\n', 'utf8');
const back3 = excel.readSheet(csvPath);
console.log('CSV：', back3.header.join('|'), '/ 行数 =', back3.rows.length);
if (back3.rows.length !== 2) throw new Error('CSV 读取失败');

console.log('\n🎉 Excel 导入导出测试通过');
