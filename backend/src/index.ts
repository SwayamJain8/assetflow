import { createApp } from "./app";
import { env } from "./config/env";
import { closeDatabase, pingDatabase } from "./config/db";
import { runMigrations } from "./db/migrate";
import { startScheduler } from "./jobs";
import { websocket } from "./modules/realtime/realtime.routes";

const app = createApp();

if (!(await pingDatabase())) {
  console.warn("Starting with an unreachable database — /api/health will report 'degraded'.");
} else {
  // Bring the schema up to date before serving a single request. drizzle-kit is a
  // dev dependency and is absent from the production image, so this cannot be a
  // CLI step — see db/migrate.ts.
  await runMigrations();
}

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,

  // Bun's native WebSocket support. `websocket` comes from Hono's
  // createBunWebSocket(); without passing it here, the upgrade in
  // modules/realtime would silently never complete.
  websocket,
});

startScheduler();

console.log(`AssetFlow API listening on http://localhost:${server.port} (${env.NODE_ENV})`);
console.log(`API docs:     http://localhost:${server.port}/api/docs`);
console.log(`WebSocket:    ws://localhost:${server.port}/api/ws?token=<jwt>`);

/**
 * Docker sends SIGTERM on `docker stop`. Draining in-flight requests and closing
 * the pool prevents dropped requests and leaked PostgreSQL connections on deploy.
 */
async function shutdown(signal: string) {
  console.log(`\n${signal} received — shutting down.`);
  await server.stop();
  await closeDatabase();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
