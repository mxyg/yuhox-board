/**
 * Yuhox Board · 本地 HTTP 实时推送接口
 *
 *   GET  /api/board          读取当前看板
 *   POST /api/board          全量/部分更新（title / subtitle / rows / columns / settings / rowPatch）
 *   GET  /api/health         健康检查
 *   GET  /m                  手机遥控页（同一 Wi-Fi 下手机浏览器打开即可改数据）
 *   GET  /                   302 → /m
 *
 * CORS 全开，方便网页端直接 POST。控制台里设了口令时，/api/board 需要带
 * `x-board-pin` 请求头（手机页会自动带），/m 本身不受限（只是静态页）。
 */
'use strict';

const http = require('http');
const fs = require('fs');

const MAX_BODY = 2 * 1024 * 1024; // 2MB

function createBoardServer({ port, onUpdate, onLog, getPin, pagePath }) {
  let server = null;
  let actualPort = port;

  function send(res, code, data) {
    const body = JSON.stringify(data);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-board-pin',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(new Error('invalid JSON: ' + e.message)); }
      });
      req.on('error', reject);
    });
  }

  /** 口令校验：没设口令就全开；设了就必须带对 */
  function pinOk(req, url) {
    let pin = '';
    try { pin = String((getPin && getPin()) || ''); } catch (_) {}
    if (!pin) return true;
    const given = req.headers['x-board-pin'] || url.searchParams.get('pin') || '';
    return String(given) === pin;
  }

  function sendPage(res) {
    try {
      const html = fs.readFileSync(pagePath);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('手机页资源缺失：' + e.message);
    }
  }

  function start() {
    return new Promise((resolve, reject) => {
      if (server) return resolve(actualPort);
      server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (req.method === 'OPTIONS') return send(res, 204, {});
        try {
          /* ── 手机遥控页 ── */
          if (req.method === 'GET' && (url.pathname === '/m' || url.pathname === '/m/')) {
            return sendPage(res);
          }
          if (req.method === 'GET' && url.pathname === '/') {
            res.writeHead(302, { Location: '/m' });
            return res.end();
          }

          /* ── 状态 ── */
          if (req.method === 'GET' && url.pathname === '/api/health') {
            return send(res, 200, {
              code: 0,
              data: {
                ok: true, name: 'yuhox-board', port: actualPort,
                pinRequired: !!String((getPin && getPin()) || ''),
                mobile: true
              }
            });
          }

          /* ── 数据（受口令保护） ── */
          if (url.pathname === '/api/board') {
            if (!pinOk(req, url)) return send(res, 401, { code: 401, message: '需要口令' });
            if (req.method === 'GET') {
              return send(res, 200, { code: 0, data: onUpdate({ read: true }) });
            }
            if (req.method === 'POST') {
              const patch = await readBody(req);
              const r = onUpdate({ patch });
              return send(res, 200, { code: 0, data: r.board, changed: r.changed });
            }
          }

          send(res, 404, { code: 404, message: 'not found' });
        } catch (e) {
          send(res, 400, { code: 400, message: e.message });
        }
      });
      server.on('error', (e) => {
        server = null;
        reject(e);
      });
      server.listen(actualPort, '0.0.0.0', () => {
        onLog && onLog('server listening on ' + actualPort);
        resolve(actualPort);
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!server) return resolve();
      const s = server;
      server = null;
      s.close(() => resolve());
    });
  }

  function status() {
    return { running: !!server, port: actualPort };
  }

  return { start, stop, status, get port() { return actualPort; }, set port(p) { actualPort = p; } };
}

module.exports = { createBoardServer };
