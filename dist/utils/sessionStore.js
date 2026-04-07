const sessions = new Map();
const sessionMessages = new Map();
function createEmptySession(sessionId, roleId) {
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
function cloneTurn(turn) {
    return {
        role: turn.role,
        content: turn.content,
        timestamp: turn.timestamp
    };
}
function cloneSession(session) {
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
export function getSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session)
        return undefined;
    return cloneSession(session);
}
export function getOrCreateSession(sessionId, roleId) {
    const existing = sessions.get(sessionId);
    if (existing) {
        return cloneSession(existing);
    }
    const created = createEmptySession(sessionId, roleId);
    sessions.set(sessionId, cloneSession(created));
    sessionMessages.set(sessionId, []);
    return created;
}
export function saveSession(session) {
    session.updatedAt = Date.now();
    sessions.set(session.sessionId, cloneSession(session));
}
export function saveSessionTurn(sessionId, turn) {
    const existing = sessionMessages.get(sessionId) ?? [];
    existing.push(cloneTurn(turn));
    sessionMessages.set(sessionId, existing);
}
export function listSessionTurns(sessionId) {
    return (sessionMessages.get(sessionId) ?? []).map(cloneTurn);
}
export function deleteSession(sessionId) {
    sessions.delete(sessionId);
    sessionMessages.delete(sessionId);
}
