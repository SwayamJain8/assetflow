import { createRoute, z } from "@hono/zod-openapi";

import { createRouter, json } from "../../lib/router";
import { requireAuth, requireRole } from "../../middleware/auth";
import { ctxFrom } from "../../types";
import {
  AllocationSchema,
  CreateAllocationSchema,
  CreateTransferSchema,
  IdParam,
  ListAllocationsQuery,
  ListTransfersQuery,
  ReturnAllocationSchema,
  TransferSchema,
} from "./allocations.schema";
import {
  allocateAndNotify,
  approveTransfer,
  listAllocations,
  listTransfers,
  rejectTransfer,
  requestTransfer,
  returnAsset,
} from "./allocations.service";

export const allocationsRouter = createRouter();

allocationsRouter.use("/allocations", requireAuth);
allocationsRouter.use("/allocations/*", requireAuth);
allocationsRouter.use("/transfers", requireAuth);
allocationsRouter.use("/transfers/*", requireAuth);

// Handing out and taking back an asset is an Asset Manager's job.
allocationsRouter.on(["POST"], "/allocations", requireRole("admin", "asset_manager"));
allocationsRouter.on(["POST"], "/allocations/*", requireRole("admin", "asset_manager"));

// ANY employee may REQUEST a transfer (that is the whole point of the block) —
// but only a manager or department head may APPROVE one.
allocationsRouter.on(
  ["POST"],
  "/transfers/:id/approve",
  requireRole("admin", "asset_manager", "department_head"),
);
allocationsRouter.on(
  ["POST"],
  "/transfers/:id/reject",
  requireRole("admin", "asset_manager", "department_head"),
);

allocationsRouter.openapi(
  createRoute({
    method: "get",
    path: "/allocations",
    tags: ["Allocation"],
    summary: "Allocation history, filterable to active or overdue",
    security: [{ Bearer: [] }],
    request: { query: ListAllocationsQuery },
    responses: { 200: { description: "Allocations.", ...json(z.array(AllocationSchema)) } },
  }),
  async (c) => c.json(await listAllocations(ctxFrom(c.get("user")), c.req.valid("query")), 200),
);

allocationsRouter.openapi(
  createRoute({
    method: "post",
    path: "/allocations",
    tags: ["Allocation"],
    summary: "Allocate an asset — blocked if someone already holds it",
    description:
      "★ The double-allocation block. There is no SELECT-before-INSERT here: the " +
      "insert is simply attempted, and PostgreSQL's partial unique index " +
      "(one_active_allocation) refuses it if the asset is already held. On refusal " +
      "the 409 carries the holder in `details.holder`, so the UI can say " +
      "'currently held by Priya Sharma' and offer a Transfer Request without a " +
      "second round-trip.",
    security: [{ Bearer: [] }],
    request: { body: json(CreateAllocationSchema) },
    responses: {
      201: { description: "Allocated." },
      403: { description: "Only an Asset Manager or Admin may allocate." },
      409: {
        description:
          "ASSET_ALREADY_ALLOCATED — someone holds it. `details.holder` names them.",
      },
      422: { description: "Validation failed." },
    },
  }),
  async (c) => c.json(await allocateAndNotify(ctxFrom(c.get("user")), c.req.valid("json")), 201),
);

allocationsRouter.openapi(
  createRoute({
    method: "post",
    path: "/allocations/{id}/return",
    tags: ["Allocation"],
    summary: "Return an asset, with condition check-in notes",
    description:
      "`id` is the ASSET id. Setting returned_at releases the partial unique index, " +
      "so the asset becomes allocatable again while the row survives as history.",
    security: [{ Bearer: [] }],
    request: { params: IdParam, body: json(ReturnAllocationSchema) },
    responses: {
      200: { description: "Returned; the asset is Available again." },
      409: { description: "The asset is not currently allocated." },
    },
  }),
  async (c) =>
    c.json(
      await returnAsset(ctxFrom(c.get("user")), c.req.valid("param").id, c.req.valid("json")),
      200,
    ),
);

allocationsRouter.openapi(
  createRoute({
    method: "get",
    path: "/transfers",
    tags: ["Allocation"],
    summary: "Transfer requests",
    security: [{ Bearer: [] }],
    request: { query: ListTransfersQuery },
    responses: { 200: { description: "Transfers.", ...json(z.array(TransferSchema)) } },
  }),
  async (c) => c.json(await listTransfers(ctxFrom(c.get("user")), c.req.valid("query")), 200),
);

allocationsRouter.openapi(
  createRoute({
    method: "post",
    path: "/transfers",
    tags: ["Allocation"],
    summary: "Request a transfer of a held asset (any employee)",
    description:
      "The sanctioned route around the double-allocation block. Anyone may ask; only " +
      "a manager or department head may approve.",
    security: [{ Bearer: [] }],
    request: { body: json(CreateTransferSchema) },
    responses: {
      201: { description: "Requested." },
      409: { description: "Not allocated, or a request is already pending." },
    },
  }),
  async (c) => c.json(await requestTransfer(ctxFrom(c.get("user")), c.req.valid("json")), 201),
);

allocationsRouter.openapi(
  createRoute({
    method: "post",
    path: "/transfers/{id}/approve",
    tags: ["Allocation"],
    summary: "Approve a transfer → re-allocates the asset atomically",
    description:
      "Closes the old allocation and opens the new one inside ONE transaction. Were " +
      "these separate, a failure between them would leave the asset held by nobody.",
    security: [{ Bearer: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: "Re-allocated." },
      403: { description: "Only a manager or department head may approve." },
      409: { description: "Already resolved." },
    },
  }),
  async (c) => c.json(await approveTransfer(ctxFrom(c.get("user")), c.req.valid("param").id), 200),
);

allocationsRouter.openapi(
  createRoute({
    method: "post",
    path: "/transfers/{id}/reject",
    tags: ["Allocation"],
    summary: "Reject a transfer request",
    security: [{ Bearer: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: "Rejected." },
      409: { description: "Already resolved." },
    },
  }),
  async (c) => c.json(await rejectTransfer(ctxFrom(c.get("user")), c.req.valid("param").id), 200),
);
