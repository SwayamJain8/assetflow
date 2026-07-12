import { createRoute } from "@hono/zod-openapi";

import { createRouter, json as jsonBody } from "../../lib/router";
import { requireAuth } from "../../middleware/auth";
import { ctxFrom } from "../../types";
import { LoginSchema, OnboardSchema, SessionSchema, SignupSchema } from "./auth.schema";
import { currentSession, login, onboardOrganization, signup } from "./auth.service";

// createRouter(), not `new OpenAPIHono()` — see lib/router.ts. Building it by
// hand would skip the validation hook and leak raw ZodErrors to the client.
export const authRouter = createRouter();

authRouter.openapi(
  createRoute({
    method: "post",
    path: "/auth/onboard",
    tags: ["Auth"],
    summary: "Create a new organization and its first Admin",
    description:
      "Self-serve onboarding. This is the ONLY path that produces an Admin, and only " +
      "for an organization that did not previously exist.",
    request: { body: jsonBody(OnboardSchema) },
    responses: {
      201: { description: "Organization created; you are its Admin.", ...jsonBody(SessionSchema) },
      409: { description: "An organization with that name already exists." },
      422: { description: "Validation failed." },
    },
  }),
  async (c) => {
    const result = await onboardOrganization(c.req.valid("json"));
    return c.json(result, 201);
  },
);

authRouter.openapi(
  createRoute({
    method: "post",
    path: "/auth/signup",
    tags: ["Auth"],
    summary: "Join an existing organization (always as an Employee)",
    description:
      "The request body has no `role` field, and the handler never sets one — the " +
      "column's DEFAULT 'employee' is the only value that can land. Roles are granted " +
      "exclusively by an Admin from the Employee Directory.",
    request: { body: jsonBody(SignupSchema) },
    responses: {
      201: { description: "Account created as an Employee.", ...jsonBody(SessionSchema) },
      404: { description: "No such organization." },
      409: { description: "That email is already registered in this organization." },
      422: { description: "Validation failed (e.g. invalid email)." },
    },
  }),
  async (c) => {
    const result = await signup(c.req.valid("json"));
    return c.json(result, 201);
  },
);

authRouter.openapi(
  createRoute({
    method: "post",
    path: "/auth/login",
    tags: ["Auth"],
    summary: "Sign in with email and password",
    request: { body: jsonBody(LoginSchema) },
    responses: {
      200: { description: "Signed in.", ...jsonBody(SessionSchema) },
      401: { description: "Incorrect email or password." },
      403: { description: "Account deactivated." },
      422: { description: "Validation failed." },
    },
  }),
  async (c) => {
    const result = await login(c.req.valid("json"));
    return c.json(result, 200);
  },
);

authRouter.use("/auth/me", requireAuth);
authRouter.openapi(
  createRoute({
    method: "get",
    path: "/auth/me",
    tags: ["Auth"],
    summary: "The signed-in user, their role, and their organization's theme",
    security: [{ Bearer: [] }],
    responses: {
      200: { description: "The current session.", ...jsonBody(SessionSchema) },
      401: { description: "Not signed in." },
    },
  }),
  async (c) => {
    const result = await currentSession(ctxFrom(c.get("user")));
    return c.json(result, 200);
  },
);
