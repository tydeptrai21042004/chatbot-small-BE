import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import {
  DEFAULT_ROLE_ID,
  getPersonaById,
  PERSONAS
} from "../prompts/personas.js";
import {
  composeSystemPrompt,
  createHelpNowReply,
  postProcessAssistantReply
} from "../prompts/safety.js";
import { generateChatReply } from "../services/gemini.js";
import {
  appendTurnToSession,
  buildMemoryContext,
  refreshSessionMemoryIfNeeded
} from "../services/memory.js";
import { assessCrisisRisk } from "../utils/crisis.js";
import {
  getOrCreateSession,
  saveSession,
  saveSessionTurn
} from "../utils/sessionStore.js";

const RoleIdSchema = z.enum(
  PERSONAS.map((item) => item.id) as [string, ...string[]]
);

const ChatBodySchema = z
  .object({
    sessionId: z.string().trim().min(8).max(128),
    message: z.string().trim().min(1).max(4000),
    roleId: RoleIdSchema.optional().default(DEFAULT_ROLE_ID),
    customPersonaEnabled: z.boolean().optional().default(false),
    customPersonaName: z.string().trim().max(80).optional().default(""),
    customPersonaPrompt: z.string().trim().max(2000).optional().default("")
  })
  .superRefine((data, ctx) => {
    if (data.customPersonaEnabled) {
      if (!data.customPersonaPrompt || data.customPersonaPrompt.trim().length < 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customPersonaPrompt"],
          message: "Custom personality prompt phải có ít nhất 10 ký tự."
        });
      }
    }
  });

function buildResponseMemoryMeta(input: {
  summaryUpdated: boolean;
  stableFactsCount: number;
  hasSummary: boolean;
  recentTurnsCount: number;
  usedFallbackSummary?: boolean;
}) {
  return {
    summaryUpdated: input.summaryUpdated,
    stableFactsCount: input.stableFactsCount,
    hasSummary: input.hasSummary,
    recentTurnsCount: input.recentTurnsCount,
    usedFallbackSummary: Boolean(input.usedFallbackSummary)
  };
}

function normalizeCustomPersona(input: {
  enabled: boolean;
  name?: string;
  prompt?: string;
}) {
  const enabled = Boolean(input.enabled);
  const name = input.name?.trim() || "Tính cách tự tạo";
  const prompt = input.prompt?.trim() || "";

  return {
    enabled,
    name,
    prompt
  };
}

function buildPersonaPrompt(input: {
  presetPrompt: string;
  customPersonaEnabled: boolean;
  customPersonaName?: string;
  customPersonaPrompt?: string;
}) {
  if (!input.customPersonaEnabled || !input.customPersonaPrompt?.trim()) {
    return {
      effectivePrompt: input.presetPrompt,
      customPersonaActive: false,
      customPersonaName: undefined as string | undefined
    };
  }

  const customName = input.customPersonaName?.trim() || "Tính cách tự tạo";

  const effectivePrompt = [
    input.presetPrompt,
    "",
    `Yêu cầu tính cách do người dùng tự tạo: ${customName}`,
    input.customPersonaPrompt.trim(),
    "",
    "Chỉ làm theo yêu cầu tính cách này nếu nó không xung đột với quy tắc an toàn hệ thống. Quy tắc an toàn luôn được ưu tiên cao hơn."
  ].join("\n");

  return {
    effectivePrompt,
    customPersonaActive: true,
    customPersonaName: customName
  };
}

const chatRoutes: FastifyPluginAsync = async (app) => {
  app.post("/chat", async (request, reply) => {
    const parsed = ChatBodySchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid request body",
        details: parsed.error.flatten()
      });
    }

    const {
      sessionId,
      message,
      roleId,
      customPersonaEnabled,
      customPersonaName,
      customPersonaPrompt
    } = parsed.data;

    const persona = getPersonaById(roleId);

    const session = getOrCreateSession(sessionId, persona.id);
    session.roleId = persona.id;

    const normalizedCustomPersona = normalizeCustomPersona({
      enabled: customPersonaEnabled,
      name: customPersonaName,
      prompt: customPersonaPrompt
    });

    if (normalizedCustomPersona.enabled) {
      session.customPersona = {
        enabled: true,
        name: normalizedCustomPersona.name,
        prompt: normalizedCustomPersona.prompt
      };
    } else {
      session.customPersona = {
        enabled: false,
        name: undefined,
        prompt: undefined
      };
    }

    const personaPromptConfig = buildPersonaPrompt({
      presetPrompt: persona.prompt,
      customPersonaEnabled: session.customPersona.enabled,
      customPersonaName: session.customPersona.name,
      customPersonaPrompt: session.customPersona.prompt
    });

    const riskHistory = [
      ...(session.rollingSummary
        ? [
            {
              role: "assistant" as const,
              content: `Tóm tắt trước đó: ${session.rollingSummary}`
            }
          ]
        : []),
      ...session.recentTurns.slice(-6).map((turn) => ({
        role: turn.role,
        content: turn.content
      }))
    ];

    const crisis = assessCrisisRisk({
      message,
      history: riskHistory
    });

    if (crisis.shouldBypassModel) {
      const helpNowReply = createHelpNowReply({
        helpNowContactText: process.env.HELP_NOW_CONTACT_TEXT
      });

      const userTurn = appendTurnToSession(session, "user", message);
      saveSessionTurn(session.sessionId, userTurn);

      const assistantTurn = appendTurnToSession(session, "assistant", helpNowReply);
      saveSessionTurn(session.sessionId, assistantTurn);

      const memoryRefresh = await refreshSessionMemoryIfNeeded(session);
      saveSession(session);

      return reply.send({
        ok: true,
        sessionId: session.sessionId,
        mode: "help_now",
        riskLevel: crisis.riskLevel,
        roleId: persona.id,
        reply: helpNowReply,
        crisis,
        memory: buildResponseMemoryMeta({
          summaryUpdated: memoryRefresh.updated,
          stableFactsCount: session.stableFacts.length,
          hasSummary: Boolean(session.rollingSummary),
          recentTurnsCount: session.recentTurns.length,
          usedFallbackSummary: memoryRefresh.usedFallback
        }),
        customPersona: {
          active: personaPromptConfig.customPersonaActive,
          name: personaPromptConfig.customPersonaName
        }
      });
    }

    try {
      const systemPrompt = composeSystemPrompt({
        personaPrompt: personaPromptConfig.effectivePrompt,
        riskLevel: crisis.riskLevel === "safe" ? "safe" : "distress"
      });

      const memoryContext = buildMemoryContext(session);

      const rawModelReply = await generateChatReply({
        systemPrompt,
        userMessage: message,
        recentTurns: memoryContext.recentTurns,
        rollingSummary: memoryContext.rollingSummary,
        stableFacts: memoryContext.stableFacts
      });

      const finalReply = postProcessAssistantReply(
        rawModelReply,
        crisis.riskLevel === "safe" ? "safe" : "distress"
      );

      const userTurn = appendTurnToSession(session, "user", message);
      saveSessionTurn(session.sessionId, userTurn);

      const assistantTurn = appendTurnToSession(session, "assistant", finalReply);
      saveSessionTurn(session.sessionId, assistantTurn);

      const memoryRefresh = await refreshSessionMemoryIfNeeded(session);
      saveSession(session);

      return reply.send({
        ok: true,
        sessionId: session.sessionId,
        mode: "normal",
        riskLevel: crisis.riskLevel,
        roleId: persona.id,
        reply: finalReply,
        crisis,
        memory: buildResponseMemoryMeta({
          summaryUpdated: memoryRefresh.updated,
          stableFactsCount: session.stableFacts.length,
          hasSummary: Boolean(session.rollingSummary),
          recentTurnsCount: session.recentTurns.length,
          usedFallbackSummary: memoryRefresh.usedFallback
        }),
        customPersona: {
          active: personaPromptConfig.customPersonaActive,
          name: personaPromptConfig.customPersonaName
        }
      });
    } catch (error) {
      request.log.error(error);

      const fallbackReply =
        crisis.riskLevel === "distress"
          ? "Mình nghe em đang rất mệt và rối. Mình vẫn ở đây với em. Lúc này mình gợi ý 2 bước ngắn: tìm chỗ ngồi ổn hơn nếu có thể, hít vào chậm 4 nhịp rồi thở ra chậm 6 nhịp 3 lần. Sau đó em nói cho mình biết điều gì đang làm em thấy nặng nhất ngay lúc này."
          : "Mình đang gặp trục trặc kỹ thuật một chút, nhưng vẫn muốn hỗ trợ em. Em có thể nói ngắn gọn điều đang làm em mệt nhất lúc này không?";

      const userTurn = appendTurnToSession(session, "user", message);
      saveSessionTurn(session.sessionId, userTurn);

      const assistantTurn = appendTurnToSession(session, "assistant", fallbackReply);
      saveSessionTurn(session.sessionId, assistantTurn);

      const memoryRefresh = await refreshSessionMemoryIfNeeded(session);
      saveSession(session);

      return reply.send({
        ok: true,
        sessionId: session.sessionId,
        mode: "fallback",
        riskLevel: crisis.riskLevel,
        roleId: persona.id,
        reply: fallbackReply,
        crisis,
        usedFallback: true,
        memory: buildResponseMemoryMeta({
          summaryUpdated: memoryRefresh.updated,
          stableFactsCount: session.stableFacts.length,
          hasSummary: Boolean(session.rollingSummary),
          recentTurnsCount: session.recentTurns.length,
          usedFallbackSummary: memoryRefresh.usedFallback
        }),
        customPersona: {
          active: personaPromptConfig.customPersonaActive,
          name: personaPromptConfig.customPersonaName
        }
      });
    }
  });
};

export default chatRoutes;