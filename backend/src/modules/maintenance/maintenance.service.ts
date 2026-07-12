import { aliasedTable, and, desc, eq, isNull } from "drizzle-orm";

import { db } from "../../config/db";
import { allocations, assets, maintenanceRequests, users } from "../../db/schema";
import { AppError } from "../../middleware/error-handler";
import { record } from "../../services/activity";
import { saveUpload } from "../../services/storage";
import type { Ctx } from "../../types";
import type {
  CreateMaintenanceInput,
  ListMaintenanceInput,
  TransitionInput,
} from "./maintenance.schema";

type Status = TransitionInput["status"];

const reporter = aliasedTable(users, "reporter");
const technician = aliasedTable(users, "technician");
const approver = aliasedTable(users, "approver");

/**
 * THE STATE MACHINE.
 *
 * The spec's central maintenance rule is "route repairs through approval BEFORE
 * work starts". That rule lives here, as data: `pending` can only go to `approved`
 * or `rejected`. There is no edge from `pending` to `in_progress`, so a request
 * physically cannot skip approval — not by dragging a Kanban card two columns
 * across, not by a hand-crafted API call.
 *
 * Expressing the workflow as a table rather than a pile of if-statements means the
 * illegal moves are the ones that simply aren't listed.
 */
const TRANSITIONS: Record<Status, Status[]> = {
  // THE GATE. No edge to in_progress or resolved — work cannot begin unapproved.
  pending: ["approved", "rejected"],

  // Once approved, a card may be dragged forward freely. Assigning a technician is
  // optional: a manager who fixes the thing themselves must still be able to close
  // the ticket, so approved → resolved is legal.
  approved: ["technician_assigned", "in_progress", "resolved", "rejected"],
  technician_assigned: ["in_progress", "resolved", "approved"],
  in_progress: ["resolved", "technician_assigned"],

  // Terminal. A resolved or rejected request is history; raise a new one instead.
  resolved: [],
  rejected: [],
};

const LABEL: Record<Status, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  technician_assigned: "Technician Assigned",
  in_progress: "In Progress",
  resolved: "Resolved",
};

async function mustFind(ctx: Ctx, id: string) {
  const [row] = await db
    .select()
    .from(maintenanceRequests)
    .where(
      and(
        eq(maintenanceRequests.id, id),
        eq(maintenanceRequests.organizationId, ctx.orgId),
      ),
    );

  if (!row) throw new AppError(404, "MAINTENANCE_NOT_FOUND", "That request does not exist.");
  return row;
}

async function mustFindAsset(ctx: Ctx, assetId: string) {
  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.organizationId, ctx.orgId)));

  if (!asset) throw new AppError(404, "ASSET_NOT_FOUND", "That asset does not exist.");
  return asset;
}

/**
 * When maintenance finishes, what should the asset go back to?
 *
 * The spec says "back to Available on resolution" — but that is only right if
 * nobody was holding it. If the laptop's holder raised the ticket and still has
 * the laptop, flipping it to `available` would contradict the open allocation row:
 * the ledger would say free while a person is demonstrably holding it.
 *
 * So: restore to `allocated` when an open allocation exists, `available` otherwise.
 */
async function statusAfterMaintenance(assetId: string): Promise<"available" | "allocated"> {
  const [open] = await db
    .select({ id: allocations.id })
    .from(allocations)
    .where(and(eq(allocations.assetId, assetId), isNull(allocations.returnedAt)));

  return open ? "allocated" : "available";
}

export async function createRequest(ctx: Ctx, input: CreateMaintenanceInput) {
  const asset = await mustFindAsset(ctx, input.assetId);

  if (["retired", "disposed", "lost"].includes(asset.status)) {
    throw new AppError(
      409,
      "ASSET_NOT_SERVICEABLE",
      `${asset.assetTag} is ${asset.status} and cannot be sent for maintenance.`,
    );
  }

  const [created] = await db
    .insert(maintenanceRequests)
    .values({
      organizationId: ctx.orgId,
      assetId: input.assetId,
      reportedBy: ctx.user.id,
      issueDescription: input.issueDescription,
      priority: input.priority,
      // status omitted — the DB default is 'pending'. Work cannot begin here.
    })
    .returning();

  await record(ctx, {
    entity: "maintenance",
    entityId: created!.id,
    action: "maintenance_requested",
    summary: `Maintenance requested for ${asset.name} (${asset.assetTag}) — ${input.issueDescription}`,
    metadata: { assetTag: asset.assetTag, priority: input.priority },
  });

  return created!;
}

/**
 * The one endpoint the Kanban board drives. Every column change — including the
 * two that mutate the asset — comes through here.
 *
 *   approved  → asset becomes `under_maintenance`   (work may now begin)
 *   resolved  → asset returns to available/allocated
 */
export async function transition(ctx: Ctx, id: string, input: TransitionInput) {
  const request = await mustFind(ctx, id);
  const asset = await mustFindAsset(ctx, request.assetId);

  const from = request.status;
  const to = input.status;

  if (from === to) {
    throw new AppError(409, "NO_CHANGE", `This request is already ${LABEL[to]}.`);
  }

  const allowed = TRANSITIONS[from];

  if (!allowed.includes(to)) {
    // The message names the legal moves, so a dragged card that lands in the
    // wrong column explains itself instead of just refusing.
    throw new AppError(
      409,
      "ILLEGAL_TRANSITION",
      allowed.length
        ? `A ${LABEL[from]} request cannot move to ${LABEL[to]}. It can only go to: ${allowed
            .map((s) => LABEL[s])
            .join(", ")}.`
        : `This request is ${LABEL[from]} and is closed. Raise a new request instead.`,
      { from, to, allowed },
    );
  }

  if (to === "technician_assigned" && !input.technicianId) {
    throw new AppError(422, "TECHNICIAN_REQUIRED", "Choose a technician to assign.");
  }

  if (to === "rejected" && !input.rejectionReason) {
    throw new AppError(422, "REASON_REQUIRED", "Give a reason for rejecting this request.");
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(maintenanceRequests)
      .set({
        status: to,
        ...(input.technicianId !== undefined && { technicianId: input.technicianId }),
        ...(to === "approved" && { approvedBy: ctx.user.id, approvedAt: now }),
        ...(to === "rejected" && {
          approvedBy: ctx.user.id,
          rejectionReason: input.rejectionReason ?? null,
        }),
        ...(to === "resolved" && {
          resolvedAt: now,
          resolutionNotes: input.resolutionNotes ?? null,
        }),
      })
      .where(eq(maintenanceRequests.id, id));

    // ── The two side effects the spec demands ──────────────────────────────
    if (to === "approved") {
      await tx
        .update(assets)
        .set({ status: "under_maintenance" })
        .where(eq(assets.id, request.assetId));
    }

    if (to === "resolved") {
      await tx
        .update(assets)
        .set({
          status: await statusAfterMaintenance(request.assetId),
          ...(input.condition && { condition: input.condition }),
        })
        .where(eq(assets.id, request.assetId));
    }
  });

  const summaries: Partial<Record<Status, string>> = {
    approved: `${asset.assetTag} approved for maintenance — moved to Under Maintenance`,
    rejected: `Maintenance request for ${asset.assetTag} rejected — ${input.rejectionReason}`,
    technician_assigned: `Technician assigned to ${asset.assetTag}`,
    in_progress: `Maintenance work started on ${asset.assetTag}`,
    resolved: `${asset.assetTag} — maintenance resolved${
      input.resolutionNotes ? `: ${input.resolutionNotes}` : ""
    }`,
  };

  // The person who raised the ticket is told when it is approved or rejected —
  // the two events the spec names.
  const notifyType =
    to === "approved" ? "maintenance_approved" : to === "rejected" ? "maintenance_rejected" : null;

  await record(ctx, {
    entity: "asset",
    entityId: request.assetId,
    action: `maintenance_${to}`,
    summary: summaries[to] ?? `${asset.assetTag} maintenance moved to ${LABEL[to]}`,
    metadata: { from, to, requestId: id },
    ...(notifyType &&
      request.reportedBy && {
        notify: {
          userId: request.reportedBy,
          type: notifyType as "maintenance_approved" | "maintenance_rejected",
          title: `Maintenance request ${asset.assetTag} ${to}`,
          body:
            to === "approved"
              ? `${asset.name} is now under maintenance.`
              : `Reason: ${input.rejectionReason}`,
          link: "/maintenance",
        },
      }),
  });

  return { id, status: to, assetStatus: to === "approved" ? "under_maintenance" : undefined };
}

export async function setPhoto(ctx: Ctx, id: string, file: File) {
  const request = await mustFind(ctx, id);
  const photoPath = await saveUpload(file);

  await db
    .update(maintenanceRequests)
    .set({ photoPath })
    .where(eq(maintenanceRequests.id, request.id));

  return { photoPath };
}

/** Feeds the Kanban board — the frontend groups these into the 5 columns. */
export async function listRequests(ctx: Ctx, query: ListMaintenanceInput) {
  const filters = [eq(maintenanceRequests.organizationId, ctx.orgId)];

  if (query.status) filters.push(eq(maintenanceRequests.status, query.status));
  if (query.assetId) filters.push(eq(maintenanceRequests.assetId, query.assetId));
  if (query.priority) filters.push(eq(maintenanceRequests.priority, query.priority));
  if (query.mine === "true") filters.push(eq(maintenanceRequests.reportedBy, ctx.user.id));

  const rows = await db
    .select({
      id: maintenanceRequests.id,
      assetId: maintenanceRequests.assetId,
      assetTag: assets.assetTag,
      assetName: assets.name,
      issueDescription: maintenanceRequests.issueDescription,
      priority: maintenanceRequests.priority,
      status: maintenanceRequests.status,
      photoPath: maintenanceRequests.photoPath,
      reportedByName: reporter.name,
      technicianId: maintenanceRequests.technicianId,
      technicianName: technician.name,
      approvedByName: approver.name,
      rejectionReason: maintenanceRequests.rejectionReason,
      resolutionNotes: maintenanceRequests.resolutionNotes,
      createdAt: maintenanceRequests.createdAt,
      approvedAt: maintenanceRequests.approvedAt,
      resolvedAt: maintenanceRequests.resolvedAt,
    })
    .from(maintenanceRequests)
    .innerJoin(assets, eq(maintenanceRequests.assetId, assets.id))
    .leftJoin(reporter, eq(maintenanceRequests.reportedBy, reporter.id))
    .leftJoin(technician, eq(maintenanceRequests.technicianId, technician.id))
    .leftJoin(approver, eq(maintenanceRequests.approvedBy, approver.id))
    .where(and(...filters))
    .orderBy(desc(maintenanceRequests.createdAt));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  }));
}
