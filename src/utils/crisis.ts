import type { RiskLevel } from "../prompts/safety.js";

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export interface CrisisAssessment {
  riskLevel: RiskLevel;
  shouldBypassModel: boolean;
  matchedTerms: string[];
  reasons: string[];
  flags: {
    selfHarm: boolean;
    suicide: boolean;
    violence: boolean;
    coercion: boolean;
    panic: boolean;
    immediateDanger: boolean;
  };
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, patterns: string[]): string[] {
  return patterns.filter((pattern) => text.includes(pattern));
}

const SUICIDE_PATTERNS = [
  "tự tử",
  "muốn chết",
  "không muốn sống",
  "kết thúc cuộc đời",
  "biến mất luôn",
  "muốn biến mất",
  "muốn tự làm hại",
  "tự làm hại bản thân",
  "cắt tay",
  "uống thuốc quá liều",
  "nhảy lầu",
  "treo cổ"
];

const SELF_HARM_DISTRESS_PATTERNS = [
  "ghét bản thân",
  "muốn làm đau bản thân",
  "không chịu nổi nữa",
  "hết cách rồi",
  "mình vô dụng",
  "em vô dụng",
  "muốn biến mất khỏi đây"
];

const VIOLENCE_PATTERNS = [
  "bạo lực gia đình",
  "bị đánh",
  "đánh em",
  "đánh mình",
  "tát em",
  "dọa đánh",
  "đe dọa",
  "khống chế",
  "nhốt",
  "đuổi khỏi nhà",
  "ép buộc",
  "cưỡng ép"
];

const COERCION_PATTERNS = [
  "ép em",
  "ép mình",
  "bị ép",
  "bị kiểm soát",
  "không cho ra ngoài",
  "không cho gặp ai",
  "bắt phải làm"
];

const PANIC_PATTERNS = [
  "hoảng loạn",
  "khó thở",
  "tim đập nhanh",
  "run",
  "không thở nổi",
  "muốn ngất",
  "quá sợ",
  "không kiểm soát được"
];

const IMMEDIATE_DANGER_PATTERNS = [
  "ngay bây giờ",
  "lúc này",
  "hôm nay",
  "tối nay",
  "sắp",
  "bây giờ",
  "nguy hiểm",
  "không an toàn",
  "ở một mình với",
  "họ đang ở đây",
  "người đó đang ở đây"
];

export function assessCrisisRisk(input: {
  message: string;
  history?: ChatHistoryMessage[];
}): CrisisAssessment {
  const historyText = (input.history ?? [])
    .slice(-6)
    .filter((item) => item.role === "user")
    .map((item) => item.content)
    .join(" ");

  const merged = normalizeText(`${historyText} ${input.message}`);

  const suicideHits = hasAny(merged, SUICIDE_PATTERNS);
  const selfHarmHits = hasAny(merged, SELF_HARM_DISTRESS_PATTERNS);
  const violenceHits = hasAny(merged, VIOLENCE_PATTERNS);
  const coercionHits = hasAny(merged, COERCION_PATTERNS);
  const panicHits = hasAny(merged, PANIC_PATTERNS);
  const immediateHits = hasAny(merged, IMMEDIATE_DANGER_PATTERNS);

  const flags = {
    selfHarm: selfHarmHits.length > 0 || suicideHits.length > 0,
    suicide: suicideHits.length > 0,
    violence: violenceHits.length > 0,
    coercion: coercionHits.length > 0,
    panic: panicHits.length > 0,
    immediateDanger: immediateHits.length > 0
  };

  const matchedTerms = [
    ...suicideHits,
    ...selfHarmHits,
    ...violenceHits,
    ...coercionHits,
    ...panicHits,
    ...immediateHits
  ];

  const reasons: string[] = [];

  if (flags.suicide) {
    reasons.push("Phát hiện dấu hiệu liên quan đến tự tử hoặc tự hại cấp tính.");
  }

  if ((flags.violence || flags.coercion) && flags.immediateDanger) {
    reasons.push("Có dấu hiệu không an toàn hoặc bị đe dọa ngay lúc này.");
  }

  if (flags.panic) {
    reasons.push("Có dấu hiệu hoảng loạn hoặc mất ổn định mạnh.");
  }

  if (flags.selfHarm && !flags.suicide) {
    reasons.push("Có dấu hiệu đau khổ nghiêm trọng hoặc ý nghĩ tự làm đau bản thân.");
  }

  let riskLevel: RiskLevel = "safe";
  let shouldBypassModel = false;

  if (flags.suicide || ((flags.violence || flags.coercion) && flags.immediateDanger)) {
    riskLevel = "high_risk";
    shouldBypassModel = true;
  } else if (
    flags.panic ||
    flags.selfHarm ||
    flags.violence ||
    flags.coercion
  ) {
    riskLevel = "distress";
  }

  return {
    riskLevel,
    shouldBypassModel,
    matchedTerms: Array.from(new Set(matchedTerms)),
    reasons,
    flags
  };
}