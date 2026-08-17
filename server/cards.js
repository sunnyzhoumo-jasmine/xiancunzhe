import { db, now, daysLaterISO } from './db.js';
import { aiEnabled, generateCardsAI } from './ai.js';

// 这些类型明显不是适合记忆卡的内容；其余类型（包括模型返回的“知识”“教程/工具”“其他”）都允许尝试生成。
const NON_KNOWLEDGE_TYPES = ['软件/商品', '消费/地点', '旅行/美食', '菜谱/书影音/灵感'];
const CARD_STATUS = { CANDIDATE: '候选中', CONFIRMED: '已确认', PLANNED: '计划中', PAUSED: '已暂停', ARCHIVED: '已归档', DELETED: '已删除' };
const FEEDBACK_INTERVALS = { 忘了: 1, 模糊: 3, 记得: 7, 很熟: 15 };

export function isKnowledgeType(type) {
  return !NON_KNOWLEDGE_TYPES.includes(String(type || '').trim());
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[。！？!?；;])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 120);
}

// 规则兜底：无 AI 时也生成带问题的回顾卡
export function generateCardsRules({ title, summary, text }) {
  const cards = [];
  const src = String(summary || text || '').replace(/\s+/g, ' ').trim();
  const sentences = splitSentences(src);
  const points = sentences.slice(0, 5);
  if (points.length >= 2) {
    cards.push({
      kind: '问答',
      question: `${title || '这条知识'}的核心知识点是什么？`,
      answer: points.join('；'),
      points: [],
      sourceSnippet: points[0].slice(0, 120),
    });
  }
  // 概念卡：从定义句式「X 是指 / 是一种 / 属于 …」生成
  const def = src.match(/(.{2,20}?)(?:是指|指的是|是一种|是种|属于|定义为)(.{8,})/);
  if (def && cards.length < 3) {
    cards.push({
      kind: '概念',
      question: `${def[1].trim().slice(0, 20)}是什么？`,
      answer: def[2].trim().slice(0, 200),
      points: [],
      sourceSnippet: def[0].slice(0, 120),
    });
  }
  // 填空卡：从句子里挖掉一个关键短语（数字或词），挖空部分作为答案
  for (const s of sentences) {
    if (cards.length >= 3) break;
    const blank = pickBlank(s);
    if (!blank) continue;
    const q = s.replace(blank.phrase, '____');
    if (q === s) continue;
    cards.push({ kind: '填空', question: q.trim(), answer: blank.phrase, points: [], sourceSnippet: s.slice(0, 120) });
  }
  const first = sentences[0];
  if (!cards.length && first) {
    cards.push({
      kind: '问答',
      question: title ? `${title}的核心内容是什么？` : '这条收藏的核心内容是什么？',
      answer: first,
      points: [],
      sourceSnippet: first.slice(0, 120),
    });
  }
  return cards.slice(0, 3);
}

// 挑一句里最值得挖空的关键短语：优先数字，其次长度适中的词
function pickBlank(s) {
  const nums = s.match(/\d+(?:\.\d+)?[^，。！？!?；;\s]{0,2}/g);
  if (nums && nums.length) return { phrase: nums[0] };
  const cleaned = s.trim();
  if (cleaned.length < 12) return null;
  const mid = cleaned.slice(Math.floor(cleaned.length * 0.25), Math.floor(cleaned.length * 0.75));
  const words = mid.match(/([\u4e00-\u9fa5A-Za-z]{3,8})/g);
  if (words && words.length) {
    const phrase = words.sort((a, b) => b.length - a.length)[0];
    return { phrase };
  }
  return null;
}

export async function generateCandidatesFor(collection, { force = false } = {}) {
  if (force) {
    db.prepare("DELETE FROM cards WHERE collection_id = ? AND status = '候选中' AND source = 'ai'").run(collection.id);
  } else {
    const existing = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE collection_id = ? AND status != ?')
      .get(collection.id, CARD_STATUS.DELETED).n;
    if (existing > 0) return { created: 0, reason: 'already' };
  }
  if (!isKnowledgeType(collection.type)) {
    return { created: 0, reason: 'not-knowledge' };
  }
  const text = [collection.title, collection.summary, collection.parsed_text].filter(Boolean).join('\n');
  if ((text || '').trim().length < 80) return { created: 0, reason: 'insufficient' };

  let cards = [];
  if (aiEnabled()) {
    try { cards = await generateCardsAI({ title: collection.title, summary: collection.summary, text: collection.parsed_text }); } catch { cards = []; }
  }
  if (!cards.length) cards = generateCardsRules({ title: collection.title, summary: collection.summary, text });

  const insert = db.prepare(`
    INSERT INTO cards (user_id, collection_id, kind, question, answer, points, source_snippet, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of cards) {
    insert.run(collection.user_id, collection.id, c.kind, c.question || null, c.answer || null, JSON.stringify(c.points || []), c.sourceSnippet || null, CARD_STATUS.CANDIDATE, now(), now());
  }
  return { created: cards.length };
}

export function createCard(userId, collectionId, fields) {
  const col = db.prepare('SELECT id FROM collections WHERE id = ? AND user_id = ?').get(collectionId, userId);
  if (!col) return { ok: false, error: '收藏不存在' };
  const kind = ['问答', '概念', '填空'].includes(fields.kind) ? fields.kind : '问答';
  const question = String(fields.question || '').trim();
  const answer = String(fields.answer || '').trim();
  const points = Array.isArray(fields.points) ? fields.points.map(String).filter((s) => s.trim()).slice(0, 8) : [];
  if (!question && !answer && !points.length) return { ok: false, error: '问题和答案至少填一项' };
  const r = db.prepare(`
    INSERT INTO cards (user_id, collection_id, kind, question, answer, points, source_snippet, status, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, '候选中', 'manual', ?, ?)
  `).run(userId, collectionId, kind, question || null, answer || null, JSON.stringify(points), String(fields.sourceSnippet || '').trim().slice(0, 300) || null, now(), now());
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(Number(r.lastInsertRowid));
  return { ok: true, card: cardView(row) };
}

export function cardView(row) {
  if (!row) return null;
  return {
    id: row.id,
    collectionId: row.collection_id,
    kind: row.kind,
    question: row.question,
    answer: row.answer,
    points: (() => { try { return JSON.parse(row.points || '[]'); } catch { return []; } })(),
    sourceSnippet: row.source_snippet,
    status: row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    title: row.title,
    url: row.url,
    sourceText: row.source_text || null,
    nextReviewAt: row.next_review_at,
    lastReviewedAt: row.last_reviewed_at || null,
    reviewCount: Number(row.review_count || 0),
    lastFeedback: row.last_feedback || null,
  };
}

export async function listCards(userId, status) {
  const select = `
    SELECT c.*, col.title, col.url, col.parsed_text AS source_text,
      (SELECT MAX(reviewed_at) FROM review_records WHERE card_id = c.id) AS last_reviewed_at
    FROM cards c
    JOIN collections col ON col.id = c.collection_id
  `;
  const rows = status
    ? db.prepare(`${select} WHERE c.user_id = ? AND c.status = ? ORDER BY c.created_at DESC`).all(userId, status)
    : db.prepare(`${select} WHERE c.user_id = ? AND c.status != ? ORDER BY c.created_at DESC`).all(userId, CARD_STATUS.DELETED);
  return rows.map(cardView);
}

export async function setCardStatus(userId, cardId, status) {
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(cardId, userId);
  if (!card) return { ok: false, error: '卡片不存在' };
  if (status === CARD_STATUS.CONFIRMED && !card.confirmed_at) {
    db.prepare('UPDATE cards SET status = ?, confirmed_at = ?, updated_at = ? WHERE id = ?').run(status, now(), now(), cardId);
  } else {
    db.prepare('UPDATE cards SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), cardId);
  }
  return { ok: true };
}

export function updateCard(userId, cardId, patch) {
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(cardId, userId);
  if (!card) return { ok: false, error: '卡片不存在' };
  const fields = {};
  if (patch.question !== undefined) fields.question = String(patch.question);
  if (patch.answer !== undefined) fields.answer = String(patch.answer);
  if (patch.kind !== undefined && ['问答', '概念', '填空'].includes(patch.kind)) fields.kind = patch.kind;
  if (patch.points !== undefined) fields.points = JSON.stringify(Array.isArray(patch.points) ? patch.points.map(String).slice(0, 8) : []);
  if (Object.keys(fields).length) {
    const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE cards SET ${sets}, updated_at = ? WHERE id = ?`).run(...Object.values(fields), now(), cardId);
  }
  return { ok: true };
}

// 回顾会话：已确认/计划中且到期（或从未回顾）的卡片，最多 5 张
export function reviewSession(userId) {
  const isoNow = now();
  let limit = 5;
  try {
    const u = db.prepare('SELECT prefs FROM users WHERE id = ?').get(userId);
    const p = JSON.parse(u?.prefs || '{}');
    if (p.reviewCount) limit = Math.min(20, Math.max(1, Number(p.reviewCount) || 5));
  } catch {}
  const rows = db.prepare(`
    SELECT c.*, col.title, col.url, col.parsed_text AS source_text,
      (SELECT COUNT(*) FROM review_records WHERE card_id = c.id) AS review_count,
      (SELECT reviewed_at FROM review_records WHERE card_id = c.id ORDER BY reviewed_at DESC LIMIT 1) AS last_reviewed_at,
      (SELECT feedback FROM review_records WHERE card_id = c.id ORDER BY reviewed_at DESC LIMIT 1) AS last_feedback
    FROM cards c
    JOIN collections col ON col.id = c.collection_id
    WHERE c.user_id = ? AND c.status IN ('已确认', '计划中')
      AND c.confirmed_at IS NOT NULL
      AND (c.id NOT IN (SELECT card_id FROM review_records WHERE user_id = ?)
           OR c.id IN (
             SELECT card_id FROM review_records WHERE user_id = ?
             GROUP BY card_id HAVING MAX(next_review_at) <= ?
           ))
    ORDER BY (SELECT MAX(reviewed_at) FROM review_records WHERE card_id = c.id) ASC
    LIMIT ${limit}
  `).all(userId, userId, userId, isoNow);
  return rows.map(cardView);
}

export function randomConfirmedCard(userId) {
  const row = db.prepare(`
    SELECT c.*, col.title, col.url FROM cards c
    JOIN collections col ON col.id = c.collection_id
    WHERE c.user_id = ? AND c.status IN ('已确认', '计划中')
    ORDER BY RANDOM() LIMIT 1
  `).get(userId);
  return row ? cardView(row) : null;
}

export function recordReview(userId, cardId, feedback) {
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(cardId, userId);
  if (!card) return { ok: false, error: '卡片不存在' };
  const interval = FEEDBACK_INTERVALS[feedback] || 1;
  const next = daysLaterISO(interval);
  db.prepare('INSERT INTO review_records (user_id, card_id, feedback, interval_days, reviewed_at, next_review_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, cardId, feedback, interval, now(), next);
  if (card.status === CARD_STATUS.CONFIRMED) {
    db.prepare('UPDATE cards SET status = ?, updated_at = ? WHERE id = ?').run(CARD_STATUS.PLANNED, now(), cardId);
  }
  return { ok: true, interval, next };
}
