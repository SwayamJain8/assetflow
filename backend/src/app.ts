import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

import { env } from "./config/env";
import { createRouter } from "./lib/router";
import { onError, onNotFound } from "./middleware/error-handler";
import { allocationsRouter } from "./modules/allocations/allocations.routes";
import { assetsRouter } from "./modules/assets/assets.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { bookingsRouter } from "./modules/bookings/bookings.routes";
import { categoriesRouter } from "./modules/categories/categories.routes";
import { departmentsRouter } from "./modules/departments/departments.routes";
import { filesRouter } from "./modules/files/files.routes";
import { healthRouter } from "./modules/health/health.routes";
import { usersRouter } from "./modules/users/users.routes";

/**
 * Builds the Hono app. Kept separate from the server entry point (index.ts) so
 * tests can import the app and call `app.request(...)` without opening a port.
 */
export function createApp() {
  const app = createRouter();

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
  app.route("/api", authRouter);
  app.route("/api", departmentsRouter);
  app.route("/api", categoriesRouter);
  app.route("/api", usersRouter);
  app.route("/api", assetsRouter);
  app.route("/api", allocationsRouter);
  app.route("/api", bookingsRouter);
  app.route("/api", filesRouter);

  app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });

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
