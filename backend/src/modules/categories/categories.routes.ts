import { createRoute, z } from "@hono/zod-openapi";

import { createRouter, json } from "../../lib/router";
import { requireAuth, requireRole } from "../../middleware/auth";
import { ctxFrom } from "../../types";
import {
  CategorySchema,
  CreateCategorySchema,
  IdParam,
  UpdateCategorySchema,
} from "./categories.schema";
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "./categories.service";



export const categoriesRouter = createRouter();

categoriesRouter.use("/categories", requireAuth);
categoriesRouter.use("/categories/*", requireAuth);
categoriesRouter.on(["POST", "PATCH", "DELETE"], "/categories", requireRole("admin"));
categoriesRouter.on(["POST", "PATCH", "DELETE"], "/categories/*", requireRole("admin"));

categoriesRouter.openapi(
  createRoute({
    method: "get",
    path: "/categories",
    tags: ["Organization"],
    summary: "List asset categories and their custom field definitions",
    security: [{ Bearer: [] }],
    responses: { 200: { description: "Categories.", ...json(z.array(CategorySchema)) } },
  }),
  async (c) => c.json(await listCategories(ctxFrom(c.get("user"))), 200),
);

categoriesRouter.openapi(
  createRoute({
    method: "post",
    path: "/categories",
    tags: ["Organization"],
    summary: "Create a category, optionally with custom fields (Admin only)",
    description:
      "e.g. Electronics with a `warrantyMonths` number field. Assets in the category " +
      "then fill those fields into their `customValues`.",
    security: [{ Bearer: [] }],
    request: { body: json(CreateCategorySchema) },
    responses: {
      201: { description: "Created." },
      403: { description: "Only an Admin may manage categories." },
      409: { description: "A category with that name already exists." },
      422: { description: "Validation failed." },
    },
  }),
  async (c) => c.json(await createCategory(ctxFrom(c.get("user")), c.req.valid("json")), 201),
);

categoriesRouter.openapi(
  createRoute({
    method: "patch",
    path: "/categories/{id}",
    tags: ["Organization"],
    summary: "Update a category (Admin only)",
    security: [{ Bearer: [] }],
    request: { params: IdParam, body: json(UpdateCategorySchema) },
    responses: {
      200: { description: "Updated." },
      404: { description: "No such category." },
    },
  }),
  async (c) =>
    c.json(
      await updateCategory(ctxFrom(c.get("user")), c.req.valid("param").id, c.req.valid("json")),
      200,
    ),
);

categoriesRouter.openapi(
  createRoute({
    method: "delete",
    path: "/categories/{id}",
    tags: ["Organization"],
    summary: "Delete an unused category (Admin only)",
    security: [{ Bearer: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: "Deleted." },
      409: { description: "Assets still use this category." },
    },
  }),
  async (c) => c.json(await deleteCategory(ctxFrom(c.get("user")), c.req.valid("param").id), 200),
);
