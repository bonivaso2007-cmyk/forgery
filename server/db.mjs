import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'forge.db');
const DATABASE_URL = process.env.DATABASE_URL?.trim();
const usePostgres = Boolean(DATABASE_URL);

let sqliteDb = null;
let pgPool = null;

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function serializeJson(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

async function queryDb(sql, params = []) {
  if (usePostgres) {
    const result = await pgPool.query(sql, params);
    return { rows: result.rows, info: result };
  }

  const stmt = sqliteDb.prepare(sql);
  if (/^\s*select/i.test(sql)) {
    return { rows: stmt.all(params), info: null };
  }
  return { rows: [], info: stmt.run(params) };
}

async function fetchOne(sql, params = []) {
  const { rows } = await queryDb(sql, params);
  return rows[0] || null;
}

async function fetchAll(sql, params = []) {
  const { rows } = await queryDb(sql, params);
  return rows;
}

async function runSql(sql, params = []) {
  const { info } = await queryDb(sql, params);
  return info;
}

export async function initializeDatabase() {
  if (usePostgres) {
    const pgConfig = { connectionString: DATABASE_URL };
    if (process.env.NODE_ENV === 'production' && !/sslmode=/.test(DATABASE_URL)) {
      pgConfig.ssl = { rejectUnauthorized: false };
    }
    pgPool = new Pool(pgConfig);
    await pgPool.query(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password_hash TEXT,
      provider TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);

    await pgPool.query(`CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      stage TEXT,
      geo TEXT,
      customer TEXT,
      problem TEXT,
      solution TEXT,
      market TEXT,
      revenue TEXT,
      channels TEXT,
      constraints TEXT,
      strengths TEXT,
      risks TEXT,
      goals TEXT
    )`);

    await pgPool.query(`CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      idea_text TEXT NOT NULL,
      score INTEGER,
      verdict TEXT,
      strengths TEXT,
      weaknesses TEXT,
      moves TEXT,
      provider TEXT,
      model TEXT,
      is_favorite BOOLEAN DEFAULT FALSE,
      tags TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);

    await pgPool.query(`CREATE TABLE IF NOT EXISTS waitlist (
      email TEXT PRIMARY KEY,
      stage TEXT,
      created_at TEXT NOT NULL
    )`);

    await pgPool.query(`CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      ip TEXT,
      category TEXT,
      tokens INTEGER,
      created_at TEXT NOT NULL
    )`);

    return;
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  sqliteDb = new Database(DB_FILE);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password_hash TEXT,
      provider TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      stage TEXT,
      geo TEXT,
      customer TEXT,
      problem TEXT,
      solution TEXT,
      market TEXT,
      revenue TEXT,
      channels TEXT,
      constraints TEXT,
      strengths TEXT,
      risks TEXT,
      goals TEXT
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      idea_text TEXT NOT NULL,
      score INTEGER,
      verdict TEXT,
      strengths TEXT,
      weaknesses TEXT,
      moves TEXT,
      provider TEXT,
      model TEXT,
      is_favorite INTEGER DEFAULT 0,
      tags TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS waitlist (
      email TEXT PRIMARY KEY,
      stage TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      ip TEXT,
      category TEXT,
      tokens INTEGER,
      created_at TEXT NOT NULL
    );
  `);
}

export async function getUserByEmail(email) {
  return fetchOne('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
}

export async function getUserById(id) {
  return fetchOne('SELECT * FROM users WHERE id = $1', [id]);
}

export async function createUser({ email, name, passwordHash, provider = 'local' }) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await runSql(
    'INSERT INTO users (id, email, name, password_hash, provider, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, email.toLowerCase(), name || '', passwordHash || null, provider, createdAt]
  );
  return { id, email: email.toLowerCase(), name: name || '', provider, created_at: createdAt };
}

export async function createOrUpdateGoogleUser({ email, name }) {
  const existing = await getUserByEmail(email);
  if (existing) {
    if (!existing.name && name) {
      await runSql('UPDATE users SET name = $1 WHERE id = $2', [name, existing.id]);
      existing.name = name;
    }
    return existing;
  }
  return createUser({ email, name, provider: 'google' });
}

export async function getProfile(userId) {
  return fetchOne('SELECT * FROM profiles WHERE user_id = $1', [userId]);
}

export async function upsertProfile(userId, updates) {
  const fields = [];
  const values = [userId];
  let index = 2;
  for (const [key, value] of Object.entries(updates)) {
    if (['stage', 'geo', 'customer', 'problem', 'solution', 'market', 'revenue', 'channels', 'constraints', 'strengths', 'risks', 'goals'].includes(key)) {
      fields.push(`${key} = $${index}`);
      values.push(value);
      index += 1;
    }
  }

  if (fields.length === 0) {
    return getProfile(userId);
  }

  const updateSql = `INSERT INTO profiles (user_id, ${Object.keys(updates).join(', ')}) VALUES ($1, ${Object.keys(updates).map((_, i) => `$${i + 2}`).join(', ')}) ON CONFLICT(user_id) DO UPDATE SET ${fields.join(', ')}`;
  await runSql(updateSql, values);
  return getProfile(userId);
}

export async function saveIdea(userId, idea) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;
  await runSql(
    'INSERT INTO ideas (id, user_id, idea_text, score, verdict, strengths, weaknesses, moves, provider, model, is_favorite, tags, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
    [
      id,
      userId,
      idea.idea_text,
      idea.score ?? null,
      idea.verdict ?? null,
      serializeJson(idea.strengths),
      serializeJson(idea.weaknesses),
      serializeJson(idea.moves),
      idea.provider || null,
      idea.model || null,
      idea.is_favorite ? 1 : 0,
      serializeJson(idea.tags),
      createdAt,
      updatedAt,
    ]
  );
  return getIdeaById(id);
}

export async function getIdeaById(id) {
  const idea = await fetchOne('SELECT * FROM ideas WHERE id = $1', [id]);
  if (!idea) return null;
  return {
    ...idea,
    strengths: parseJson(idea.strengths) || [],
    weaknesses: parseJson(idea.weaknesses) || [],
    moves: parseJson(idea.moves) || [],
    tags: parseJson(idea.tags) || [],
    is_favorite: Boolean(idea.is_favorite),
  };
}

export async function getIdeasByUserId(userId, limit = 50) {
  const rows = await fetchAll('SELECT * FROM ideas WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, limit]);
  return rows.map((idea) => ({
    ...idea,
    strengths: parseJson(idea.strengths) || [],
    weaknesses: parseJson(idea.weaknesses) || [],
    moves: parseJson(idea.moves) || [],
    tags: parseJson(idea.tags) || [],
    is_favorite: Boolean(idea.is_favorite),
  }));
}

export async function updateIdea(id, updates, userId) {
  const fields = [];
  const values = [];
  let index = 1;
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'strengths' || key === 'weaknesses' || key === 'moves' || key === 'tags') {
      fields.push(`${key} = $${index}`);
      values.push(serializeJson(value));
      index += 1;
    } else if (['idea_text', 'score', 'verdict', 'provider', 'model', 'is_favorite'].includes(key)) {
      fields.push(`${key} = $${index}`);
      values.push(key === 'is_favorite' ? (value ? 1 : 0) : value);
      index += 1;
    }
  }
  if (fields.length === 0) return getIdeaById(id);
  fields.push(`updated_at = $${index}`);
  values.push(new Date().toISOString());
  values.push(id, userId);

  await runSql(`UPDATE ideas SET ${fields.join(', ')} WHERE id = $${index + 1} AND user_id = $${index + 2}`, values);
  return getIdeaById(id);
}

export async function deleteIdea(id, userId) {
  const { info } = await queryDb('DELETE FROM ideas WHERE id = $1 AND user_id = $2', [id, userId]);
  return usePostgres ? info.rowCount > 0 : info.changes > 0;
}

export async function saveWaitlist(email, stage) {
  const createdAt = new Date().toISOString();
  await runSql('INSERT INTO waitlist (email, stage, created_at) VALUES ($1, $2, $3) ON CONFLICT(email) DO UPDATE SET stage = EXCLUDED.stage', [email.toLowerCase(), stage, createdAt]);
  return { email: email.toLowerCase(), stage, created_at: createdAt };
}

export async function insertUsage({ userId, ip, category, tokens }) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await runSql('INSERT INTO usage_logs (id, user_id, ip, category, tokens, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
    id,
    userId || null,
    ip || null,
    category,
    tokens || 0,
    createdAt,
  ]);
  return { id, user_id: userId, ip, category, tokens, created_at: createdAt };
}

export async function countUsage({ userId, ip, sinceMs, category }) {
  const since = new Date(Date.now() - sinceMs).toISOString();
  const targetColumn = userId ? 'user_id' : 'ip';
  const targetValue = userId || ip;
  const row = await fetchOne(`SELECT COUNT(*) AS count FROM usage_logs WHERE ${targetColumn} = $1 AND category = $2 AND created_at >= $3`, [targetValue, category, since]);
  return Number(row?.count || 0);
}

export async function sumUsageTokens({ userId, ip, sinceMs, category }) {
  const since = new Date(Date.now() - sinceMs).toISOString();
  const targetColumn = userId ? 'user_id' : 'ip';
  const targetValue = userId || ip;
  const row = await fetchOne(`SELECT COALESCE(SUM(tokens), 0) AS total FROM usage_logs WHERE ${targetColumn} = $1 AND category = $2 AND created_at >= $3`, [targetValue, category, since,]);
  return Number(row?.total || 0);
}
