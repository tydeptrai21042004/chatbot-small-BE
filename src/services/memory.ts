import type {
  ConversationSession,
  MemoryRefreshResult,
  SessionTurn,
  SessionTurnRole
} from "../types/session.js";
import { summarizeConversationMemory } from "./gemini.js";

const MAX_RECENT_TURNS_FOR_PROMPT = 8;
const KEEP_RAW_TURNS_AFTER_SUMMARY = 6;
const SUMMARY_TRIGGER_TURNS = 12;
const MAX_STABLE_FACTS = 8;
const MAX_TURN_CONTENT = 1200;
const MAX_SUMMARY_LENGTH = 1600;

function sanitizeText(input: string, maxLength: number): string {
  return input.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function mergeUniqueFacts(facts: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const fact of facts) {
    const cleaned = sanitizeText(fact, 180);
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push(cleaned);
  }

  return normalized.slice(0, MAX_STABLE_FACTS);
}

function extractHeuristicFacts(turns: SessionTurn[]): string[] {
  const userText = turns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content.toLowerCase())
    .join(" ");

  const facts: string[] = [];

  if (
    userText.includes("gia đình") ||
    userText.includes("ba mẹ") ||
    userText.includes("bố mẹ")
  ) {
    facts.push("Người dùng có vấn đề liên quan đến gia đình.");
  }

  if (
    userText.includes("trường") ||
    userText.includes("môn học") ||
    userText.includes("bài tập") ||
    userText.includes("thi") ||
    userText.includes("điểm")
  ) {
    facts.push("Người dùng có bối cảnh áp lực học tập hoặc trường học.");
  }

  if (
    userText.includes("hoảng") ||
    userText.includes("hoảng loạn") ||
    userText.includes("khó thở") ||
    userText.includes("run")
  ) {
    facts.push("Người dùng từng có dấu hiệu hoảng hoặc lo âu mạnh.");
  }

  if (
    userText.includes("không an toàn") ||
    userText.includes("bị đánh") ||
    userText.includes("đe dọa") ||
    userText.includes("ép buộc")
  ) {
    facts.push("Cần lưu ý yếu tố an toàn trong môi trường sống hoặc quan hệ gần gũi.");
  }

  return facts;
}

function buildFallbackSummary(
  existingSummary: string,
  olderTurns: SessionTurn[],
  existingStableFacts: string[]
): { summary: string; stableFacts: string[] } {
  const latestUserPoints = olderTurns
    .filter((turn) => turn.role === "user")
    .slice(-4)
    .map((turn) => `- ${sanitizeText(turn.content, 160)}`)
    .join("\n");

  const summaryParts: string[] = [];

  if (existingSummary.trim()) {
    summaryParts.push(existingSummary.trim());
  }

  if (latestUserPoints) {
    summaryParts.push(`Các nội dung quan trọng trước đó:\n${latestUserPoints}`);
  }

  const summary = sanitizeText(
    summaryParts.join("\n\n") || "Đã có hội thoại trước đó cần được tham chiếu khi trả lời tiếp.",
    MAX_SUMMARY_LENGTH
  );

  const stableFacts = mergeUniqueFacts([
    ...existingStableFacts,
    ...extractHeuristicFacts(olderTurns)
  ]);

  return {
    summary,
    stableFacts
  };
}

export function createSessionTurn(
  role: SessionTurnRole,
  content: string
): SessionTurn {
  return {
    role,
    content: sanitizeText(content, MAX_TURN_CONTENT),
    timestamp: Date.now()
  };
}

export function appendTurnToSession(
  session: ConversationSession,
  role: SessionTurnRole,
  content: string
): SessionTurn {
  const turn = createSessionTurn(role, content);
  session.recentTurns.push(turn);
  session.totalTurns += 1;
  session.updatedAt = Date.now();
  return turn;
}

export function buildMemoryContext(session: ConversationSession): {
  rollingSummary: string;
  stableFacts: string[];
  recentTurns: SessionTurn[];
} {
  return {
    rollingSummary: sanitizeText(session.rollingSummary, MAX_SUMMARY_LENGTH),
    stableFacts: mergeUniqueFacts(session.stableFacts),
    recentTurns: session.recentTurns
      .slice(-MAX_RECENT_TURNS_FOR_PROMPT)
      .map((turn) => ({
        ...turn,
        content: sanitizeText(turn.content, MAX_TURN_CONTENT)
      }))
  };
}

export async function refreshSessionMemoryIfNeeded(
  session: ConversationSession
): Promise<MemoryRefreshResult> {
  if (session.recentTurns.length <= SUMMARY_TRIGGER_TURNS) {
    return {
      updated: false,
      usedFallback: false
    };
  }

  const olderTurns = session.recentTurns.slice(0, -KEEP_RAW_TURNS_AFTER_SUMMARY);

  if (olderTurns.length === 0) {
    return {
      updated: false,
      usedFallback: false
    };
  }

  try {
    const nextMemory = await summarizeConversationMemory({
      existingSummary: session.rollingSummary,
      stableFacts: session.stableFacts,
      olderTurns
    });

    session.rollingSummary = sanitizeText(
      nextMemory.summary,
      MAX_SUMMARY_LENGTH
    );
    session.stableFacts = mergeUniqueFacts(nextMemory.stableFacts);
    session.recentTurns = session.recentTurns.slice(-KEEP_RAW_TURNS_AFTER_SUMMARY);
    session.updatedAt = Date.now();

    return {
      updated: true,
      usedFallback: false
    };
  } catch {
    const fallback = buildFallbackSummary(
      session.rollingSummary,
      olderTurns,
      session.stableFacts
    );

    session.rollingSummary = fallback.summary;
    session.stableFacts = fallback.stableFacts;
    session.recentTurns = session.recentTurns.slice(-KEEP_RAW_TURNS_AFTER_SUMMARY);
    session.updatedAt = Date.now();

    return {
      updated: true,
      usedFallback: true
    };
  }
}