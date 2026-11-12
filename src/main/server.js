/**
 * Yuhox Board · 本地 HTTP 实时推送接口
 *
 * 外部系统（脚本、MES、爬虫、表格工具……）把任务数据实时推到大屏：
 *   GET  /api/board          读取当前看板
 *   POST /api/board          全量/部分更新（title / subtitle / tasks / settings）
 *   GET  /api/health         健康检查
 *
 * CORS 全开，方便网页端直接 POST。
 */
'use strict';

const http = require('http');

const MAX_BODY = 2 * 1024 * 1024; // 2MB

function createBoardServer({ port, onUpdate, onLog }) {
  let server = null;
  let actualPort = port;

  function send(res, code, data) {
    const body = JSON.stringify(data);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
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

  function start() {
    return new Promise((resolve, reject) => {
      if (server) return resolve(actualPort);
      server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (req.method === 'OPTIONS') return send(res, 204, {});
        try {
          if (req.method === 'GET' && url.pathname === '/api/board') {
            return send(res, 200, { code: 0, data: onUpdate({ read: true }) });
          }
          if (req.method === 'GET' && url.pathname === '/api/health') {
            return send(res, 200, { code: 0, data: { ok: true, name: 'yuhox-board', port: actualPort } });
          }
          if (req.method === 'POST' && url.pathname === '/api/board') {
            const patch = await readBody(req);
            const r = onUpdate({ patch });
            return send(res, 200, { code: 0, data: r.board, changed: r.changed });
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
