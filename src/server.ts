import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";

import chatRoutes from "./routes/chat.js";
import rolesRoutes from "./routes/roles.js";
import sessionRoutes from "./routes/sessions.js";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";

function parseAllowedOrigins(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins(process.env.FRONTEND_ORIGIN);

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) {
      cb(null, true);
      return;
    }

    if (allowedOrigins.length === 0) {
      cb(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
      cb(null, true);
      return;
    }

    cb(new Error("Origin not allowed"), false);
  }
});

app.get("/health", async () => {
  return {
    ok: true,
    service: "clinic-student-support-chatbot-backend"
  };
});

await app.register(rolesRoutes);
await app.register(chatRoutes);
await app.register(sessionRoutes);

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);

  const statusCode =
    typeof (error as { statusCode?: number }).statusCode === "number"
      ? (error as { statusCode?: number }).statusCode!
      : 500;

  const message =
    error instanceof Error ? error.message : "Internal server error";

  reply.status(statusCode).send({
    ok: false,
    error: statusCode >= 500 ? "Internal server error" : message
  });
});

try {
  await app.listen({
    port: PORT,
    host: HOST
  });

  app.log.info(`Backend listening on http://${HOST}:${PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}