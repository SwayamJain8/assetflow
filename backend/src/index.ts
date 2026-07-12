import { createApp } from "./app";
import { env } from "./config/env";
import { closeDatabase, pingDatabase } from "./config/db";

const app = createApp();

if (!(await pingDatabase())) {
  console.warn("Starting with an unreachable database — /api/health will report 'degraded'.");
}

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

console.log(`AssetFlow API listening on http://localhost:${server.port} (${env.NODE_ENV})`);
console.log(`API docs:     http://localhost:${server.port}/api/docs`);

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
