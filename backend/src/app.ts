import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

import { env } from "./config/env";
import { onError, onNotFound, type ApiErrorBody } from "./middleware/error-handler";
import { healthRouter } from "./modules/health/health.routes";

/**
 * Builds the Hono app. Kept separate from the server entry point (index.ts) so
 * tests can import the app and call `app.request(...)` without opening a port.
 */
export function createApp() {
  const app = new OpenAPIHono({
    /**
     * Runs whenever a request fails its Zod schema. Without this, Hono returns
     * a raw ZodError; with it, invalid input produces the same error envelope as
     * everything else, naming the exact field that failed:
     *
     *   { "error": { "code": "VALIDATION_ERROR",
     *                "details": [{ "field": "email", "message": "Invalid email" }] } }
     */
    defaultHook: (result, c) => {
      if (result.success) return;

      return c.json<ApiErrorBody>(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "The request contains invalid data.",
            details: result.error.issues.map((issue) => ({
              field: issue.path.join(".") || "(root)",
              message: issue.message,
            })),
          },
        },
        422,
      );
    },
  });

  app.use("*", logger());
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: env.CORS_ORIGINS,
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  );

  app.onError(onError);
  app.notFound(onNotFound);

  // One module per domain (assets, allocation, booking, maintenance, audit...).
  // Each mounts its own router here.
  app.route("/api", healthRouter);

  // Auto-generated from the same Zod schemas the routes validate against, so the
  // docs can never drift from the implementation.
  app.doc("/api/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "AssetFlow API",
      version: "0.1.0",
      description: "Enterprise Asset & Resource Management System.",
    },
  });

  app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));

  return app;
}

export type App = ReturnType<typeof createApp>;
