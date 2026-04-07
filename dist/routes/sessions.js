import { z } from "zod";
import { listSessionTurns } from "../utils/sessionStore.js";
const ParamsSchema = z.object({
    sessionId: z.string().trim().min(8).max(128)
});
const sessionRoutes = async (app) => {
    app.get("/sessions/:sessionId/messages", async (request, reply) => {
        const parsed = ParamsSchema.safeParse(request.params);
        if (!parsed.success) {
            return reply.status(400).send({
                ok: false,
                error: "Invalid session id"
            });
        }
        const { sessionId } = parsed.data;
        const messages = listSessionTurns(sessionId);
        return reply.send({
            ok: true,
            sessionId,
            messages
        });
    });
};
export default sessionRoutes;
