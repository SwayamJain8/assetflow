import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { verify } from "hono/jwt";

import { db } from "../../config/db";
import { env } from "../../config/env";
import { users } from "../../db/schema";
import { join, leave } from "../../services/realtime";
import type { AppEnv } from "../../types";

const { upgradeWebSocket, websocket } = createBunWebSocket();

/** Handed to Bun.serve() in index.ts — this is what actually enables WS. */
export { websocket };

export const realtimeRouter = new Hono<AppEnv>();

/**
 * GET /api/ws?token=<jwt>
 *
 * The token travels as a query parameter, not an Authorization header. That is
 * not laziness: the browser's WebSocket constructor cannot set headers. It is the
 * standard workaround, and it is acceptable here because the connection is
 * immediately upgraded to wss:// in production and the token is short-lived.
 *
 * The socket is scoped to the user's organization at connect time, so a client can
 * only ever receive invalidation hints for its own tenant.
 */
realtimeRouter.get(
  "/ws",
  upgradeWebSocket(async (c) => {
    const token = c.req.query("token");

    let orgId: string | null = null;
    let userId: string | null = null;

    if (token) {
      try {
        const payload = (await verify(token, env.JWT_SECRET, "HS256")) as {
          sub: string;
          org: string;
        };

        // Re-check the user still exists and is active — the same rule requireAuth
        // applies. A socket held open by a deactivated account would keep receiving
        // updates for an organization it has been removed from.
        const [user] = await db.select().from(users).where(eq(users.id, payload.sub));

        if (user && user.status === "active") {
          orgId = user.organizationId;
          userId = user.id;
        }
      } catch {
        // Fall through: an unauthenticated socket is simply closed below.
      }
    }

    return {
      onOpen(_event, ws) {
        if (!orgId || !userId) {
          ws.close(1008, "Unauthorized");
          return;
        }

        join(orgId, { ws, userId });

        ws.send(JSON.stringify({ type: "connected" }));
      },

      onClose(_event, ws) {
        if (orgId && userId) leave(orgId, { ws, userId });
      },

      onError(_event, ws) {
        if (orgId && userId) leave(orgId, { ws, userId });
      },
    };
  }),
);
