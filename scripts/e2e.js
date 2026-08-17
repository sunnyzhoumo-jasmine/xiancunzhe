process.env.DATA_DIR = '/tmp/xc_e2e';
const { rmSync } = await import('node:fs');
rmSync('/tmp/xc_e2e', { recursive: true, force: true });

const { handleRequest } = await import('../server/index.js');

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); };

let cookie = '';
function req(method, path, body, headers = {}) {
  const r = {
    method, url: path, headers: { ...headers },
    destroy() {}, on(ev, cb) {
      if (ev === 'data' && body !== undefined) cb(typeof body === 'string' ? body : JSON.stringify(body));
      if (ev === 'end') cb();
    },
  };
  return r;
}
function res() {
  const r = { status: 0, headers: {}, body: '' };
  r.writeHead = (s, h) => { r.status = s; Object.assign(r.headers, h || {}); };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (b) => { r.body = b || ''; };
  return r;
}
async function call(method, path, body) {
  const r = res();
  await handleRequest(req(method, path, body, cookie ? { cookie } : {}), r);
  if (r.headers['set-cookie']) cookie = r.headers['set-cookie'].split(';')[0];
  let json = null; try { json = JSON.parse(r.body); } catch {}
  return { status: r.status, json, res: r };
}

// 静态页
let r = await call('GET', '/');
assert(r.status === 200 && r.res.headers['content-type'].includes('text/html') && r.res.body.includes('先存着'), '首页 HTML 返回');
r = await call('GET', '/app.js');
assert(r.status === 200 && r.res.body.includes('boot()'), 'app.js 返回');
r = await call('GET', '/style.css');
assert(r.status === 200 && r.res.body.includes(':root'), 'style.css 返回');
r = await call('GET', '/favicon.ico');
assert(r.status === 200, 'SPA 回退（favicon → index.html）');

// 未登录访问 API
r = await call('GET', '/api/collections');
assert(r.status === 401, '未登录被拒绝');

// 注册 + 全链路
r = await call('POST', '/api/auth/register', { account: 'e2e', password: 'test123' });
assert(r.status === 200, '注册');
r = await call('POST', '/api/collections', { text: '间隔重复记忆法：在快忘记的时候复习效果最好。新知识一天后复习一次，之后间隔逐渐拉长到三天、七天、十五天。这是让长期记忆牢固的核心方法。' });
assert(r.status === 200 && r.json.saved, '添加文本收藏');
const id = r.json.collection.id;
await new Promise((res) => setTimeout(res, 1500));
r = await call('GET', `/api/collections/${id}`);
assert(r.json.item.parseStatus === '已保存正文', '异步解析完成（已保存正文）');
r = await call('GET', '/api/discover');
assert(r.json.week.length === 1 && r.json.neverOpened.length === 1, '发现页数据');
r = await call('GET', '/api/search?q=间隔重复');
assert(r.json.items.length === 1, '搜索命中');

console.log(process.exitCode ? '\n有失败项' : '\n端到端全部通过 ✓');
