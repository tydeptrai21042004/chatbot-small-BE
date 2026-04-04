import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dbPath = path.resolve(
  process.cwd(),
  process.env.SQLITE_DB_PATH ?? "./data/chatbot.sqlite"
);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

let initialized = false;

export function initSqlite(): void {
  if (initialized) return;

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      session_id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL,
      rolling_summary TEXT NOT NULL DEFAULT '',
      stable_facts_json TEXT NOT NULL DEFAULT '[]',
      recent_turns_json TEXT NOT NULL DEFAULT '[]',
      custom_persona_json TEXT NOT NULL DEFAULT '{}',
      total_turns INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_time
      ON chat_messages(session_id, timestamp, id);
  `);

  initialized = true;
}

/**
 * Quan trọng:
 * gọi init ngay khi module được import,
 * để các bảng tồn tại trước khi sessionStore.ts prepare statement.
 */
initSqlite();