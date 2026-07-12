import { createRoute, z } from "@hono/zod-openapi";

import { pingDatabase } from "../../config/db";
import { createRouter } from "../../lib/router";

const HealthResponse = z
  .object({
    status: z.enum(["ok", "degraded"]),
    uptimeSeconds: z.number(),
    database: z.enum(["up", "down"]),
  })
  .openapi("HealthResponse");

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Liveness and database-connectivity check",
  responses: {
    200: {
      description: "The API is up. `database` reports whether PostgreSQL responded.",
      content: { "application/json": { schema: HealthResponse } },
    },
    503: {
      description: "The API is up but PostgreSQL is unreachable.",
      content: { "application/json": { schema: HealthResponse } },
    },
  },
});

export const healthRouter = createRouter().openapi(healthRoute, async (c) => {
  const databaseUp = await pingDatabase();

  const body = {
    status: databaseUp ? ("ok" as const) : ("degraded" as const),
    uptimeSeconds: Math.round(process.uptime()),
    database: databaseUp ? ("up" as const) : ("down" as const),
  };

  // A 503 when the DB is down is what lets a load balancer pull this instance.
  return c.json(body, databaseUp ? 200 : 503);
});
