import { createRoute, z } from "@hono/zod-openapi";

import { createRouter, json } from "../../lib/router";
import { requireAuth, requireRole } from "../../middleware/auth";
import { ctxFrom } from "../../types";
import {
  CreateDepartmentSchema,
  DepartmentSchema,
  IdParam,
  UpdateDepartmentSchema,
} from "./departments.schema";
import {
  createDepartment,
  deleteDepartment,
  listDepartments,
  updateDepartment,
} from "./departments.service";



export const departmentsRouter = createRouter();

// Everyone signed in may READ the org chart (the department picker needs it).
// Only an Admin may change it.
departmentsRouter.use("/departments", requireAuth);
departmentsRouter.use("/departments/*", requireAuth);
departmentsRouter.on(["POST", "PATCH", "DELETE"], "/departments", requireRole("admin"));
departmentsRouter.on(["POST", "PATCH", "DELETE"], "/departments/*", requireRole("admin"));

departmentsRouter.openapi(
  createRoute({
    method: "get",
    path: "/departments",
    tags: ["Organization"],
    summary: "List departments with their head, parent, and live member/asset counts",
    security: [{ Bearer: [] }],
    responses: {
      200: { description: "The department directory.", ...json(z.array(DepartmentSchema)) },
    },
  }),
  async (c) => c.json(await listDepartments(ctxFrom(c.get("user"))), 200),
);

departmentsRouter.openapi(
  createRoute({
    method: "post",
    path: "/departments",
    tags: ["Organization"],
    summary: "Create a department (Admin only)",
    security: [{ Bearer: [] }],
    request: { body: json(CreateDepartmentSchema) },
    responses: {
      201: { description: "Created." },
      403: { description: "Only an Admin may manage departments." },
      409: { description: "A department with that name already exists." },
      422: { description: "Validation failed." },
    },
  }),
  async (c) => c.json(await createDepartment(ctxFrom(c.get("user")), c.req.valid("json")), 201),
);

departmentsRouter.openapi(
  createRoute({
    method: "patch",
    path: "/departments/{id}",
    tags: ["Organization"],
    summary: "Update a department, including re-parenting it (Admin only)",
    security: [{ Bearer: [] }],
    request: { params: IdParam, body: json(UpdateDepartmentSchema) },
    responses: {
      200: { description: "Updated." },
      403: { description: "Only an Admin may manage departments." },
      404: { description: "No such department." },
      422: { description: "Validation failed, or the change would create a cycle." },
    },
  }),
  async (c) =>
    c.json(
      await updateDepartment(ctxFrom(c.get("user")), c.req.valid("param").id, c.req.valid("json")),
      200,
    ),
);

departmentsRouter.openapi(
  createRoute({
    method: "delete",
    path: "/departments/{id}",
    tags: ["Organization"],
    summary: "Delete an empty department (Admin only)",
    security: [{ Bearer: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: "Deleted." },
      409: { description: "The department still has employees, assets, or children." },
    },
  }),
  async (c) => c.json(await deleteDepartment(ctxFrom(c.get("user")), c.req.valid("param").id), 200),
);
