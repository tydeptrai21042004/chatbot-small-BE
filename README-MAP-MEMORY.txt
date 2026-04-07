This backend version removes SQLite completely.

What changed:
- Removed src/db/sqlite.ts
- Removed better-sqlite3 dependencies from package.json
- Replaced src/utils/sessionStore.ts with an in-memory Map store
- Removed the SQLite startup import from src/server.ts

Behavior:
- Session and message history now live only in Node memory.
- Data is lost when the server restarts, Vercel cold starts a new instance, or a new deployment happens.
- GET /sessions/:sessionId/messages still works, but only for the current live instance.

Install:
1. npm install
2. npm run dev
