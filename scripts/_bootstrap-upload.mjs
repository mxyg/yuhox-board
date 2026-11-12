/**
 * 一次性引导脚本：在本地 git 不可用的环境下，用 GitHub Git Data API 提交仓库首个版本。
 * 用法：GH_TOKEN=xxx node scripts/_bootstrap-upload.mjs
 * 不提交进仓库（.gitignore 已忽略）。
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OWNER = 'mxyg';
const REPO = 'yuhox-board';
const ROOT = path.join(__dirname, '..');
const TOKEN = process.env.GH_TOKEN;

if (!TOKEN) { console.error('缺少 GH_TOKEN'); process.exit(1); }

const SKIP_DIRS = new Set(['node_modules', 'release', 'dist', 'out', '.git', '.gittest', '.gittest2', '.workbuddy', '.github_stale']);
const SKIP_FILES = new Set(['package-lock.json'.replace('x', 'x')]); // 占位，不跳过任何单文件
const EXTS_SKIP = new Set(['.log']);

function walk(dir, rel = '') {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.git')) continue;
    const abs = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      out.push(...walk(abs, r));
    } else {
      if (SKIP_FILES.has(name)) continue;
      if (EXTS_SKIP.has(path.extname(name))) continue;
      if (name === '.DS_Store') continue;
      // 只保留必要的截图
      if (/^docs\/images\/(output-|control-)/.test(r)) continue;
      if (r.startsWith('test/') && r.endsWith('.png')) continue;
      out.push({ abs, path: r });
    }
  }
  return out;
}

async function api(p, method = 'GET', body) {
  const res = await fetch(`https://api.github.com${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'yuhox-board-bootstrap'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 300)}`);
  return json;
}

(async () => {
  // 1. 建仓（已存在则忽略）
  try {
    await api('/user/repos', 'POST', {
      name: REPO,
      description: '实时屏幕数据动态显示软件 · 任务进度大屏看板（Windows，开源免费，MIT）',
      homepage: `https://github.com/${OWNER}/${REPO}`,
      private: false,
      has_issues: true,
      has_wiki: false,
      auto_init: false
    });
    console.log('✅ 仓库已创建');
  } catch (e) {
    console.log('仓库已存在或创建失败，继续提交：', e.message.slice(0, 120));
  }

  // 2. 空仓不能直接建 blob：先用 contents API 落一个 .gitignore 作初始提交
  let head = null;
  try {
    const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/main`);
    head = ref.object.sha;
    console.log('→ 已有 main 分支，基于其上提交');
  } catch (_) {
    const init = await api(`/repos/${OWNER}/${REPO}/contents/.gitignore`, 'PUT', {
      message: 'chore: 初始化仓库',
      content: fs.readFileSync(path.join(ROOT, '.gitignore')).toString('base64')
    });
    head = init.commit.sha;
    console.log('✅ 初始化分支 main');
  }

  // 3. 上传 blob
  const files = walk(ROOT);
  console.log(`→ ${files.length} 个文件`);
  const tree = [];
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, 'POST', {
      content: buf.toString('base64'),
      encoding: 'base64'
    });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    console.log('  ·', f.path, `(${buf.length}B)`);
  }

  // 3. tree / commit / ref
  const t = await api(`/repos/${OWNER}/${REPO}/git/trees`, 'POST', { tree });
  const c = await api(`/repos/${OWNER}/${REPO}/git/commits`, 'POST', {
    message: 'feat: Yuhox Board 1.0.0 首个开源版本\n\n实时屏幕数据动态显示软件：控制台在主屏编排，画面全屏输出到指定显示器。\n三种实时数据通道（手动编辑 / HTTP 推送 / JSON 文件监听），泳道看板与进度榜单两种版式，\n粒子极光背景、数字滚动与进度过渡动效，黑屏待机、热插拔回落、防熄屏。',
    tree: t.sha,
    parents: head ? [head] : []
  });
  try {
    await api(`/repos/${OWNER}/${REPO}/git/refs`, 'POST', { ref: 'refs/heads/main', sha: c.sha });
  } catch (e) {
    await api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, 'PATCH', { sha: c.sha, force: true });
  }
  console.log('🎉 已提交:', c.sha);
  console.log(`https://github.com/${OWNER}/${REPO}`);
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
