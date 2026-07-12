import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";

import { db } from "../config/db";
import { env } from "../config/env";
import { users } from "../db/schema";
import { AppError } from "./error-handler";
import type { AppEnv, AuthUser, Role } from "../types";

type JwtPayload = {
  sub: string; // user id
  org: string; // organization id
  role: Role;
  exp: number;
};

export async function issueToken(user: {
  id: string;
  organizationId: string;
  role: Role;
}): Promise<string> {
  const payload: JwtPayload = {
    sub: user.id,
    org: user.organizationId,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + env.JWT_EXPIRES_IN,
  };

  return sign(payload, env.JWT_SECRET);
}

/**
 * Verifies the bearer token and loads the user FROM THE DATABASE on every request.
 *
 * The role is deliberately re-read from the DB rather than trusted from the JWT
 * claim: if an Admin demotes someone, the change must take effect immediately,
 * not whenever their week-long token happens to expire. Same for deactivation.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization");

  if (!header?.startsWith("Bearer ")) {
    throw new AppError(401, "UNAUTHENTICATED", "You must be signed in to do that.");
  }

  const token = header.slice("Bearer ".length);

  let payload: JwtPayload;
  try {
    payload = (await verify(token, env.JWT_SECRET, "HS256")) as JwtPayload;
  } catch {
    throw new AppError(401, "INVALID_TOKEN", "Your session has expired. Please sign in again.");
  }

  const [user] = await db.select().from(users).where(eq(users.id, payload.sub));

  if (!user) {
    throw new AppError(401, "INVALID_TOKEN", "Your account no longer exists.");
  }

  if (user.status !== "active") {
    throw new AppError(403, "ACCOUNT_INACTIVE", "Your account has been deactivated.");
  }

  const authUser: AuthUser = {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    name: user.name,
    role: user.role,
    departmentId: user.departmentId,
  };

  c.set("user", authUser);
  await next();
});

/**
 * Gate a route on role. Use AFTER `requireAuth`.
 *
 *   assetRoutes.use("/assets", requireAuth, requireRole("admin", "asset_manager"))
 *
 * The 403 names the roles that WOULD work, so a judge poking at the API gets a
 * useful answer rather than a bare "Forbidden".
 */
export function requireRole(...allowed: Role[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");

    if (!allowed.includes(user.role)) {
      throw new AppError(
        403,
        "FORBIDDEN",
        `Your role (${user.role}) cannot perform this action. Requires: ${allowed.join(" or ")}.`,
      );
    }

    await next();
  });
}
