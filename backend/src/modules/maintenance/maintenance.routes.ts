import { createRoute, z } from "@hono/zod-openapi";

import { createRouter, json } from "../../lib/router";
import { requireAuth, requireRole } from "../../middleware/auth";
import { ctxFrom } from "../../types";
import {
  CreateMaintenanceSchema,
  IdParam,
  ListMaintenanceQuery,
  MaintenanceSchema,
  TransitionSchema,
} from "./maintenance.schema";
import { createRequest, listRequests, setPhoto, transition } from "./maintenance.service";

export const maintenanceRouter = createRouter();

maintenanceRouter.use("/maintenance", requireAuth);
maintenanceRouter.use("/maintenance/*", requireAuth);

// ANY employee may raise a request — the person holding the broken thing is
// usually the one who notices. Only a manager may move a card on the board.
maintenanceRouter.on(
  ["PATCH"],
  "/maintenance/*",
  requireRole("admin", "asset_manager", "department_head"),
);

maintenanceRouter.openapi(
  createRoute({
    method: "get",
    path: "/maintenance",
    tags: ["Maintenance"],
    summary: "Maintenance requests (the Kanban board's 5 columns)",
    security: [{ Bearer: [] }],
    request: { query: ListMaintenanceQuery },
    responses: { 200: { description: "Requests.", ...json(z.array(MaintenanceSchema)) } },
  }),
  async (c) => c.json(await listRequests(ctxFrom(c.get("user")), c.req.valid("query")), 200),
);

maintenanceRouter.openapi(
  createRoute({
    method: "post",
    path: "/maintenance",
    tags: ["Maintenance"],
    summary: "Raise a maintenance request (any employee)",
    description: "Always enters as `pending`. Work cannot begin until it is approved.",
    security: [{ Bearer: [] }],
    request: { body: json(CreateMaintenanceSchema) },
    responses: {
      201: { description: "Raised, pending approval." },
      409: { description: "The asset is retired, disposed, or lost." },
      422: { description: "Validation failed." },
    },
  }),
  async (c) => c.json(await createRequest(ctxFrom(c.get("user")), c.req.valid("json")), 201),
);

maintenanceRouter.openapi(
  createRoute({
    method: "patch",
    path: "/maintenance/{id}",
    tags: ["Maintenance"],
    summary: "Move a request through the workflow (the Kanban drag)",
    description:
      "Pending → Approved/Rejected → Technician Assigned → In Progress → Resolved.\n\n" +
      "There is NO edge from Pending to In Progress, so work cannot start before " +
      "approval — dragging a card two columns across is refused, and so is a " +
      "hand-crafted API call.\n\n" +
      "Two moves change the asset: **approving** flips it to Under Maintenance, and " +
      "**resolving** returns it to Available (or back to Allocated, if someone was " +
      "holding it all along).",
    security: [{ Bearer: [] }],
    request: { params: IdParam, body: json(TransitionSchema) },
    responses: {
      200: { description: "Moved." },
      403: { description: "Only a manager may move a request." },
      409: { description: "ILLEGAL_TRANSITION — `details.allowed` lists the legal moves." },
      422: { description: "A technician or a rejection reason is required." },
    },
  }),
  async (c) =>
    c.json(
      await transition(ctxFrom(c.get("user")), c.req.valid("param").id, c.req.valid("json")),
      200,
    ),
);

/** Multipart — see the note in assets.routes.ts. */
maintenanceRouter.post("/maintenance/:id/photo", async (c) => {
  const body = await c.req.parseBody();
  const result = await setPhoto(ctxFrom(c.get("user")), c.req.param("id"), body["file"] as File);
  return c.json(result, 200);
});
