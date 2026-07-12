import { createRoute, z } from "@hono/zod-openapi";

import { createRouter, json } from "../../lib/router";
import { requireAuth, requireRole } from "../../middleware/auth";
import { ctxFrom } from "../../types";
import { IdParam, ListUsersQuery, UpdateUserSchema, UserSchema } from "./users.schema";
import { listUsers, updateUser } from "./users.service";



export const usersRouter = createRouter();

usersRouter.use("/users", requireAuth);
usersRouter.use("/users/*", requireAuth);

// THE role-assignment gate. Only an Admin may PATCH a user, and PATCH is the only
// way a role can change anywhere in this API.
usersRouter.on(["PATCH"], "/users/*", requireRole("admin"));

usersRouter.openapi(
  createRoute({
    method: "get",
    path: "/users",
    tags: ["Organization"],
    summary: "The Employee Directory",
    security: [{ Bearer: [] }],
    request: { query: ListUsersQuery },
    responses: { 200: { description: "Employees.", ...json(z.array(UserSchema)) } },
  }),
  async (c) => c.json(await listUsers(ctxFrom(c.get("user")), c.req.valid("query")), 200),
);

usersRouter.openapi(
  createRoute({
    method: "patch",
    path: "/users/{id}",
    tags: ["Organization"],
    summary: "Assign a role, department, or status (Admin only)",
    description:
      "The ONLY place a role is ever assigned. Signup cannot set one, and no other " +
      "endpoint accepts a `role` field — so an employee cannot elevate themselves. " +
      "Refuses to remove the last active Admin (that would lock everyone out), and " +
      "refuses to deactivate someone who still holds assets.",
    security: [{ Bearer: [] }],
    request: { params: IdParam, body: json(UpdateUserSchema) },
    responses: {
      200: { description: "Updated." },
      403: { description: "Only an Admin may assign roles." },
      404: { description: "No such employee." },
      409: { description: "Last active Admin, or the employee still holds assets." },
      422: { description: "Validation failed." },
    },
  }),
  async (c) =>
    c.json(
      await updateUser(ctxFrom(c.get("user")), c.req.valid("param").id, c.req.valid("json")),
      200,
    ),
);
