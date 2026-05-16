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

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER,
  categories  TEXT,
  difficulty  INTEGER,
  judge_type  TEXT
);

CREATE TABLE IF NOT EXISTS role_assignments (
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  role        TEXT,
  model_name  TEXT,
  model_path  TEXT,
  cloud_model TEXT
);

CREATE TABLE IF NOT EXISTS questions (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  position    INTEGER,
  question    TEXT,
  category    TEXT
);

CREATE TABLE IF NOT EXISTS responses (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  role        TEXT,
  model_name  TEXT,
  response    TEXT,
  token_count INTEGER,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  role        TEXT,
  score       REAL,
  reasoning   TEXT,
  created_at  INTEGER
);

CREATE TABLE IF NOT EXISTS votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  slot        TEXT NOT NULL,
  voter_id    TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_role_assignments_session ON role_assignments(session_id);
CREATE INDEX IF NOT EXISTS idx_questions_session        ON questions(session_id);
CREATE INDEX IF NOT EXISTS idx_responses_session        ON responses(session_id);
CREATE INDEX IF NOT EXISTS idx_responses_question       ON responses(question_id);
CREATE INDEX IF NOT EXISTS idx_scores_session           ON scores(session_id);
CREATE INDEX IF NOT EXISTS idx_scores_question          ON scores(question_id);
CREATE INDEX IF NOT EXISTS idx_votes_session            ON votes(session_id);
`);

const stmtInsertSession = db.prepare(
  `INSERT INTO sessions (id, created_at, categories, difficulty, judge_type)
   VALUES (@id, @created_at, @categories, @difficulty, @judge_type)`
);

const stmtInsertRoleAssignment = db.prepare(
  `INSERT INTO role_assignments (session_id, role, model_name, model_path, cloud_model)
   VALUES (@session_id, @role, @model_name, @model_path, @cloud_model)`
);

const stmtInsertQuestion = db.prepare(
  `INSERT INTO questions (id, session_id, position, question, category)
   VALUES (@id, @session_id, @position, @question, @category)`
);

const stmtInsertResponse = db.prepare(
  `INSERT INTO responses (id, session_id, question_id, role, model_name, response, token_count, duration_ms)
   VALUES (@id, @session_id, @question_id, @role, @model_name, @response, @token_count, @duration_ms)`
);

const stmtInsertScore = db.prepare(
  `INSERT INTO scores (session_id, question_id, role, score, reasoning, created_at)
   VALUES (@session_id, @question_id, @role, @score, @reasoning, @created_at)`
);

const stmtInsertVote = db.prepare(
  `INSERT INTO votes (session_id, slot, voter_id, created_at)
   VALUES (@session_id, @slot, @voter_id, @created_at)`
);

const stmtListQuestions = db.prepare(
  `SELECT id, session_id, position, question, category FROM questions
   WHERE session_id = ? ORDER BY position ASC`
);

const stmtListScores = db.prepare(
  `SELECT question_id, role, score, reasoning FROM scores
   WHERE session_id = ? ORDER BY created_at ASC`
);

const stmtCountVotes = db.prepare(
  `SELECT slot, COUNT(*) as count FROM votes WHERE session_id = ? GROUP BY slot`
);

const stmtHasVote = db.prepare(
  `SELECT 1 FROM votes WHERE session_id = ? AND voter_id = ? LIMIT 1`
);

export function insertSession(row) { stmtInsertSession.run(row); }
export function insertRoleAssignment(row) { stmtInsertRoleAssignment.run(row); }
export function insertQuestion(row) { stmtInsertQuestion.run(row); }
export function insertResponse(row) { stmtInsertResponse.run(row); }
export function insertScore(row) { stmtInsertScore.run(row); }

export function insertVote(row) { stmtInsertVote.run(row); }

export function getVoteTallies(sessionId) {
  const rows = stmtCountVotes.all(sessionId);
  const tallies = { A: 0, B: 0, C: 0, D: 0 };
  for (const r of rows) tallies[r.slot] = r.count;
  return tallies;
}

export function hasVoted(sessionId, voterId) {
  return !!stmtHasVote.get(sessionId, voterId);
}

export function listQuestionsForSession(sessionId) {
  return stmtListQuestions.all(sessionId);
}

export function listScoresForSession(sessionId) {
  return stmtListScores.all(sessionId);
}

export { db };
