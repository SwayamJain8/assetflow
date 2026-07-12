import { and, count, desc, eq, ilike, inArray, sql } from "drizzle-orm";

import { db } from "../../config/db";
import {
  auditCycleAuditors,
  auditCycles,
  auditItems,
  assets,
  departments,
  users,
} from "../../db/schema";
import { AppError } from "../../middleware/error-handler";
import { record } from "../../services/activity";
import type { Ctx } from "../../types";
import type { CreateAuditCycleInput, MarkAuditItemInput } from "./audit.schema";

async function mustFindCycle(ctx: Ctx, id: string) {
  const [cycle] = await db
    .select()
    .from(auditCycles)
    .where(and(eq(auditCycles.id, id), eq(auditCycles.organizationId, ctx.orgId)));

  if (!cycle) throw new AppError(404, "CYCLE_NOT_FOUND", "That audit cycle does not exist.");
  return cycle;
}

/**
 * A closed cycle is a historical record — an immutable statement of what was found
 * and when. If it could still be edited after closing, the discrepancy report it
 * produced (and the asset statuses it drove) would no longer be evidence of
 * anything. So every mutation checks this first.
 */
function assertOpen(cycle: { status: string; name: string }) {
  if (cycle.status === "closed") {
    throw new AppError(
      409,
      "CYCLE_CLOSED",
      `"${cycle.name}" is closed and locked. Open a new cycle to re-audit these assets.`,
    );
  }
}

/** Only an assigned auditor (or an Admin) may mark items in a cycle. */
async function assertAuditor(ctx: Ctx, cycleId: string) {
  if (ctx.user.role === "admin") return;

  const [assigned] = await db
    .select()
    .from(auditCycleAuditors)
    .where(
      and(eq(auditCycleAuditors.cycleId, cycleId), eq(auditCycleAuditors.userId, ctx.user.id)),
    );

  if (!assigned) {
    throw new AppError(
      403,
      "NOT_AN_AUDITOR",
      "You are not assigned to this audit cycle.",
    );
  }
}

/**
 * Creating a cycle SNAPSHOTS the assets in scope into audit_items.
 *
 * Snapshotting matters: the checklist must be the estate as it stood when the
 * audit opened. If items were resolved live against the assets table, an asset
 * moved out of the department mid-audit would quietly vanish from the checklist —
 * and an asset that vanished is precisely what an audit exists to catch.
 *
 * `expected_location` is likewise frozen: it is where the system BELIEVED the
 * asset was, which is the thing being tested against reality.
 */
export async function createCycle(ctx: Ctx, input: CreateAuditCycleInput) {
  // Scope: department and/or location. Neither = the whole organization.
  const scope = [eq(assets.organizationId, ctx.orgId)];

  if (input.scopeDepartmentId) scope.push(eq(assets.departmentId, input.scopeDepartmentId));
  if (input.scopeLocation) scope.push(ilike(assets.location, `%${input.scopeLocation}%`));

  // Assets already written off are not worth auditing.
  scope.push(sql`${assets.status} not in ('disposed', 'retired')`);

  const inScope = await db
    .select({ id: assets.id, location: assets.location })
    .from(assets)
    .where(and(...scope));

  if (!inScope.length) {
    throw new AppError(
      422,
      "EMPTY_SCOPE",
      "No assets match that scope. Widen the department or location.",
    );
  }

  // Guard against assigning someone from another organization as an auditor.
  const auditors = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.organizationId, ctx.orgId), inArray(users.id, input.auditorIds)));

  if (auditors.length !== input.auditorIds.length) {
    throw new AppError(422, "INVALID_AUDITOR", "One of those auditors does not exist.");
  }

  const cycle = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(auditCycles)
      .values({
        organizationId: ctx.orgId,
        name: input.name,
        scopeDepartmentId: input.scopeDepartmentId ?? null,
        scopeLocation: input.scopeLocation ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        createdBy: ctx.user.id,
      })
      .returning();

    await tx
      .insert(auditCycleAuditors)
      .values(input.auditorIds.map((userId) => ({ cycleId: created!.id, userId })));

    await tx.insert(auditItems).values(
      inScope.map((asset) => ({
        cycleId: created!.id,
        assetId: asset.id,
        expectedLocation: asset.location,
        // status omitted — the DB default is 'pending' (not yet checked)
      })),
    );

    return created!;
  });

  await record(ctx, {
    entity: "audit",
    entityId: cycle.id,
    action: "audit_opened",
    summary: `Audit cycle "${cycle.name}" opened with ${inScope.length} assets and ${input.auditorIds.length} auditor(s)`,
    metadata: { assetCount: inScope.length },
  });

  return cycle;
}

/** The auditor's checklist action: Verified / Missing / Damaged. */
export async function markItem(
  ctx: Ctx,
  cycleId: string,
  itemId: string,
  input: MarkAuditItemInput,
) {
  const cycle = await mustFindCycle(ctx, cycleId);
  assertOpen(cycle);
  await assertAuditor(ctx, cycleId);

  const [item] = await db
    .select({
      id: auditItems.id,
      assetId: auditItems.assetId,
      assetTag: assets.assetTag,
      assetName: assets.name,
    })
    .from(auditItems)
    .innerJoin(assets, eq(auditItems.assetId, assets.id))
    .where(and(eq(auditItems.id, itemId), eq(auditItems.cycleId, cycleId)));

  if (!item) throw new AppError(404, "ITEM_NOT_FOUND", "That asset is not in this audit cycle.");

  await db
    .update(auditItems)
    .set({
      status: input.status,
      notes: input.notes ?? null,
      checkedBy: ctx.user.id,
      checkedAt: new Date(),
    })
    .where(eq(auditItems.id, itemId));

  // A discrepancy is worth telling someone about the moment it is found — not only
  // when the cycle closes.
  if (input.status !== "verified") {
    await record(ctx, {
      entity: "audit",
      entityId: cycleId,
      action: "audit_discrepancy",
      summary: `Audit discrepancy: ${item.assetTag} marked ${input.status}${
        input.notes ? ` — ${input.notes}` : ""
      }`,
      metadata: { assetTag: item.assetTag, status: input.status },
      ...(cycle.createdBy && {
        notify: {
          userId: cycle.createdBy,
          type: "audit_discrepancy" as const,
          title: `Audit discrepancy flagged: ${item.assetTag} ${input.status}`,
          body: `${item.assetName} — ${cycle.name}`,
          link: "/audit",
        },
      }),
    });
  }

  return { id: itemId, status: input.status };
}

/**
 * THE DISCREPANCY REPORT — a query, not a document.
 *
 * The spec says the system "auto-generates a discrepancy report". Storing one as
 * a row would mean it could disagree with the items it summarises the moment
 * anything changed. Deriving it means it is, by construction, always exactly what
 * the checklist says.
 */
export async function getDiscrepancyReport(ctx: Ctx, cycleId: string) {
  const cycle = await mustFindCycle(ctx, cycleId);

  const rows = await db
    .select({
      id: auditItems.id,
      assetId: auditItems.assetId,
      assetTag: assets.assetTag,
      assetName: assets.name,
      expectedLocation: auditItems.expectedLocation,
      status: auditItems.status,
      notes: auditItems.notes,
      checkedByName: users.name,
      checkedAt: auditItems.checkedAt,
    })
    .from(auditItems)
    .innerJoin(assets, eq(auditItems.assetId, assets.id))
    .leftJoin(users, eq(auditItems.checkedBy, users.id))
    .where(eq(auditItems.cycleId, cycleId))
    .orderBy(assets.assetTag);

  const missing = rows.filter((row) => row.status === "missing");
  const damaged = rows.filter((row) => row.status === "damaged");
  const verified = rows.filter((row) => row.status === "verified");
  const unchecked = rows.filter((row) => row.status === "pending");

  return {
    cycle: {
      id: cycle.id,
      name: cycle.name,
      status: cycle.status,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
    },
    summary: {
      total: rows.length,
      verified: verified.length,
      missing: missing.length,
      damaged: damaged.length,
      unchecked: unchecked.length,
      discrepancies: missing.length + damaged.length,
    },
    discrepancies: [...missing, ...damaged].map((row) => ({
      ...row,
      checkedAt: row.checkedAt?.toISOString() ?? null,
    })),
  };
}

export async function listItems(ctx: Ctx, cycleId: string) {
  await mustFindCycle(ctx, cycleId);

  const rows = await db
    .select({
      id: auditItems.id,
      assetId: auditItems.assetId,
      assetTag: assets.assetTag,
      assetName: assets.name,
      expectedLocation: auditItems.expectedLocation,
      status: auditItems.status,
      notes: auditItems.notes,
      checkedByName: users.name,
      checkedAt: auditItems.checkedAt,
    })
    .from(auditItems)
    .innerJoin(assets, eq(auditItems.assetId, assets.id))
    .leftJoin(users, eq(auditItems.checkedBy, users.id))
    .where(eq(auditItems.cycleId, cycleId))
    .orderBy(assets.assetTag);

  return rows.map((row) => ({ ...row, checkedAt: row.checkedAt?.toISOString() ?? null }));
}

/**
 * Closing the cycle LOCKS it and applies the consequences.
 *
 * The spec: "Close Audit Cycle — locks the cycle and updates affected asset
 * statuses (e.g. Lost for confirmed-missing items)."
 *
 * All of it happens in one transaction. A partial close — the cycle marked closed
 * but the assets not updated — would leave the audit claiming a laptop is missing
 * while the asset register still shows it as available.
 */
export async function closeCycle(ctx: Ctx, cycleId: string) {
  const cycle = await mustFindCycle(ctx, cycleId);
  assertOpen(cycle);

  const items = await db
    .select({ assetId: auditItems.assetId, status: auditItems.status })
    .from(auditItems)
    .where(eq(auditItems.cycleId, cycleId));

  const unchecked = items.filter((item) => item.status === "pending");

  if (unchecked.length) {
    throw new AppError(
      409,
      "AUDIT_INCOMPLETE",
      `${unchecked.length} asset${unchecked.length === 1 ? " has" : "s have"} not been checked yet. Every asset must be marked Verified, Missing, or Damaged before the cycle can close.`,
      { unchecked: unchecked.length },
    );
  }

  const missing = items.filter((item) => item.status === "missing");
  const damaged = items.filter((item) => item.status === "damaged");

  await db.transaction(async (tx) => {
    // Confirmed missing → the asset is Lost.
    if (missing.length) {
      await tx
        .update(assets)
        .set({ status: "lost" })
        .where(
          inArray(
            assets.id,
            missing.map((item) => item.assetId),
          ),
        );
    }

    // Confirmed damaged → the asset's condition reflects it. The status is left
    // alone: a damaged chair is still where it is, and someone still holds it.
    if (damaged.length) {
      await tx
        .update(assets)
        .set({ condition: "damaged" })
        .where(
          inArray(
            assets.id,
            damaged.map((item) => item.assetId),
          ),
        );
    }

    await tx
      .update(auditCycles)
      .set({ status: "closed", closedAt: new Date() })
      .where(eq(auditCycles.id, cycleId));
  });

  await record(ctx, {
    entity: "audit",
    entityId: cycleId,
    action: "audit_closed",
    summary: `Audit cycle "${cycle.name}" closed — ${missing.length} lost, ${damaged.length} damaged, ${
      items.length - missing.length - damaged.length
    } verified`,
    metadata: { missing: missing.length, damaged: damaged.length },
  });

  return {
    id: cycleId,
    status: "closed" as const,
    assetsMarkedLost: missing.length,
    assetsMarkedDamaged: damaged.length,
  };
}

export async function listCycles(ctx: Ctx) {
  const cycles = await db
    .select({
      id: auditCycles.id,
      name: auditCycles.name,
      scopeDepartmentId: auditCycles.scopeDepartmentId,
      scopeDepartmentName: departments.name,
      scopeLocation: auditCycles.scopeLocation,
      startDate: auditCycles.startDate,
      endDate: auditCycles.endDate,
      status: auditCycles.status,
      createdAt: auditCycles.createdAt,
      closedAt: auditCycles.closedAt,
      totalItems: sql<number>`(
        select count(*)::int from "audit_items"
        where "audit_items"."cycle_id" = "audit_cycles"."id"
      )`,
      checkedItems: sql<number>`(
        select count(*)::int from "audit_items"
        where "audit_items"."cycle_id" = "audit_cycles"."id"
          and "audit_items"."status" <> 'pending'
      )`,
      discrepancies: sql<number>`(
        select count(*)::int from "audit_items"
        where "audit_items"."cycle_id" = "audit_cycles"."id"
          and "audit_items"."status" in ('missing', 'damaged')
      )`,
    })
    .from(auditCycles)
    .leftJoin(departments, eq(auditCycles.scopeDepartmentId, departments.id))
    .where(eq(auditCycles.organizationId, ctx.orgId))
    .orderBy(desc(auditCycles.createdAt));

  // The auditors of every cycle in one query, rather than one per cycle.
  const auditorRows = cycles.length
    ? await db
        .select({
          cycleId: auditCycleAuditors.cycleId,
          id: users.id,
          name: users.name,
        })
        .from(auditCycleAuditors)
        .innerJoin(users, eq(auditCycleAuditors.userId, users.id))
        .where(
          inArray(
            auditCycleAuditors.cycleId,
            cycles.map((cycle) => cycle.id),
          ),
        )
    : [];

  return cycles.map((cycle) => ({
    ...cycle,
    createdAt: cycle.createdAt.toISOString(),
    closedAt: cycle.closedAt?.toISOString() ?? null,
    auditors: auditorRows
      .filter((auditor) => auditor.cycleId === cycle.id)
      .map(({ id, name }) => ({ id, name })),
  }));
}

export { count };
