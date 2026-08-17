import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, now } from './db.js';

const SESSION_DAYS = 30;
const TOKEN_BYTES = 24;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const candidate = scryptSync(password, salt, 32);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function createSession(userId) {
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return token;
}

export function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function userFromSession(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, now());
  return row || null;
}

export function userFromApiToken(token) {
  if (!token) return null;
  return db.prepare('SELECT * FROM users WHERE api_token = ?').get(token) || null;
}

export function publicUser(u) {
  return { id: u.id, account: u.account, nickname: u.nickname || u.account };
}

export function ensureApiToken(u) {
  if (u.api_token) return u.api_token;
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  db.prepare('UPDATE users SET api_token = ? WHERE id = ?').run(token, u.id);
  return token;
}
