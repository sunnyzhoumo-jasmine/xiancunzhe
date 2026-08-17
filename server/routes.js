import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db, now, daysAgoISO, parseTags } from './db.js';
import { hashPassword, verifyPassword, createSession, destroySession, userFromSession, userFromApiToken, publicUser, ensureApiToken } from './auth.js';
import { extractUrl, detectPlatform, fetchDocument, parseHtml, parseXiaohongshu, inferType, summarizeText, generateTitle, isGenericTitle, PARSE_STATUS } from './parser.js';
import { aiEnabled, enrichContent, answerSearch } from './ai.js';
import { isKnowledgeType, generateCandidatesFor, createCard, listCards, setCardStatus, updateCard, reviewSession, recordReview, randomConfirmedCard, cardView } from './cards.js';

const SESSION_COOKIE = 'xc_session';
const MAX_PAGE = 100;

// 启动一个新的服务进程并退出当前进程（网页重启）
function restartServer() {
  try {
    const entry = fileURLToPath(new URL('./index.js', import.meta.url));
    const cwd = fileURLToPath(new URL('..', import.meta.url));
    const child = spawn(process.execPath, [entry], { detached: true, stdio: 'inherit', cwd, env: process.env });
    child.unref();
    setTimeout(() => process.exit(0), 600);
  } catch (err) {
    console.error('[restart] 重启失败：', err.message);
  }
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 2_000_000) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function cookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token) {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`);
}

function clearSessionCookie(res) {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

async function requireUser(req, res) {
  const session = userFromSession(cookies(req)[SESSION_COOKIE]);
  if (session) return session;
  const token = req.headers['x-auth-token'];
  if (token) {
    const api = userFromApiToken(token);
    if (api) return api;
  }
  json(res, 401, { error: '请先登录' });
  return null;
}

function collectionView(row) {
  if (!row) return null;
  let meta = {};
  try { meta = JSON.parse(row.meta_json || '{}'); } catch {}
  return {
    id: row.id,
    url: row.url,
    platform: row.platform,
    title: row.title,
    author: row.author,
    type: row.type,
    summary: row.summary,
    cover: row.cover,
    note: row.note,
    parseStatus: row.parse_status,
    useStatus: row.use_status,
    tags: parseTags(row.tags),
    keyPoints: meta.keyPoints || [],
    images: meta.images || [],
    video: meta.video || null,
    parseError: meta.error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    openedAt: row.opened_at,
    lastViewedAt: row.last_viewed_at,
    cardCount: row.card_count || 0,
    lastReviewAt: row.last_review_at || null,
  };
}

function detailView(row) {
  const v = collectionView(row);
  if (!v) return null;
  v.parsedText = row.parsed_text ? row.parsed_text.slice(0, 20000) : null;
  return v;
}

// ---------- 异步处理 ----------

const processing = new Set();

export async function processCollection(collectionId) {
  if (processing.has(collectionId)) return;
  processing.add(collectionId);
  const task = db.prepare(`
    INSERT INTO processing_tasks (user_id, collection_id, kind, status, created_at, updated_at)
    VALUES (0, ?, 'parse', 'running', ?, ?)
  `).run(collectionId, now(), now());
  const taskId = Number(task.lastInsertRowid);
  try {
    const col = db.prepare('SELECT * FROM collections WHERE id = ?').get(collectionId);
    if (!col) return;
    db.prepare('UPDATE collections SET parse_status = ?, updated_at = ? WHERE id = ?').run(PARSE_STATUS.RUNNING, now(), collectionId);

    let title = col.title;
    let summary = col.summary;
    let parsedText = col.parsed_text;
    let type = col.type;
    let author = col.author;
    let cover = col.cover;
    let tags = parseTags(col.tags);
    let meta = {};
    try { meta = JSON.parse(col.meta_json || '{}'); } catch {}
    let status = PARSE_STATUS.PARTIAL;
    let platform = col.platform;
    let parseError = null;

    if (col.url) {
      try {
        const fetched = await fetchDocument(col.url);
        if (fetched.notHtml) {
          status = PARSE_STATUS.PARTIAL;
          parseError = '该链接不是普通网页（可能是图片、文件或 App 专用链接），已先保存下来';
          if (!title) title = fetched.finalUrl ? new URL(fetched.finalUrl).hostname : col.url;
          if (!platform) platform = detectPlatform(col.url);
        } else {
          const xhs = parseXiaohongshu(fetched.html);
          if (xhs) {
            title = meta.userTitle ? title : (xhs.title || title);
            author = xhs.author || author;
            cover = xhs.cover || cover;
            platform = '小红书';
            parsedText = xhs.desc || '';
            summary = summarizeText(parsedText);
            meta.images = xhs.images || [];
            if (xhs.video) meta.video = xhs.video;
            tags = [...new Set([...tags, ...(xhs.tags || [])])];
            status = parsedText.length >= 40 ? PARSE_STATUS.FULL : PARSE_STATUS.PARTIAL;
            if (status === PARSE_STATUS.PARTIAL) {
              parseError = '只读取到标题和少量文字，正文可能需要在 App 内查看或需要登录';
            }
          } else {
            const parsed = parseHtml(fetched.html, fetched.finalUrl || col.url);
            title = meta.userTitle ? title : (parsed.title || title);
            author = parsed.author || author;
            cover = parsed.image || cover;
            platform = parsed.platform || platform;
            parsedText = parsed.text || '';
            summary = summarizeText(parsedText || parsed.description);
            meta.images = [...new Set([...(meta.images || []), ...(parsed.images || [])])].slice(0, 12);
            if (parsed.video) meta.video = parsed.video;
            status = parsed.text && parsed.text.length >= 100 ? PARSE_STATUS.FULL : PARSE_STATUS.PARTIAL;
            if (status === PARSE_STATUS.PARTIAL) {
              parseError = '只读取到标题和少量文字，正文可能需要在 App 内查看或需要登录';
            }
          }
        }
      } catch (err) {
        status = PARSE_STATUS.FAILED;
        parseError = `抓取失败：${String(err.message || err).slice(0, 120)}。链接已保存，可补充备注或粘贴正文`;
        if (!title) title = col.url;
        if (!platform) platform = detectPlatform(col.url);
      }
    } else {
      const text = (col.parsed_text || col.note || col.title || '').trim();
      parsedText = text;
      if (!meta.userTitle) title = generateTitle(text) || title;
      if (text.length >= 40) {
        status = PARSE_STATUS.MANUAL;
        summary = summarizeText(text);
      } else {
        status = PARSE_STATUS.MANUAL;
        summary = '';
      }
      if (!title) title = text.slice(0, 60) || '无标题';
    }

    if (!meta.userTitle && isGenericTitle(title)) {
      title = generateTitle(parsedText || summary) || title;
    }

    if (parseError) meta.error = parseError;

    if (aiEnabled() && status !== PARSE_STATUS.FAILED) {
      try {
        const enriched = await enrichContent({ title, text: parsedText || summary, platform, url: col.url });
        if (enriched) {
          title = meta.userTitle ? title : (enriched.title || title);
          type = enriched.type || inferType(`${title} ${parsedText} ${summary}`);
          tags = enriched.tags.length ? enriched.tags : tags;
          summary = enriched.summary || summary;
          meta.keyPoints = enriched.keyPoints || [];
        }
      } catch {}
    }
    if (!meta.userType && (!type || type === '未分类')) {
      type = inferType(`${title} ${parsedText} ${summary}`);
    }

    db.prepare(`
      UPDATE collections SET title = ?, summary = ?, parsed_text = ?, type = ?, author = ?, cover = ?, tags = ?, meta_json = ?,
        parse_status = ?, platform = ?, updated_at = ? WHERE id = ?
    `).run(title, summary, parsedText, type, author, cover, JSON.stringify(tags), JSON.stringify(meta), status, platform, now(), collectionId);

    db.prepare("UPDATE processing_tasks SET status = 'done', updated_at = ? WHERE id = ?").run(now(), taskId);

    if ((status === PARSE_STATUS.FULL || status === PARSE_STATUS.MANUAL) && isKnowledgeType(type)) {
      const fresh = db.prepare('SELECT * FROM collections WHERE id = ?').get(collectionId);
      try { await generateCandidatesFor(fresh); } catch {}
    }
  } catch (err) {
    const errMsg = String(err.message || err).slice(0, 500);
    db.prepare(`
      UPDATE collections SET parse_status = ?, meta_json = ?, updated_at = ? WHERE id = ?
    `).run(PARSE_STATUS.FAILED, JSON.stringify({ error: `解析出错：${errMsg}` }), now(), collectionId);
    db.prepare("UPDATE processing_tasks SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
      .run(errMsg, now(), taskId);
  } finally {
    processing.delete(collectionId);
  }
}

function enqueue(collectionId) {
  queueMicrotask(() => processCollection(collectionId).catch(() => {}));
}

// ---------- 路由 ----------

export async function handleApi(req, res, pathname, query) {
  const method = req.method;
  const parts = pathname.replace(/^\/api/, '').split('/').filter(Boolean);
  const seg = parts[0] || '';
  const id = Number(parts[1] || 0);
  const sub = parts[2] || '';

  // 认证
  if (method === 'POST' && pathname === '/api/auth/register') {
    const body = await readJson(req);
    const account = String(body.account || '').trim();
    const password = String(body.password || '');
    if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(account)) return json(res, 400, { error: '账号需为 2-32 位字母、数字或 . _ -' });
    if (password.length < 6) return json(res, 400, { error: '密码至少 6 位' });
    if (db.prepare('SELECT id FROM users WHERE account = ?').get(account)) return json(res, 409, { error: '账号已存在' });
    const token = randomBytes(24).toString('hex');
    const r = db.prepare('INSERT INTO users (account, nickname, password_hash, api_token, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(account, String(body.nickname || account).slice(0, 20), hashPassword(password), token, now());
    setSessionCookie(res, createSession(Number(r.lastInsertRowid)));
    const user = db.prepare('SELECT * FROM users WHERE account = ?').get(account);
    return json(res, 200, { user: publicUser(user) });
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readJson(req);
    const user = db.prepare('SELECT * FROM users WHERE account = ?').get(String(body.account || '').trim());
    if (!user || !verifyPassword(String(body.password || ''), user.password_hash)) return json(res, 401, { error: '账号或密码错误' });
    setSessionCookie(res, createSession(user.id));
    return json(res, 200, { user: publicUser(user) });
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    destroySession(cookies(req)[SESSION_COOKIE]);
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/me') {
    const user = await requireUser(req, res);
    if (!user) return;
    if (method === 'DELETE') {
      db.prepare('DELETE FROM collections WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM cards WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM review_records WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM sets WHERE user_id = ?').run(user.id);
      return json(res, 200, { ok: true, message: '个人数据已清空' });
    }
    if (method === 'POST') {
      const body = await readJson(req);
      if (body.nickname !== undefined) {
        db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(String(body.nickname).slice(0, 20), user.id);
      }
    }
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    let prefs = {};
    try { prefs = JSON.parse(fresh.prefs || '{}'); } catch {}
    return json(res, 200, { user: publicUser(fresh), prefs, aiEnabled: aiEnabled(), apiToken: ensureApiToken(fresh) });
  }

  const user = await requireUser(req, res);
  if (!user) return;
  const uid = user.id;

  if (method === 'POST' && pathname === '/api/shortcut') {
    return createCollection(uid, await readJson(req), res);
  }

  // ---------- 收藏 ----------
  if (seg === 'collections' && !id && parts[1] !== 'batch') {
    if (method === 'POST') return createCollection(uid, await readJson(req), res);
    if (method === 'GET') {
      const q = String(query.q || '').trim();
      const type = String(query.type || '').trim();
      const use = String(query.use || '').trim();
      const parse = String(query.parse || '').trim();
      const sort = String(query.sort || 'recent');
      const page = Math.max(1, Number(query.page || 1) || 1);
      const perPage = Math.min(MAX_PAGE, Math.max(1, Number(query.perPage || 20) || 20));
      const conditions = ['user_id = ?'];
      const params = [uid];
      if (q) {
        conditions.push('(title LIKE ? OR parsed_text LIKE ? OR note LIKE ? OR author LIKE ? OR tags LIKE ? OR url LIKE ?)');
        const like = `%${q}%`;
        params.push(like, like, like, like, like, like);
      }
      if (type) { conditions.push('type = ?'); params.push(type); }
      if (use) { conditions.push('use_status = ?'); params.push(use); }
      if (parse) { conditions.push('parse_status = ?'); params.push(parse); }
      const where = conditions.join(' AND ');
      const order = sort === 'oldest' ? 'created_at ASC' : sort === 'updated' ? 'updated_at DESC' : 'created_at DESC';
      const total = db.prepare(`SELECT COUNT(*) AS n FROM collections WHERE ${where}`).get(...params).n;
      const rows = db.prepare(`
        SELECT c.*,
          (SELECT COUNT(*) FROM cards k WHERE k.collection_id = c.id AND k.status != '已删除') AS card_count,
          (SELECT MAX(r.reviewed_at) FROM review_records r JOIN cards k2 ON k2.id = r.card_id WHERE k2.collection_id = c.id) AS last_review_at
        FROM collections c WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?
      `).all(...params, perPage, (page - 1) * perPage);
      const counts = {};
      for (const r of db.prepare('SELECT type, COUNT(*) AS n FROM collections WHERE user_id = ? GROUP BY type').all(uid)) counts[r.type] = r.n;
      return json(res, 200, { items: rows.map(collectionView), total, page, perPage, counts });
    }
    return json(res, 404, { error: '方法不支持' });
  }

  if (seg === 'collections' && parts[1] === 'batch' && method === 'POST') {
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : [];
    const action = String(body.action || '');
    if (!ids.length || !['archive', 'delete', 'read', 'later'].includes(action)) return json(res, 400, { error: '参数错误' });
    const placeholders = ids.map(() => '?').join(',');
    if (action === 'delete') {
      db.prepare(`DELETE FROM collections WHERE user_id = ? AND id IN (${placeholders})`).run(uid, ...ids);
      db.prepare(`DELETE FROM cards WHERE user_id = ? AND collection_id IN (${placeholders})`).run(uid, ...ids);
    } else {
      const status = action === 'archive' ? '已归档' : action === 'read' ? '已读' : '稍后处理';
      db.prepare(`UPDATE collections SET use_status = ?, updated_at = ? WHERE user_id = ? AND id IN (${placeholders})`)
        .run(status, now(), uid, ...ids);
    }
    return json(res, 200, { ok: true });
  }

  if (seg === 'collections' && id && method === 'GET') {
    const row = db.prepare('SELECT * FROM collections WHERE id = ? AND user_id = ?').get(id, uid);
    if (!row) return json(res, 404, { error: '收藏不存在' });
    return json(res, 200, { item: detailView(row) });
  }

  if (seg === 'collections' && id && method === 'PATCH') {
    const row = db.prepare('SELECT * FROM collections WHERE id = ? AND user_id = ?').get(id, uid);
    if (!row) return json(res, 404, { error: '收藏不存在' });
    const body = await readJson(req);
    const fields = {};
    for (const k of ['title', 'summary', 'note', 'author', 'platform', 'type', 'use_status']) {
      if (body[k] !== undefined) fields[k] = String(body[k]);
    }
    if (body.tags !== undefined) fields.tags = JSON.stringify(Array.isArray(body.tags) ? body.tags.map(String).slice(0, 20) : []);
    if (body.title !== undefined) {
      const meta = JSON.parse(row.meta_json || '{}');
      meta.userTitle = true;
      fields.meta_json = JSON.stringify(meta);
    }
    if (Object.keys(fields).length) {
      const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE collections SET ${sets}, updated_at = ? WHERE id = ?`).run(...Object.values(fields), now(), id);
    }
    const fresh = db.prepare('SELECT * FROM collections WHERE id = ? AND user_id = ?').get(id, uid);
    return json(res, 200, { item: collectionView(fresh) });
  }

  if (seg === 'collections' && id && method === 'DELETE') {
    db.prepare('DELETE FROM collections WHERE id = ? AND user_id = ?').run(id, uid);
    db.prepare('DELETE FROM cards WHERE collection_id = ? AND user_id = ?').run(id, uid);
    return json(res, 200, { ok: true });
  }

  if (seg === 'collections' && id && method === 'POST') {
    if (sub === 'reparse') {
      const row = db.prepare('SELECT * FROM collections WHERE id = ? AND user_id = ?').get(id, uid);
      if (!row) return json(res, 404, { error: '收藏不存在' });
      enqueue(id);
      return json(res, 200, { ok: true });
    }
    if (sub === 'open') {
      db.prepare('UPDATE collections SET opened_at = COALESCE(opened_at, ?), last_viewed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(now(), now(), now(), id, uid);
      return json(res, 200, { ok: true });
    }
    if (sub === 'cards' && parts[3] === 'generate') {
      const row = db.prepare('SELECT * FROM collections WHERE id = ? AND user_id = ?').get(id, uid);
      if (!row) return json(res, 404, { error: '收藏不存在' });
      const force = Boolean((await readJson(req)).force);
      return json(res, 200, await generateCandidatesFor(row, { force }));
    }
    return json(res, 404, { error: '未知操作' });
  }

  // ---------- 搜索 ----------
  if (pathname === '/api/search' && method === 'GET') {
    const q = String(query.q || '').trim();
    if (!q) return json(res, 200, { items: [] });
    const like = `%${q}%`;
    const rows = db.prepare(`
      SELECT * FROM collections WHERE user_id = ? AND (title LIKE ? OR parsed_text LIKE ? OR note LIKE ? OR author LIKE ? OR tags LIKE ? OR url LIKE ?)
      ORDER BY created_at DESC LIMIT 30
    `).all(uid, like, like, like, like, like, like);
    return json(res, 200, { items: rows.map(collectionView), ai: false });
  }

  if (pathname === '/api/search/nl' && method === 'GET') {
    const q = String(query.q || '').trim();
    if (!q) return json(res, 200, { items: [], answer: null });
    const like = `%${q}%`;
    const rows = db.prepare(`
      SELECT * FROM collections WHERE user_id = ? AND (title LIKE ? OR parsed_text LIKE ? OR note LIKE ? OR tags LIKE ?)
      ORDER BY created_at DESC LIMIT 10
    `).all(uid, like, like, like, like);
    let answer = null;
    if (aiEnabled() && rows.length) {
      try { answer = await answerSearch(q, rows); } catch {}
    }
    return json(res, 200, { items: rows.map(collectionView), answer, ai: aiEnabled() });
  }

  // ---------- 发现 ----------
  if (pathname === '/api/discover' && method === 'GET') {
    const week = db.prepare('SELECT * FROM collections WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 10').all(uid, daysAgoISO(7)).map(collectionView);
    const neverOpened = db.prepare('SELECT * FROM collections WHERE user_id = ? AND opened_at IS NULL ORDER BY created_at DESC LIMIT 10').all(uid).map(collectionView);
    const stale = db.prepare(`
      SELECT * FROM collections WHERE user_id = ? AND opened_at IS NOT NULL
      AND (last_viewed_at IS NULL OR last_viewed_at < ?) ORDER BY last_viewed_at ASC LIMIT 10
    `).all(uid, daysAgoISO(30)).map(collectionView);
    const random = db.prepare('SELECT * FROM collections WHERE user_id = ? ORDER BY RANDOM() LIMIT 8').all(uid).map(collectionView);
    const later = db.prepare("SELECT * FROM collections WHERE user_id = ? AND use_status = '稍后处理' ORDER BY created_at DESC LIMIT 10").all(uid).map(collectionView);
    const topics = [];
    const groups = db.prepare('SELECT type, COUNT(*) AS n FROM collections WHERE user_id = ? GROUP BY type ORDER BY n DESC LIMIT 6').all(uid);
    for (const g of groups) {
      const items = db.prepare('SELECT * FROM collections WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT 4').all(uid, g.type).map(collectionView);
      topics.push({ type: g.type, count: g.n, items });
    }
    return json(res, 200, { week, neverOpened, stale, random, later, topics });
  }

  // ---------- 收藏集 ----------
  if (seg === 'sets' && !id && method === 'GET') {
    const sets = db.prepare('SELECT * FROM sets WHERE user_id = ? ORDER BY created_at DESC').all(uid);
    const out = sets.map((s) => ({
      id: s.id,
      name: s.name,
      count: db.prepare('SELECT COUNT(*) AS n FROM set_members WHERE set_id = ?').get(s.id).n,
      items: db.prepare(`
        SELECT col.* FROM set_members sm JOIN collections col ON col.id = sm.collection_id
        WHERE sm.set_id = ? AND col.user_id = ? ORDER BY sm.rowid DESC LIMIT 30
      `).all(s.id, uid).map(collectionView),
    }));
    return json(res, 200, { sets: out });
  }

  if (seg === 'sets' && !id && method === 'POST') {
    const body = await readJson(req);
    const name = String(body.name || '').trim().slice(0, 30);
    if (!name) return json(res, 400, { error: '名称不能为空' });
    const r = db.prepare('INSERT INTO sets (user_id, name, created_at) VALUES (?, ?, ?)').run(uid, name, now());
    return json(res, 200, { id: Number(r.lastInsertRowid) });
  }

  if (seg === 'sets' && id && method === 'DELETE') {
    db.prepare('DELETE FROM sets WHERE id = ? AND user_id = ?').run(id, uid);
    db.prepare('DELETE FROM set_members WHERE set_id = ?').run(id);
    return json(res, 200, { ok: true });
  }

  if (seg === 'sets' && id && method === 'POST' && sub === 'members') {
    const body = await readJson(req);
    const collectionId = Number(body.collectionId || 0);
    if (!collectionId) return json(res, 400, { error: '缺少 collectionId' });
    if (body.add !== false) {
      db.prepare('INSERT OR IGNORE INTO set_members (set_id, collection_id) VALUES (?, ?)').run(id, collectionId);
    } else {
      db.prepare('DELETE FROM set_members WHERE set_id = ? AND collection_id = ?').run(id, collectionId);
    }
    return json(res, 200, { ok: true });
  }

  // ---------- 知识卡片 ----------
  if (seg === 'cards' && !id && method === 'GET') {
    const status = String(query.status || '').trim() || null;
    return json(res, 200, { items: await listCards(uid, status) });
  }

  if (seg === 'cards' && !id && method === 'POST') {
    const body = await readJson(req);
    const collectionId = Number(body.collectionId) || 0;
    const r = createCard(uid, collectionId, body);
    return json(res, r.ok ? 200 : 400, r);
  }

  if (seg === 'cards' && id && method === 'PATCH') {
    const r = updateCard(uid, id, await readJson(req));
    return json(res, r.ok ? 200 : 404, r);
  }

  if (seg === 'cards' && id && method === 'POST' && sub === 'status') {
    const r = await setCardStatus(uid, id, String((await readJson(req)).status || ''));
    return json(res, r.ok ? 200 : 404, r);
  }

  // ---------- 回顾 ----------
  if (pathname === '/api/review/session' && method === 'GET') {
    return json(res, 200, { items: reviewSession(uid) });
  }

  if (seg === 'review' && id && method === 'POST') {
    const feedback = String((await readJson(req)).feedback || '');
    if (!['忘了', '模糊', '记得', '很熟'].includes(feedback)) return json(res, 400, { error: '反馈无效' });
    const r = recordReview(uid, id, feedback);
    return json(res, r.ok ? 200 : 404, r);
  }

  // ---------- 统计与导出 ----------
  if (pathname === '/api/stats' && method === 'GET') {
    const total = db.prepare('SELECT COUNT(*) AS n FROM collections WHERE user_id = ?').get(uid).n;
    const candidate = db.prepare("SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND status = '候选中'").get(uid).n;
    const confirmed = db.prepare("SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND status IN ('已确认','计划中')").get(uid).n;
    const due = reviewSession(uid).length;
    const reviewedCount = db.prepare('SELECT COUNT(*) AS n FROM review_records WHERE user_id = ?').get(uid).n;
    const weekReviews = db.prepare('SELECT COUNT(*) AS n FROM review_records WHERE user_id = ? AND reviewed_at >= ?').get(uid, daysAgoISO(7)).n;
    const reviewTrend = db.prepare(`
      SELECT date(reviewed_at, 'localtime') AS day, COUNT(*) AS count
      FROM review_records
      WHERE user_id = ? AND reviewed_at >= ?
      GROUP BY date(reviewed_at, 'localtime')
      ORDER BY day
    `).all(uid, daysAgoISO(6));
    const recentlyConfirmed = db.prepare(`
      SELECT c.*, col.title, col.url FROM cards c
      JOIN collections col ON col.id = c.collection_id
      WHERE c.user_id = ? AND c.confirmed_at IS NOT NULL
      ORDER BY c.confirmed_at DESC LIMIT 5
    `).all(uid).map(cardView);
    const recentReviews = db.prepare(`
      SELECT r.id, r.feedback, r.reviewed_at, r.next_review_at, k.question, k.kind, col.title, col.id AS collection_id
      FROM review_records r
      JOIN cards k ON k.id = r.card_id
      JOIN collections col ON col.id = k.collection_id
      WHERE r.user_id = ?
      ORDER BY r.reviewed_at DESC LIMIT 5
    `).all(uid);
    const recentContent = db.prepare('SELECT * FROM collections WHERE user_id = ? ORDER BY created_at DESC LIMIT 5').all(uid).map(collectionView);
    const weakCards = db.prepare(`
      SELECT k.id, k.question, k.kind, col.title,
        COUNT(*) AS attempts, MAX(r.reviewed_at) AS last_reviewed_at
      FROM review_records r
      JOIN cards k ON k.id = r.card_id
      JOIN collections col ON col.id = k.collection_id
      WHERE r.user_id = ? AND r.feedback IN ('忘了', '模糊')
      GROUP BY k.id
      ORDER BY last_reviewed_at DESC
      LIMIT 6
    `).all(uid);
    return json(res, 200, { total, candidate, confirmed, due, reviewedCount, weekReviews, reviewTrend, weakCards, recentlyConfirmed, recentReviews, recentContent });
  }

  if (pathname === '/api/me/prefs' && method === 'POST') {
    const body = await readJson(req);
    let prefs = {};
    try { prefs = JSON.parse(user.prefs || '{}'); } catch {}
    if (body.reviewCount) prefs.reviewCount = Math.min(20, Math.max(1, Number(body.reviewCount) || 5));
    db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(prefs), user.id);
    return json(res, 200, { ok: true, prefs });
  }

  if (pathname === '/api/me/account' && method === 'DELETE') {
    db.prepare('DELETE FROM collections WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM cards WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM review_records WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM sets WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    clearSessionCookie(res);
    return json(res, 200, { ok: true, message: '账号已注销' });
  }

  if (pathname === '/api/review/random' && method === 'GET') {
    return json(res, 200, { card: randomConfirmedCard(uid) });
  }

  if (pathname === '/api/admin/restart' && method === 'POST') {
    restartServer();
    return json(res, 200, { ok: true, message: '正在重启…' });
  }

  if (pathname === '/api/export' && method === 'GET') {
    const data = {
      exportedAt: now(),
      user: publicUser(user),
      collections: db.prepare('SELECT * FROM collections WHERE user_id = ? ORDER BY id').all(uid).map(collectionView),
      cards: await listCards(uid),
      reviewRecords: db.prepare('SELECT * FROM review_records WHERE user_id = ? ORDER BY reviewed_at').all(uid),
    };
    const body = JSON.stringify(data, null, 2);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="xiancunzhe-export.json"' });
    res.end(body);
    return;
  }

  return json(res, 404, { error: '接口不存在' });
}

async function createCollection(uid, body, res) {
  const url = extractUrl(body.url);
  const text = String(body.text || '').trim();
  const note = String(body.note || '').trim();
  const userTitle = String(body.title || '').trim().slice(0, 100);
  const userType = ['概念', '方法', '事实', '工作经验', '课程笔记', '其他'].includes(body.type) ? String(body.type) : '';
  if (!url && !text) {
    const msg = String(body.url || '').trim() ? '链接格式不正确，请直接粘贴网址（含 http 或 www）' : '请输入正文内容，或粘贴来源链接';
    return json(res, 400, { error: msg });
  }

  if (url) {
    const dup = db.prepare('SELECT id FROM collections WHERE user_id = ? AND url = ?').get(uid, url);
    if (dup && !body.force) {
      const existing = db.prepare('SELECT * FROM collections WHERE id = ?').get(dup.id);
      return json(res, 200, { duplicate: true, collection: collectionView(existing), message: '这条链接已经收藏过' });
    }
  }

  const metaObj = {};
  if (userTitle) metaObj.userTitle = true;
  if (userType) metaObj.userType = true;
  if (text && !url) metaObj.userProvided = true;
  const meta = JSON.stringify(metaObj);
  const r = db.prepare(`
    INSERT INTO collections (user_id, url, platform, title, type, note, parsed_text, meta_json, parse_status, use_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '待解析', '未读', ?, ?)
  `).run(uid, url, url ? detectPlatform(url) : null, userTitle || (text ? text.slice(0, 60) : null), userType || null, note, url ? null : text || null, meta, now(), now());
  const id = Number(r.lastInsertRowid);
  enqueue(id);
  const fresh = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  return json(res, 200, { saved: true, duplicate: false, collection: collectionView(fresh) });
}
