import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleApi } from './routes.js';
import { aiStatus } from './ai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  let filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    // SPA 回退到 index.html（保留深链）
    try {
      const body = await readFile(join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('Not found');
    }
  }
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, Object.fromEntries(url.searchParams));
      return;
    }
    await serveStatic(res, pathname);
  } catch (err) {
    console.error('[server]', err);
    try {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '服务器内部错误' }));
    } catch {}
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const server = createServer(handleRequest);
  let attempts = 12;
  const tryListen = () => {
    server.listen(PORT, () => {
      console.log(`\n  「先存着」AI 智能收藏夹已启动`);
      console.log(`  本机访问：http://localhost:${PORT}`);
      const lan = process.env.HOST_URL || '';
      if (lan) console.log(`  局域网/远程：${lan}`);
      console.log(`  数据库：data/app.db\n`);
      const ai = aiStatus();
      console.log(`  AI 模式：${ai.enabled ? `已启用（${ai.model}）` : '未启用（规则模式）'}`);
      if (!ai.enabled) {
        console.log('  提示：未配置 OPENAI_API_KEY，AI 摘要/搜索回答将使用规则模式（可后续配置启用）。\n');
      }
    });
  };
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts > 0) {
      attempts--;
      console.log(`端口 ${PORT} 仍被旧进程占用，等待释放后重试…`);
      setTimeout(tryListen, 700);
    } else {
      console.error('启动失败：', err.message);
      process.exit(1);
    }
  });
  tryListen();
}
