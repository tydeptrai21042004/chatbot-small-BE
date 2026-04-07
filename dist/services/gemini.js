import { buildMemorySummarizerSystemPrompt, buildMemorySummarizerUserPrompt } from "../prompts/summarizer.js";
function isDebugEnabled() {
    return process.env.DEBUG_GEMINI?.trim() === "1";
}
function isFullDebugEnabled() {
    return process.env.DEBUG_GEMINI_FULL_RESPONSE?.trim() === "1";
}
function debugLog(label, payload) {
    if (!isDebugEnabled())
        return;
    const now = new Date().toISOString();
    if (typeof payload === "undefined") {
        console.log(`[gemini-debug][${now}] ${label}`);
        return;
    }
    console.log(`[gemini-debug][${now}] ${label}`, payload);
}
function clip(text, max = 240) {
    if (text.length <= max)
        return text;
    return `${text.slice(0, max)} ... [cut] ... ${text.slice(-max)}`;
}
function getRequiredEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
function getGeminiApiKeys() {
    const keys = [
        process.env.GEMINI_API_KEY_1?.trim(),
        process.env.GEMINI_API_KEY_2?.trim(),
        process.env.GEMINI_API_KEY?.trim()
    ].filter((value) => Boolean(value));
    if (keys.length === 0) {
        throw new Error("Missing Gemini API key. Set GEMINI_API_KEY_1 and GEMINI_API_KEY_2 in backend/.env");
    }
    return [...new Set(keys)];
}
function getEnvNumber(name, fallback) {
    const raw = process.env[name]?.trim();
    if (!raw)
        return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed))
        return fallback;
    return parsed;
}
function getThinkingBudget() {
    return getEnvNumber("GEMINI_THINKING_BUDGET", 0);
}
function sanitizeText(input, maxLength) {
    return input.replace(/\s+/g, " ").trim().slice(0, maxLength);
}
function normalizeTurns(turns) {
    if (!turns)
        return [];
    return turns
        .slice(-8)
        .map((turn) => ({
        ...turn,
        content: sanitizeText(turn.content, 1200)
    }))
        .filter((turn) => turn.content.length > 0);
}
function formatTurnsForPrompt(turns) {
    if (turns.length === 0) {
        return "(chưa có lượt hội thoại gần đây)";
    }
    return turns
        .map((turn) => {
        const speaker = turn.role === "user" ? "Người dùng" : "Trợ lý";
        return `${speaker}: ${turn.content}`;
    })
        .join("\n");
}
function formatStableFacts(stableFacts) {
    if (!stableFacts || stableFacts.length === 0) {
        return "(chưa có dữ kiện ổn định)";
    }
    return stableFacts
        .slice(0, 8)
        .map((fact) => `- ${sanitizeText(fact, 180)}`)
        .join("\n");
}
function buildChatUserPrompt(input) {
    const recentTurns = normalizeTurns(input.recentTurns);
    return `
BỐI CẢNH ỔN ĐỊNH CỦA NGƯỜI DÙNG:
${formatStableFacts(input.stableFacts)}

TÓM TẮT HỘI THOẠI TRƯỚC ĐÓ:
${input.rollingSummary?.trim() || "(chưa có tóm tắt trước đó)"}

CÁC LƯỢT HỘI THOẠI GẦN ĐÂY:
${formatTurnsForPrompt(recentTurns)}

TIN NHẮN MỚI NHẤT CỦA NGƯỜI DÙNG:
${sanitizeText(input.userMessage, 4000)}

Hãy trả lời tin nhắn mới nhất.
Yêu cầu:
- trả lời bằng tiếng Việt tự nhiên
- ngắn gọn nhưng trọn ý
- không dừng giữa câu
- nếu cần ngắn thì vẫn phải gồm: xác nhận ngắn + gợi ý cụ thể hoặc câu hỏi tiếp theo
`.trim();
}
function extractTextFromResponse(data) {
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const text = parts
        .map((part) => part.text ?? "")
        .join("")
        .trim();
    return {
        text,
        finishReason: candidate?.finishReason,
        usage: data.usageMetadata
    };
}
function looksIncomplete(text) {
    const cleaned = text.trim();
    if (!cleaned)
        return true;
    if (cleaned.length < 24)
        return true;
    const completeEnding = /[.!?…"”'’)\]]$/;
    if (completeEnding.test(cleaned))
        return false;
    const incompleteEnding = /(?:và|hay|hoặc|nhưng|vì|nên|rồi|để|khi|nếu|là|thì|còn|giờ|lúc này|bây giờ)$/i;
    if (incompleteEnding.test(cleaned))
        return true;
    if (/[,:;–-]$/.test(cleaned))
        return true;
    return true;
}
async function generateModelText(input) {
    const apiKeys = getGeminiApiKeys();
    const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
    const thinkingBudget = getThinkingBudget();
    const debugLabel = input.debugLabel ?? "call";
    debugLog(`${debugLabel}: request start`, {
        model,
        keyCount: apiKeys.length,
        thinkingBudget,
        maxOutputTokens: input.maxOutputTokens,
        temperature: input.temperature,
        responseMimeType: input.responseMimeType ?? null,
        systemPromptLength: input.systemPrompt.length,
        userPromptLength: input.userPrompt.length,
        systemPromptPreview: clip(input.systemPrompt, 180),
        userPromptPreview: clip(input.userPrompt, 260)
    });
    let lastErrorMessage = "Gemini API request failed";
    for (let i = 0; i < apiKeys.length; i++) {
        const apiKey = apiKeys[i];
        const keyLabel = `key_${i + 1}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            debugLog(`${debugLabel}: trying ${keyLabel}`);
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                signal: controller.signal,
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{ text: input.systemPrompt }]
                    },
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: input.userPrompt }]
                        }
                    ],
                    generationConfig: {
                        temperature: input.temperature,
                        topP: 0.9,
                        maxOutputTokens: input.maxOutputTokens,
                        thinkingConfig: {
                            thinkingBudget
                        },
                        ...(input.responseMimeType
                            ? { responseMimeType: input.responseMimeType }
                            : {})
                    }
                })
            });
            const data = (await response.json());
            debugLog(`${debugLabel}: ${keyLabel} response status`, {
                ok: response.ok,
                status: response.status,
                candidateCount: data.candidates?.length ?? 0,
                usageMetadata: data.usageMetadata ?? null,
                thoughtsTokenCount: data.usageMetadata?.thoughtsTokenCount ?? 0,
                apiError: data.error?.message ?? null
            });
            if (isFullDebugEnabled()) {
                debugLog(`${debugLabel}: ${keyLabel} raw response`, data);
            }
            if (!response.ok) {
                lastErrorMessage =
                    data.error?.message || `Gemini API request failed with status ${response.status}`;
                if (response.status === 429 && i < apiKeys.length - 1) {
                    debugLog(`${debugLabel}: ${keyLabel} hit limit, switching to next key`);
                    continue;
                }
                throw new Error(lastErrorMessage);
            }
            const parsed = extractTextFromResponse(data);
            debugLog(`${debugLabel}: ${keyLabel} parsed response`, {
                finishReason: parsed.finishReason ?? null,
                textLength: parsed.text.length,
                looksIncomplete: looksIncomplete(parsed.text),
                textPreview: clip(parsed.text, 260),
                usage: parsed.usage ?? null
            });
            if (!parsed.text) {
                throw new Error("Gemini returned an empty response");
            }
            return parsed;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unknown Gemini error";
            lastErrorMessage = message;
            if (i < apiKeys.length - 1) {
                debugLog(`${debugLabel}: ${keyLabel} failed, switching to next key`, {
                    error: message
                });
                continue;
            }
            throw error;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    throw new Error(lastErrorMessage);
}
function parseJsonObject(raw) {
    const cleaned = raw
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();
    try {
        return JSON.parse(cleaned);
    }
    catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) {
            throw new Error("Could not find JSON object in summarizer output");
        }
        return JSON.parse(match[0]);
    }
}
async function completeIfNeeded(input) {
    const incomplete = looksIncomplete(input.partialText);
    const maxTokenStop = input.finishReason === "MAX_TOKENS";
    const needsContinuation = incomplete || maxTokenStop;
    debugLog("continuation: decision", {
        finishReason: input.finishReason ?? null,
        partialLength: input.partialText.length,
        looksIncomplete: incomplete,
        maxTokenStop,
        needsContinuation,
        partialPreview: clip(input.partialText, 220)
    });
    if (!needsContinuation) {
        return input.partialText;
    }
    const continuationPrompt = `
Đây là câu trả lời trước đó của bạn, nhưng nó có vẻ bị dừng giữa chừng:

"${input.partialText}"

Hãy viết lại hoàn chỉnh câu trả lời đó bằng tiếng Việt.
Yêu cầu:
- không lặp lại dài dòng
- giữ cùng ý chính
- phải kết thúc trọn câu
- ngắn gọn nhưng đầy đủ
`.trim();
    const continued = await generateModelText({
        systemPrompt: input.systemPrompt,
        userPrompt: `${input.originalUserPrompt}\n\n${continuationPrompt}`,
        maxOutputTokens: 700,
        temperature: 0.4,
        debugLabel: "continuation-call"
    });
    debugLog("continuation: result", {
        finishReason: continued.finishReason ?? null,
        textLength: continued.text.length,
        looksIncomplete: looksIncomplete(continued.text),
        textPreview: clip(continued.text, 260),
        usage: continued.usage ?? null
    });
    return continued.text.trim() || input.partialText;
}
export async function generateChatReply(input) {
    const userPrompt = buildChatUserPrompt(input);
    debugLog("chat: build prompt", {
        rollingSummaryLength: input.rollingSummary?.length ?? 0,
        stableFactsCount: input.stableFacts?.length ?? 0,
        recentTurnsCount: input.recentTurns?.length ?? 0,
        latestUserMessageLength: input.userMessage.length,
        latestUserMessagePreview: clip(input.userMessage, 180)
    });
    const first = await generateModelText({
        systemPrompt: input.systemPrompt,
        userPrompt,
        maxOutputTokens: 700,
        temperature: 0.7,
        debugLabel: "chat-first-call"
    });
    const completed = await completeIfNeeded({
        systemPrompt: input.systemPrompt,
        originalUserPrompt: userPrompt,
        partialText: first.text,
        finishReason: first.finishReason
    });
    debugLog("chat: final return", {
        firstFinishReason: first.finishReason ?? null,
        firstLength: first.text.length,
        finalLength: completed.length,
        finalLooksIncomplete: looksIncomplete(completed),
        finalPreview: clip(completed, 260),
        firstUsage: first.usage ?? null
    });
    return completed;
}
export async function summarizeConversationMemory(input) {
    debugLog("summary: input", {
        existingSummaryLength: input.existingSummary?.length ?? 0,
        stableFactsCount: input.stableFacts?.length ?? 0,
        olderTurnsCount: input.olderTurns.length
    });
    const raw = await generateModelText({
        systemPrompt: buildMemorySummarizerSystemPrompt(),
        userPrompt: buildMemorySummarizerUserPrompt({
            existingSummary: input.existingSummary?.trim() || "",
            stableFacts: input.stableFacts ?? [],
            olderTurns: normalizeTurns(input.olderTurns)
        }),
        maxOutputTokens: 350,
        temperature: 0.2,
        responseMimeType: "application/json",
        debugLabel: "summary-call"
    });
    const parsed = parseJsonObject(raw.text);
    const summary = typeof parsed.summary === "string"
        ? sanitizeText(parsed.summary, 1600)
        : "";
    const stableFacts = Array.isArray(parsed.stableFacts)
        ? parsed.stableFacts
            .filter((item) => typeof item === "string")
            .map((item) => sanitizeText(item, 180))
            .filter(Boolean)
            .slice(0, 8)
        : [];
    debugLog("summary: parsed", {
        summaryLength: summary.length,
        stableFactsCount: stableFacts.length,
        summaryPreview: clip(summary, 220),
        stableFacts
    });
    if (!summary) {
        throw new Error("Summarizer returned invalid summary");
    }
    return {
        summary,
        stableFacts
    };
}
