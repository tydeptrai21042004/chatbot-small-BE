import type { RoleId } from "../prompts/personas.js";
import type {
  ConversationSession,
  SessionTurn,
  SessionTurnRole
} from "../types/session.js";
import { db } from "../db/sqlite.js";

type SessionRow = {
  session_id: string;
  role_id: RoleId;
  rolling_summary: string;
  stable_facts_json: string;
  recent_turns_json: string;
  custom_persona_json: string;
  total_turns: number;
  created_at: number;
  updated_at: number;
};

type MessageRow = {
  role: SessionTurnRole;
  content: string;
  timestamp: number;
};

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function createEmptySession(
  sessionId: string,
  roleId: RoleId
): ConversationSession {
  const now = Date.now();

  return {
    sessionId,
    roleId,
    rollingSummary: "",
    stableFacts: [],
    recentTurns: [],
    createdAt: now,
    updatedAt: now,
    totalTurns: 0,
    customPersona: {
      enabled: false,
      name: undefined,
      prompt: undefined
    }
  };
}

function mapRowToSession(row: SessionRow): ConversationSession {
  return {
    sessionId: row.session_id,
    roleId: row.role_id,
    rollingSummary: row.rolling_summary,
    stableFacts: safeJsonParse<string[]>(row.stable_facts_json, []),
    recentTurns: safeJsonParse<SessionTurn[]>(row.recent_turns_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalTurns: row.total_turns,
    customPersona: safeJsonParse<ConversationSession["customPersona"]>(
      row.custom_persona_json,
      {
        enabled: false,
        name: undefined,
        prompt: undefined
      }
    )
  };
}

const selectSessionStmt = db.prepare(`
  SELECT *
  FROM chat_sessions
  WHERE session_id = ?
`);

const upsertSessionStmt = db.prepare(`
  INSERT INTO chat_sessions (
    session_id,
    role_id,
    rolling_summary,
    stable_facts_json,
    recent_turns_json,
    custom_persona_json,
    total_turns,
    created_at,
    updated_at
  ) VALUES (
    @sessionId,
    @roleId,
    @rollingSummary,
    @stableFactsJson,
    @recentTurnsJson,
    @customPersonaJson,
    @totalTurns,
    @createdAt,
    @updatedAt
  )
  ON CONFLICT(session_id) DO UPDATE SET
    role_id = excluded.role_id,
    rolling_summary = excluded.rolling_summary,
    stable_facts_json = excluded.stable_facts_json,
    recent_turns_json = excluded.recent_turns_json,
    custom_persona_json = excluded.custom_persona_json,
    total_turns = excluded.total_turns,
    updated_at = excluded.updated_at
`);

const insertMessageStmt = db.prepare(`
  INSERT INTO chat_messages (
    session_id,
    role,
    content,
    timestamp
  ) VALUES (?, ?, ?, ?)
`);

const listMessagesStmt = db.prepare(`
  SELECT role, content, timestamp
  FROM chat_messages
  WHERE session_id = ?
  ORDER BY timestamp ASC, id ASC
`);

const deleteSessionStmt = db.prepare(`
  DELETE FROM chat_sessions
  WHERE session_id = ?
`);

export function getSession(
  sessionId: string
): ConversationSession | undefined {
  const row = selectSessionStmt.get(sessionId) as SessionRow | undefined;
  if (!row) return undefined;
  return mapRowToSession(row);
}

export function getOrCreateSession(
  sessionId: string,
  roleId: RoleId
): ConversationSession {
  const existing = getSession(sessionId);
  if (existing) return existing;

  const created = createEmptySession(sessionId, roleId);
  saveSession(created);
  return created;
}

export function saveSession(session: ConversationSession): void {
  session.updatedAt = Date.now();

  upsertSessionStmt.run({
    sessionId: session.sessionId,
    roleId: session.roleId,
    rollingSummary: session.rollingSummary,
    stableFactsJson: JSON.stringify(session.stableFacts),
    recentTurnsJson: JSON.stringify(session.recentTurns),
    customPersonaJson: JSON.stringify(session.customPersona),
    totalTurns: session.totalTurns,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  });
}

export function saveSessionTurn(
  sessionId: string,
  turn: SessionTurn
): void {
  insertMessageStmt.run(
    sessionId,
    turn.role,
    turn.content,
    turn.timestamp
  );
}

export function listSessionTurns(sessionId: string): SessionTurn[] {
  const rows = listMessagesStmt.all(sessionId) as MessageRow[];

  return rows.map((row) => ({
    role: row.role,
    content: row.content,
    timestamp: row.timestamp
  }));
}

export function deleteSession(sessionId: string): void {
  deleteSessionStmt.run(sessionId);
}