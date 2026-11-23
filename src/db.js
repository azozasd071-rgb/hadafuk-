import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quizzes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS questions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id       INTEGER NOT NULL REFERENCES quizzes(id),
    position      INTEGER NOT NULL,
    text          TEXT NOT NULL,
    options       TEXT NOT NULL,
    correct_index INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id       INTEGER NOT NULL REFERENCES quizzes(id),
    chat_id       TEXT NOT NULL,
    chat_title    TEXT NOT NULL DEFAULT '',
    interval_sec  INTEGER NOT NULL DEFAULT 0,
    answer_sec    INTEGER NOT NULL DEFAULT 60,
    status        TEXT NOT NULL DEFAULT 'active',
    current_index INTEGER NOT NULL DEFAULT 0,
    next_at       INTEGER NOT NULL,
    summary_sent  INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS polls (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id       TEXT NOT NULL UNIQUE,
    run_id        INTEGER NOT NULL REFERENCES runs(id),
    question_id   INTEGER NOT NULL,
    chat_id       TEXT NOT NULL,
    message_id    INTEGER NOT NULL DEFAULT 0,
    correct_index INTEGER NOT NULL,
    sent_at       INTEGER NOT NULL,
    close_at      INTEGER NOT NULL,
    closed_at     INTEGER
  );

  CREATE TABLE IF NOT EXISTS answers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id      TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    user_name    TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    at           INTEGER NOT NULL,
    UNIQUE(poll_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS tg_groups (
    chat_id  TEXT PRIMARY KEY,
    title    TEXT NOT NULL DEFAULT '',
    added_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wa_groups (
    jid     TEXT PRIMARY KEY,
    name    TEXT NOT NULL DEFAULT '',
    seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS broadcasts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    text       TEXT NOT NULL,
    total      INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wa_deliveries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id INTEGER NOT NULL REFERENCES broadcasts(id),
    jid          TEXT NOT NULL,
    name         TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'pending',
    error        TEXT NOT NULL DEFAULT '',
    at           INTEGER
  );
`);

// ---------- settings ----------
export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

// ---------- quizzes ----------
export function createQuiz(title) {
  const now = Date.now();
  const res = db.prepare('INSERT INTO quizzes(title, created_at) VALUES(?, ?)').run(title.trim(), now);
  return Number(res.lastInsertRowid);
}

export function listQuizzes() {
  return db
    .prepare(
      `SELECT z.*, (SELECT COUNT(*) FROM questions q WHERE q.quiz_id = z.id) AS question_count
       FROM quizzes z ORDER BY z.id DESC`
    )
    .all();
}

export function getQuiz(id) {
  return db.prepare('SELECT * FROM quizzes WHERE id = ?').get(Number(id)) || null;
}

export function renameQuiz(id, title) {
  db.prepare('UPDATE quizzes SET title = ? WHERE id = ?').run(title.trim(), Number(id));
}

export function deleteQuiz(id) {
  const qid = Number(id);
  db.exec('BEGIN');
  try {
    db.prepare(
      'DELETE FROM answers WHERE poll_id IN (SELECT p.poll_id FROM polls p JOIN runs r ON r.id = p.run_id WHERE r.quiz_id = ?)'
    ).run(qid);
    db.prepare('DELETE FROM polls WHERE run_id IN (SELECT id FROM runs WHERE quiz_id = ?)').run(qid);
    db.prepare('DELETE FROM runs WHERE quiz_id = ?').run(qid);
    db.prepare('DELETE FROM questions WHERE quiz_id = ?').run(qid);
    db.prepare('DELETE FROM quizzes WHERE id = ?').run(qid);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- questions ----------
function parseOptions(raw) {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function getQuestions(quizId) {
  return db
    .prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position ASC')
    .all(Number(quizId))
    .map((q) => ({ ...q, options: parseOptions(q.options) }));
}

export function getQuestionById(id) {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(Number(id));
  return q ? { ...q, options: parseOptions(q.options) } : null;
}

export function insertQuestions(quizId, questions) {
  const stmt = db.prepare(
    'INSERT INTO questions(quiz_id, position, text, options, correct_index) VALUES(?, ?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  try {
    questions.forEach((q, i) => {
      stmt.run(Number(quizId), i + 1, q.text, JSON.stringify(q.options), q.correct_index);
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function replaceQuestions(quizId, questions) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM questions WHERE quiz_id = ?').run(Number(quizId));
    const stmt = db.prepare(
      'INSERT INTO questions(quiz_id, position, text, options, correct_index) VALUES(?, ?, ?, ?, ?)'
    );
    questions.forEach((q, i) => {
      stmt.run(Number(quizId), i + 1, q.text, JSON.stringify(q.options), q.correct_index);
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function hasRuns(quizId) {
  return !!db.prepare('SELECT id FROM runs WHERE quiz_id = ? LIMIT 1').get(Number(quizId));
}

// ---------- runs ----------
export function createRun({ quizId, chatId, chatTitle, intervalSec, answerSec, startAt }) {
  const now = Date.now();
  const res = db
    .prepare(
      `INSERT INTO runs(quiz_id, chat_id, chat_title, interval_sec, answer_sec, status, current_index, next_at, created_at)
       VALUES(?, ?, ?, ?, ?, 'active', 0, ?, ?)`
    )
    .run(Number(quizId), String(chatId), chatTitle || '', Number(intervalSec), Number(answerSec), startAt || now, now);
  return Number(res.lastInsertRowid);
}

export function getRun(id) {
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(Number(id)) || null;
}

export function runsByQuiz(quizId) {
  return db.prepare('SELECT * FROM runs WHERE quiz_id = ? ORDER BY id DESC').all(Number(quizId));
}

export function dueRuns(now) {
  return db
    .prepare(`SELECT * FROM runs WHERE status = 'active' AND next_at <= ? ORDER BY next_at ASC LIMIT 20`)
    .all(now);
}

export function advanceRun(id, nextIndex, nextAt) {
  db.prepare('UPDATE runs SET current_index = ?, next_at = ? WHERE id = ?').run(nextIndex, nextAt, Number(id));
}

export function finishRun(id, status, error = '') {
  db.prepare('UPDATE runs SET status = ?, last_error = ? WHERE id = ?').run(status, error, Number(id));
}

export function markRunSummarySent(id) {
  db.prepare('UPDATE runs SET summary_sent = 1 WHERE id = ?').run(Number(id));
}

// ---------- polls ----------
export function insertPoll({ pollId, runId, questionId, chatId, messageId, correctIndex, closeAt }) {
  db.prepare(
    `INSERT INTO polls(poll_id, run_id, question_id, chat_id, message_id, correct_index, sent_at, close_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(pollId, Number(runId), Number(questionId), String(chatId), Number(messageId), Number(correctIndex), Date.now(), closeAt);
}

export function duePolls(now) {
  return db
    .prepare('SELECT * FROM polls WHERE closed_at IS NULL AND close_at <= ? ORDER BY close_at ASC LIMIT 20')
    .all(now);
}

export function markPollClosed(id) {
  db.prepare('UPDATE polls SET closed_at = ? WHERE id = ?').run(Date.now(), Number(id));
}

export function pollsByRun(runId) {
  return db
    .prepare(
      `SELECT p.*, q.text, q.options, q.position
       FROM polls p LEFT JOIN questions q ON q.id = p.question_id
       WHERE p.run_id = ? ORDER BY p.id ASC`
    )
    .all(Number(runId));
}

export function openPollsCount(runId) {
  return db.prepare('SELECT COUNT(*) AS c FROM polls WHERE run_id = ? AND closed_at IS NULL').get(Number(runId)).c;
}

// ---------- answers ----------
export function recordAnswer(pollId, userId, userName, optionIndex, at) {
  db.prepare(
    `INSERT INTO answers(poll_id, user_id, user_name, option_index, at)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(poll_id, user_id) DO UPDATE SET option_index = excluded.option_index, at = excluded.at, user_name = excluded.user_name`
  ).run(pollId, String(userId), userName, Number(optionIndex), at);
}

// ---------- groups ----------
export function upsertTgGroup(chatId, title) {
  db.prepare(
    `INSERT INTO tg_groups(chat_id, title, added_at) VALUES(?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET title = excluded.title`
  ).run(String(chatId), title || '', Date.now());
}

export function listTgGroups() {
  return db.prepare('SELECT * FROM tg_groups ORDER BY added_at DESC').all();
}

export function deleteTgGroup(chatId) {
  db.prepare('DELETE FROM tg_groups WHERE chat_id = ?').run(String(chatId));
}

export function upsertWaGroups(groups) {
  const stmt = db.prepare(
    `INSERT INTO wa_groups(jid, name, seen_at) VALUES(?, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET name = excluded.name, seen_at = excluded.seen_at`
  );
  const now = Date.now();
  db.exec('BEGIN');
  try {
    for (const g of groups) stmt.run(g.jid, g.name || '', now);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function listWaGroups() {
  return db.prepare('SELECT * FROM wa_groups ORDER BY name ASC').all();
}

export function clearWaGroups() {
  db.prepare('DELETE FROM wa_groups').run();
}

// ---------- broadcasts ----------
export function createBroadcast(text, deliveries) {
  db.exec('BEGIN');
  try {
    const res = db.prepare('INSERT INTO broadcasts(text, total, created_at) VALUES(?, ?, ?)').run(text, deliveries.length, Date.now());
    const id = Number(res.lastInsertRowid);
    const stmt = db.prepare('INSERT INTO wa_deliveries(broadcast_id, jid, name) VALUES(?, ?, ?)');
    for (const d of deliveries) stmt.run(id, d.jid, d.name || '');
    db.exec('COMMIT');
    return id;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function clearBroadcasts() {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM wa_deliveries').run();
    db.prepare('DELETE FROM broadcasts').run();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getDeliveries(broadcastId) {
  return db.prepare('SELECT * FROM wa_deliveries WHERE broadcast_id = ? ORDER BY id ASC').all(Number(broadcastId));
}

export function updateDelivery(id, status, error = '') {
  db.prepare('UPDATE wa_deliveries SET status = ?, error = ?, at = ? WHERE id = ?').run(status, error, Date.now(), Number(id));
}

export function listBroadcasts(limit = 10) {
  return db
    .prepare(
      `SELECT b.*,
        (SELECT COUNT(*) FROM wa_deliveries d WHERE d.broadcast_id = b.id AND d.status = 'sent') AS sent,
        (SELECT COUNT(*) FROM wa_deliveries d WHERE d.broadcast_id = b.id AND d.status = 'failed') AS failed
       FROM broadcasts b ORDER BY b.id DESC LIMIT ?`
    )
    .all(Number(limit));
}

export function getBroadcast(id) {
  return db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(Number(id)) || null;
}

// ---------- stats ----------
export function leaderboard(quizId = null) {  const where = quizId ? 'WHERE r.quiz_id = ?' : '';
  const args = quizId ? [Number(quizId)] : [];
  return db
    .prepare(
      `SELECT a.user_id, MAX(a.user_name) AS user_name,
              COUNT(*) AS answered,
              SUM(CASE WHEN a.option_index = p.correct_index THEN 1 ELSE 0 END) AS correct,
              MIN(a.at) AS first_at
       FROM answers a
       JOIN polls p ON p.poll_id = a.poll_id
       JOIN runs r ON r.id = p.run_id
       ${where}
       GROUP BY a.user_id
       ORDER BY correct DESC, answered DESC, user_name ASC
       LIMIT 200`
    )
    .all(...args);
}

export function runLeaderboard(runId) {
  return db
    .prepare(
      `SELECT a.user_id, MAX(a.user_name) AS user_name,
              COUNT(*) AS answered,
              SUM(CASE WHEN a.option_index = p.correct_index THEN 1 ELSE 0 END) AS correct
       FROM answers a
       JOIN polls p ON p.poll_id = a.poll_id
       WHERE p.run_id = ?
       GROUP BY a.user_id
       ORDER BY correct DESC, answered DESC, user_name ASC
       LIMIT 10`
    )
    .all(Number(runId));
}

export function questionBreakdown(quizId) {
  const rows = db
    .prepare(
      `SELECT p.poll_id, p.correct_index, p.closed_at, q.position, q.text, q.options,
              COUNT(a.id) AS answered,
              SUM(CASE WHEN a.option_index = p.correct_index THEN 1 ELSE 0 END) AS correct_count
       FROM polls p
       JOIN runs r ON r.id = p.run_id
       JOIN questions q ON q.id = p.question_id
       LEFT JOIN answers a ON a.poll_id = p.poll_id
       WHERE r.quiz_id = ?
       GROUP BY p.id
       ORDER BY p.id ASC`
    )
    .all(Number(quizId));

  const dist = db.prepare(
    `SELECT option_index, COUNT(*) AS c FROM answers WHERE poll_id = ? GROUP BY option_index`
  );
  return rows.map((r) => ({
    ...r,
    options: parseOptions(r.options),
    distribution: Object.fromEntries(dist.all(r.poll_id).map((d) => [d.option_index, d.c])),
  }));
}

export function counts() {
  return {
    quizzes: db.prepare('SELECT COUNT(*) c FROM quizzes').get().c,
    questions: db.prepare('SELECT COUNT(*) c FROM questions').get().c,
    answers: db.prepare('SELECT COUNT(*) c FROM answers').get().c,
    quizzesDone: db.prepare("SELECT COUNT(*) c FROM runs WHERE status = 'done'").get().c,
  };
}
