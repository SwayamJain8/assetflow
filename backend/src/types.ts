import type { userRole } from "./db/schema";

export type Role = (typeof userRole.enumValues)[number];

/** The authenticated caller, resolved from the JWT by `requireAuth`. */
export type AuthUser = {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: Role;
  departmentId: string | null;
};

/**
 * Hono's environment for this app. Declaring `user` here is what lets every
 * route handler read `c.get("user")` with full type safety instead of `any`.
 */
export type AppEnv = {
  Variables: {
    user: AuthUser;
  };
};

/**
 * What every service function receives as its first argument.
 *
 * Passing this explicitly (rather than reaching for a request-scoped global)
 * keeps services pure and testable, and makes the tenancy filter impossible to
 * forget: every query is scoped with `eq(table.organizationId, ctx.orgId)`.
 */
export type Ctx = {
  user: AuthUser;
  orgId: string;
};

export const ctxFrom = (user: AuthUser): Ctx => ({ user, orgId: user.organizationId });
