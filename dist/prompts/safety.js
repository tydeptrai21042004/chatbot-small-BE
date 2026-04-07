const BASE_SAFETY_SYSTEM_PROMPT = `
Bạn là chatbot hỗ trợ tâm lý mức độ ban đầu cho sinh viên Việt Nam.
Nguyên tắc bắt buộc:
- luôn trả lời bằng tiếng Việt tự nhiên
- hỗ trợ cảm xúc và định hướng bước tiếp theo nhỏ, KHÔNG chẩn đoán
- KHÔNG nói rằng bạn là bác sĩ, nhà trị liệu, luật sư, hay chuyên gia đã cấp phép
- KHÔNG hứa giữ bí mật tuyệt đối
- KHÔNG khuyến khích người dùng làm hại bản thân hoặc người khác
- KHÔNG trách móc, đổ lỗi, gây áp lực hoặc coi nhẹ nỗi đau
- KHÔNG khuyên đối đầu trực tiếp với người đang gây bạo lực hay đe dọa
- nếu người dùng có dấu hiệu nguy hiểm cấp tính, ưu tiên an toàn ngay hơn là trò chuyện dài
- nếu chưa rõ tình hình, hỏi 1 câu ngắn để làm rõ mức độ an toàn
- giữ câu trả lời ngắn, rõ, bình tĩnh, dễ làm theo
- câu trả lời phải trọn ý, không được dừng giữa câu
- nếu trả lời ngắn thì vẫn phải hoàn chỉnh, ít nhất gồm: xác nhận ngắn + 1 gợi ý cụ thể hoặc 1 câu hỏi tiếp theo
- ưu tiên các bước nhỏ: thở, rời nơi nguy hiểm, tìm người lớn đáng tin cậy, liên hệ bộ phận hỗ trợ phù hợp
`.trim();
const DISTRESS_MODE_ADDON = `
Người dùng đang có dấu hiệu căng thẳng hoặc đau khổ.
Yêu cầu thêm:
- mở đầu bằng xác nhận cảm xúc
- ưu tiên 1 đến 3 bước nhỏ
- có thể gợi ý grounding ngắn hoặc tạm dừng để ổn định
- tránh trả lời quá dài hoặc quá lý thuyết
- không được kết thúc giữa câu hoặc giữa ý
`.trim();
export function composeSystemPrompt(input) {
    const blocks = [BASE_SAFETY_SYSTEM_PROMPT, input.personaPrompt];
    if (input.riskLevel === "distress") {
        blocks.push(DISTRESS_MODE_ADDON);
    }
    return blocks.join("\n\n");
}
export function createHelpNowReply(options) {
    const helpNowContactText = options?.helpNowContactText?.trim() ||
        "Nếu có thể, hãy liên hệ ngay một người lớn đáng tin cậy, bộ phận hỗ trợ của trường, hoặc dịch vụ khẩn cấp tại nơi em đang ở.";
    return [
        "Mình rất lo cho sự an toàn của em lúc này.",
        "",
        "Nếu em đang có nguy cơ bị làm hại, bị ép buộc, hoặc có ý định làm hại bản thân ngay bây giờ, hãy ưu tiên an toàn trước:",
        "1. Di chuyển tới nơi có người khác hoặc nơi em thấy an toàn hơn nếu làm vậy không khiến em nguy hiểm hơn.",
        "2. Gọi hoặc nhắn ngay cho một người lớn đáng tin cậy để nói rằng em cần họ ở cùng em ngay lúc này.",
        `3. ${helpNowContactText}`,
        "",
        "Nếu em muốn, em có thể gửi ngay một tin nhắn rất ngắn như:",
        `"Em đang không an toàn. Anh/chị/cô/chú có thể gọi cho em hoặc ở cùng em ngay bây giờ được không?"`,
        "",
        "Nếu hiện tại em chưa thể gọi ai, hãy nhắn cho mình biết một câu ngắn:",
        `"Em đang ở một mình" hoặc "Em đang ở gần người khác", để mình hỗ trợ bước tiếp theo thật ngắn gọn.`
    ].join("\n");
}
const FORBIDDEN_PATTERNS = [
    /\btôi là bác sĩ\b/i,
    /\btôi là nhà trị liệu\b/i,
    /\btôi chẩn đoán\b/i,
    /\bchẩn đoán của tôi\b/i,
    /\bgiữ bí mật tuyệt đối\b/i,
    /\bđối đầu với\b/i
];
export function postProcessAssistantReply(rawReply, riskLevel) {
    const cleaned = rawReply.replace(/\n{3,}/g, "\n\n").trim();
    if (!cleaned) {
        return riskLevel === "distress"
            ? "Mình nghe em đang rất mệt và rối. Mình ở đây với em. Lúc này mình gợi ý 2 bước ngắn: uống một ngụm nước nếu có thể, rồi nói cho mình biết điều gì đang làm em thấy nặng nhất ngay lúc này."
            : "Mình đang ở đây để lắng nghe. Em có thể kể ngắn gọn điều đang làm em mệt nhất lúc này không?";
    }
    for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(cleaned)) {
            return riskLevel === "distress"
                ? "Mình nghe em đang rất căng. Mình không thể chẩn đoán, nhưng mình có thể cùng em đi từng bước nhỏ để an toàn hơn và bớt quá tải hơn. Em muốn bắt đầu từ việc ổn định cảm xúc trước hay từ việc xử lý tình huống đang làm em sợ?"
                : "Mình không thể chẩn đoán, nhưng mình có thể hỗ trợ em suy nghĩ rõ hơn và chọn bước tiếp theo phù hợp. Em muốn mình giúp theo hướng lắng nghe hay theo hướng từng bước cụ thể?";
        }
    }
    return cleaned;
}
