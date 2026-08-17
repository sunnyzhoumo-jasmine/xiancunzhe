import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT UNIQUE NOT NULL,
  nickname TEXT,
  password_hash TEXT NOT NULL,
  api_token TEXT UNIQUE,
  is_guest INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  url TEXT,
  platform TEXT,
  title TEXT,
  author TEXT,
  type TEXT DEFAULT '未分类',
  summary TEXT,
  parsed_text TEXT,
  cover TEXT,
  note TEXT,
  parse_status TEXT DEFAULT '待解析',
  use_status TEXT DEFAULT '未读',
  tags TEXT DEFAULT '[]',
  meta_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  opened_at TEXT,
  last_viewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_c_user_created ON collections(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_c_user_type ON collections(user_id, type);
CREATE INDEX IF NOT EXISTS idx_c_user_status ON collections(user_id, parse_status);

CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS set_members (
  set_id INTEGER NOT NULL,
  collection_id INTEGER NOT NULL,
  PRIMARY KEY (set_id, collection_id)
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  collection_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  question TEXT,
  answer TEXT,
  points TEXT DEFAULT '[]',
  source_snippet TEXT,
  status TEXT DEFAULT '候选中',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cards_user_status ON cards(user_id, status);

CREATE TABLE IF NOT EXISTS review_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  card_id INTEGER NOT NULL,
  feedback TEXT,
  interval_days INTEGER DEFAULT 1,
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  next_review_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_review_user ON review_records(user_id);

CREATE TABLE IF NOT EXISTS processing_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  collection_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

try { db.exec("ALTER TABLE cards ADD COLUMN source TEXT DEFAULT 'ai'"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN prefs TEXT DEFAULT '{}'"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0"); } catch {}
try {
  db.exec(`
    UPDATE collections SET type = CASE type
      WHEN '知识、教程' THEN '方法'
      WHEN '工具、软件' THEN '方法'
      WHEN '商品、消费' THEN '事实'
      WHEN '地点、旅行' THEN '事实'
      WHEN '美食、菜谱' THEN '事实'
      WHEN '书影音' THEN '事实'
      WHEN '灵感、创意' THEN '其他'
      WHEN '新闻、行业' THEN '事实'
      WHEN '待办内容' THEN '其他'
      WHEN '未分类' THEN '其他'
      ELSE type END
  `);
} catch {}

// 将旧版“要点卡”迁移为带问题的问答卡，保证历史回顾仍然可用。
try {
  const legacyCards = db.prepare(`
    SELECT c.id, c.question, c.answer, c.points, col.title
    FROM cards c JOIN collections col ON col.id = c.collection_id
    WHERE c.kind = '要点'
  `).all();
  const migrateLegacy = db.prepare('UPDATE cards SET kind = ?, question = ?, answer = ?, points = ?, updated_at = ? WHERE id = ?');
  for (const card of legacyCards) {
    let points = [];
    try { points = JSON.parse(card.points || '[]'); } catch {}
    const question = String(card.question || '').trim() || `${card.title || '这条知识'}的核心知识点是什么？`;
    const answer = String(card.answer || '').trim() || points.filter(Boolean).join('；');
    migrateLegacy.run('问答', question, answer || null, '[]', new Date().toISOString(), card.id);
  }
} catch {}

export const now = () => new Date().toISOString();
export const daysAgoISO = (n) => new Date(Date.now() - n * 86400000).toISOString();
export const daysLaterISO = (n) => new Date(Date.now() + n * 86400000).toISOString();

export function parseTags(str) {
  try { const t = JSON.parse(str || '[]'); return Array.isArray(t) ? t : []; } catch { return []; }
}
