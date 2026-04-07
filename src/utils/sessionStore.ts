import type { RoleId } from "../prompts/personas.js";
import type {
  ConversationSession,
  SessionTurn
} from "../types/session.js";

const sessions = new Map<string, ConversationSession>();
const sessionMessages = new Map<string, SessionTurn[]>();

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

function cloneTurn(turn: SessionTurn): SessionTurn {
  return {
    role: turn.role,
    content: turn.content,
    timestamp: turn.timestamp
  };
}

function cloneSession(session: ConversationSession): ConversationSession {
  return {
    sessionId: session.sessionId,
    roleId: session.roleId,
    rollingSummary: session.rollingSummary,
    stableFacts: [...session.stableFacts],
    recentTurns: session.recentTurns.map(cloneTurn),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    totalTurns: session.totalTurns,
    customPersona: {
      enabled: session.customPersona.enabled,
      name: session.customPersona.name,
      prompt: session.customPersona.prompt
    }
  };
}

export function getSession(
  sessionId: string
): ConversationSession | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  return cloneSession(session);
}

export function getOrCreateSession(
  sessionId: string,
  roleId: RoleId
): ConversationSession {
  const existing = sessions.get(sessionId);
  if (existing) {
    return cloneSession(existing);
  }

  const created = createEmptySession(sessionId, roleId);
  sessions.set(sessionId, cloneSession(created));
  sessionMessages.set(sessionId, []);
  return created;
}

export function saveSession(session: ConversationSession): void {
  session.updatedAt = Date.now();
  sessions.set(session.sessionId, cloneSession(session));
}

export function saveSessionTurn(
  sessionId: string,
  turn: SessionTurn
): void {
  const existing = sessionMessages.get(sessionId) ?? [];
  existing.push(cloneTurn(turn));
  sessionMessages.set(sessionId, existing);
}

export function listSessionTurns(sessionId: string): SessionTurn[] {
  return (sessionMessages.get(sessionId) ?? []).map(cloneTurn);
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
  sessionMessages.delete(sessionId);
}
