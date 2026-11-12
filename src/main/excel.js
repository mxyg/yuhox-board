/**
 * Yuhox Board · Excel 导入 / 导出
 *
 * 导出：把当前看板按「列顺序」写成一张表，第一行是列头，序号列写成数字。
 * 导入：读出首个工作表，自动找表头行，原样返回二维数组交给控制台做列映射，
 *       这样"列头改了名字"或"表里多出几列"都能被识别，而不是死认固定字段。
 */
'use strict';

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const MAX_IMPORT_ROWS = 3000;

/** 导出：columns 里可见的列都写出去 */
function exportBoard(board, filePath) {
  const cols = (board.columns || []).filter((c) => c.visible !== false);
  const header = cols.map((c) => c.label);
  const aoa = [header];

  (board.rows || []).forEach((r, i) => {
    aoa.push(cols.map((c) => {
      if (c.type === 'index') return i + 1;
      const v = r.cells ? r.cells[c.key] : '';
      if (c.type === 'progress') {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      }
      return v == null ? '' : String(v);
    }));
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = cols.map((c) => ({
    wch: Math.max(8, Math.min(50, Math.round((Number(c.width) || 200) / 9)))
  }));
  // 进度列显示成百分比，方便在 Excel 里直接看
  cols.forEach((c, ci) => {
    if (c.type !== 'progress') return;
    for (let ri = 1; ri < aoa.length; ri++) {
      const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
      if (ws[addr]) ws[addr].z = '0"%"';
    }
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '施工动态');
  XLSX.writeFile(wb, filePath, { bookType: 'xlsx' });
  return { file: filePath, rows: (board.rows || []).length, columns: cols.length };
}

/** 在前 6 行里挑"非空单元格最多"的一行当表头，容忍上面有标题行 */
function pickHeaderRow(aoa) {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(aoa.length, 6);
  for (let i = 0; i < limit; i++) {
    const score = (aoa[i] || []).filter((v) => String(v == null ? '' : v).trim() !== '').length;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

function readSheet(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let wb;
  if (ext === '.csv' || ext === '.txt') {
    // CSV 按 UTF-8 读，否则中文会变乱码（SheetJS 默认按二进制解码）
    let txt = fs.readFileSync(filePath, 'utf8');
    if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1);
    wb = XLSX.read(txt, { type: 'string', raw: true });
  } else {
    wb = XLSX.readFile(filePath, { cellDates: false });
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('工作簿里没有工作表');
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });

  if (!aoa.length) throw new Error('工作表是空的');

  const hIdx = pickHeaderRow(aoa);
  const rawHeader = aoa[hIdx] || [];
  const header = rawHeader.map((v) => String(v == null ? '' : v).trim());

  // 去掉尾部空列
  let end = header.length - 1;
  while (end >= 0 && !header[end]) end--;
  header.length = end + 1;

  const rows = aoa
    .slice(hIdx + 1)
    .filter((line) => (line || []).some((v) => String(v == null ? '' : v).trim() !== ''))
    .slice(0, MAX_IMPORT_ROWS)
    .map((line) => header.map((_, i) => {
      const v = line[i];
      if (v == null) return '';
      return typeof v === 'number' ? v : String(v).trim();
    }));

  return { sheetName, header, rows, headerRow: hIdx + 1 };
}

module.exports = { exportBoard, readSheet };
