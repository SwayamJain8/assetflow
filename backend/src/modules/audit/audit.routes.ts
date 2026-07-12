import { createRoute, z } from "@hono/zod-openapi";

import { createRouter, json } from "../../lib/router";
import { requireAuth, requireRole } from "../../middleware/auth";
import { ctxFrom } from "../../types";
import {
  AuditCycleSchema,
  AuditItemSchema,
  CreateAuditCycleSchema,
  IdParam,
  ItemParams,
  MarkAuditItemSchema,
} from "./audit.schema";
import {
  closeCycle,
  createCycle,
  getDiscrepancyReport,
  listCycles,
  listItems,
  markItem,
} from "./audit.service";

export const auditRouter = createRouter();

auditRouter.use("/audit", requireAuth);
auditRouter.use("/audit/*", requireAuth);

// Admins run audit cycles (spec: "Admin — manages ... audit cycles").
auditRouter.on(["POST"], "/audit", requireRole("admin"));
auditRouter.on(["POST"], "/audit/:id/close", requireRole("admin", "asset_manager"));
// Marking an item is gated on being an ASSIGNED AUDITOR, which is a row-level fact
// — so it is checked in the service, not by a role middleware.

auditRouter.openapi(
  createRoute({
    method: "get",
    path: "/audit",
    tags: ["Audit"],
    summary: "Audit cycles with progress and discrepancy counts",
    security: [{ Bearer: [] }],
    responses: { 200: { description: "Cycles.", ...json(z.array(AuditCycleSchema)) } },
  }),
  async (c) => c.json(await listCycles(ctxFrom(c.get("user"))), 200),
);

auditRouter.openapi(
  createRoute({
    method: "post",
    path: "/audit",
    tags: ["Audit"],
    summary: "Open an audit cycle (Admin only)",
    description:
      "Snapshots every asset in scope into the checklist, with the location the " +
      "system BELIEVES it is at. Snapshotting matters: resolved live, an asset moved " +
      "out of the department mid-audit would quietly disappear from the checklist — " +
      "and a vanishing asset is exactly what an audit exists to catch.",
    security: [{ Bearer: [] }],
    request: { body: json(CreateAuditCycleSchema) },
    responses: {
      201: { description: "Opened, with the checklist populated." },
      403: { description: "Only an Admin may open an audit cycle." },
      422: { description: "No assets in scope, or an invalid auditor." },
    },
  }),
  async (c) => c.json(await createCycle(ctxFrom(c.get("user")), c.req.valid("json")), 201),
);

auditRouter.openapi(
  createRoute({
    method: "get",
    path: "/audit/{id}/items",
    tags: ["Audit"],
    summary: "The auditor's checklist for one cycle",
    security: [{ Bearer: [] }],
    request: { params: IdParam },
    responses: { 200: { description: "Checklist.", ...json(z.array(AuditItemSchema)) } },
  }),
  async (c) => c.json(await listItems(ctxFrom(c.get("user")), c.req.valid("param").id), 200),
);

auditRouter.openapi(
  createRoute({
    method: "get",
    path: "/audit/{id}/report",
    tags: ["Audit"],
    summary: "The auto-generated discrepancy report",
    description:
      "Derived from the checklist on every read, never stored. A stored report could " +
      "disagree with the items it summarises the moment anything changed.",
    security: [{ Bearer: [] }],
    request: { params: IdParam },
    responses: { 200: { description: "Summary plus every missing/damaged asset." } },
  }),
  async (c) =>
    c.json(await getDiscrepancyReport(ctxFrom(c.get("user")), c.req.valid("param").id), 200),
);

auditRouter.openapi(
  createRoute({
    method: "patch",
    path: "/audit/{id}/items/{itemId}",
    tags: ["Audit"],
    summary: "Mark an asset Verified, Missing, or Damaged",
    description: "Only an auditor assigned to this cycle (or an Admin) may mark items.",
    security: [{ Bearer: [] }],
    request: { params: ItemParams, body: json(MarkAuditItemSchema) },
    responses: {
      200: { description: "Marked." },
      403: { description: "You are not an auditor on this cycle." },
      409: { description: "The cycle is closed and locked." },
    },
  }),
  async (c) => {
    const { id, itemId } = c.req.valid("param");
    return c.json(await markItem(ctxFrom(c.get("user")), id, itemId, c.req.valid("json")), 200);
  },
);

auditRouter.openapi(
  createRoute({
    method: "post",
    path: "/audit/{id}/close",
    tags: ["Audit"],
    summary: "Close the cycle — locks it and applies the findings",
    description:
      "Confirmed-missing assets become **Lost**; damaged assets have their condition " +
      "set. The cycle is then locked, because a closed audit is evidence and must not " +
      "be editable afterwards. All of it lands in one transaction — a half-applied " +
      "close would leave the audit saying a laptop is missing while the register " +
      "still shows it available.\n\nRefuses to close while any asset is unchecked.",
    security: [{ Bearer: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: "Closed; assets updated." },
      403: { description: "Only an Admin or Asset Manager may close a cycle." },
      409: { description: "Already closed, or assets remain unchecked." },
    },
  }),
  async (c) => c.json(await closeCycle(ctxFrom(c.get("user")), c.req.valid("param").id), 200),
);
