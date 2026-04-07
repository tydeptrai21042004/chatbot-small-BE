function formatTurns(turns) {
    if (turns.length === 0) {
        return "(no older turns to summarize)";
    }
    return turns
        .map((turn) => {
        const speaker = turn.role === "user" ? "User" : "Assistant";
        return `${speaker}: ${turn.content}`;
    })
        .join("\n");
}
export function buildMemorySummarizerSystemPrompt() {
    return `
You are a memory compressor for a Vietnamese student support chatbot.

Return STRICT JSON only with this exact shape:
{
  "summary": "string",
  "stableFacts": ["string"]
}

Rules:
- summary must be concise, useful for future support replies, and grounded only in the input
- keep the summary around 80 to 180 words when possible
- preserve only information that matters later:
  - main concerns
  - emotional pattern
  - safety concerns
  - family or school context
  - what has already been suggested
  - user preferences about tone or support style
- stableFacts must contain only durable facts that may still matter later
- stableFacts must be short, concrete, and max 8 items
- do not invent facts
- do not add markdown
- do not add any keys other than summary and stableFacts
`.trim();
}
export function buildMemorySummarizerUserPrompt(input) {
    const existingStableFacts = input.stableFacts.length > 0
        ? input.stableFacts.map((item) => `- ${item}`).join("\n")
        : "(none)";
    return `
CURRENT SUMMARY:
${input.existingSummary || "(none)"}

CURRENT STABLE FACTS:
${existingStableFacts}

OLDER TURNS TO COMPRESS:
${formatTurns(input.olderTurns)}

Update the memory now.
Return JSON only.
`.trim();
}
