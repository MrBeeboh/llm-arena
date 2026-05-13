import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'arena.sqlite');
const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER,
  categories  TEXT,
  difficulty  INTEGER,
  judge_type  TEXT
);

CREATE TABLE IF NOT EXISTS role_assignments (
  session_id  TEXT,
  role        TEXT,
  model_name  TEXT,
  model_path  TEXT,
  cloud_model TEXT
);

CREATE TABLE IF NOT EXISTS questions (
  id          TEXT PRIMARY KEY,
  session_id  TEXT,
  position    INTEGER,
  question    TEXT,
  category    TEXT
);

CREATE TABLE IF NOT EXISTS responses (
  id          TEXT PRIMARY KEY,
  session_id  TEXT,
  question_id TEXT,
  role        TEXT,
  model_name  TEXT,
  response    TEXT,
  token_count INTEGER,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT,
  question_id TEXT,
  role        TEXT,
  score       REAL,
  reasoning   TEXT,
  created_at  INTEGER
);
`);

export function insertSession(row) {
  const stmt = db.prepare(
    `INSERT INTO sessions (id, created_at, categories, difficulty, judge_type)
     VALUES (@id, @created_at, @categories, @difficulty, @judge_type)`
  );
  stmt.run(row);
}

export function insertRoleAssignment(row) {
  const stmt = db.prepare(
    `INSERT INTO role_assignments (session_id, role, model_name, model_path, cloud_model)
     VALUES (@session_id, @role, @model_name, @model_path, @cloud_model)`
  );
  stmt.run(row);
}

export function insertQuestion(row) {
  const stmt = db.prepare(
    `INSERT INTO questions (id, session_id, position, question, category)
     VALUES (@id, @session_id, @position, @question, @category)`
  );
  stmt.run(row);
}

export function insertResponse(row) {
  const stmt = db.prepare(
    `INSERT INTO responses (id, session_id, question_id, role, model_name, response, token_count, duration_ms)
     VALUES (@id, @session_id, @question_id, @role, @model_name, @response, @token_count, @duration_ms)`
  );
  stmt.run(row);
}

export function insertScore(row) {
  const stmt = db.prepare(
    `INSERT INTO scores (session_id, question_id, role, score, reasoning, created_at)
     VALUES (@session_id, @question_id, @role, @score, @reasoning, @created_at)`
  );
  stmt.run(row);
}

export function listQuestionsForSession(sessionId) {
  return db
    .prepare(
      `SELECT id, session_id, position, question, category FROM questions WHERE session_id = ? ORDER BY position ASC`
    )
    .all(sessionId);
}

export function listScoresForSession(sessionId) {
  return db
    .prepare(
      `SELECT question_id, role, score, reasoning FROM scores WHERE session_id = ? ORDER BY created_at ASC`
    )
    .all(sessionId);
}

export { db };
