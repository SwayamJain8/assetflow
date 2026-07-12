import { aliasedTable, and, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";

import { db } from "../../config/db";
import { allocations, assets, departments, transferRequests, users } from "../../db/schema";
import { AppError } from "../../middleware/error-handler";
import { record } from "../../services/activity";
import type { Ctx } from "../../types";
import { PG, pgErrorOf } from "../../utils/pg-error";
import type {
  CreateAllocationInput,
  CreateTransferInput,
  ListAllocationsInput,
  ListTransfersInput,
  ReturnAllocationInput,
} from "./allocations.schema";

const holder = aliasedTable(users, "holder");
const allocator = aliasedTable(users, "allocator");
const fromUser = aliasedTable(users, "from_user");
const toUser = aliasedTable(users, "to_user");
const requester = aliasedTable(users, "requester");
const holderDepartment = aliasedTable(departments, "holder_department");

/** Statuses from which an asset may be handed to someone. */
const ALLOCATABLE = new Set(["available", "reserved"]);

const STATUS_REASON: Record<string, string> = {
  under_maintenance: "is under maintenance",
  lost: "is marked lost",
  retired: "has been retired",
  disposed: "has been disposed of",
  allocated: "is already allocated",
};

/** Who currently holds this asset — the single row with returned_at IS NULL. */
async function currentHolder(assetId: string) {
  const [row] = await db
    .select({
      allocationId: allocations.id,
      userId: allocations.holderUserId,
      userName: holder.name,
      departmentId: allocations.holderDepartmentId,
      // The department the asset was allocated TO, when it went to a department
      // rather than a person.
      departmentName: departments.name,
      // The holder's OWN department — this is what "held by Priya Sharma
      // (Engineering)" means in the mockup, and it is a different thing.
      holderDepartmentName: holderDepartment.name,
      allocatedAt: allocations.allocatedAt,
      expectedReturnDate: allocations.expectedReturnDate,
    })
    .from(allocations)
    .leftJoin(holder, eq(allocations.holderUserId, holder.id))
    .leftJoin(departments, eq(allocations.holderDepartmentId, departments.id))
    .leftJoin(holderDepartment, eq(holder.departmentId, holderDepartment.id))
    .where(and(eq(allocations.assetId, assetId), isNull(allocations.returnedAt)));

  return row ?? null;
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
 * ★ GOLDEN SCENARIO #1 ★
 *
 * Spec: "Priya has Laptop AF-0114. If Raj tries to allocate it, the system blocks
 * it, shows 'currently held by Priya', and offers a Transfer Request button."
 *
 * The block is NOT a check in this function. Notice there is no
 * "SELECT ... WHERE returned_at IS NULL" before the insert — that would be a race:
 * two concurrent requests would both see the asset free and both write, and the
 * laptop would end up held by two people.
 *
 * Instead we simply attempt the insert. PostgreSQL's partial unique index
 * (one_active_allocation) refuses the second one, atomically, under any amount of
 * concurrency. We catch that refusal and only THEN look up who the holder is — so
 * the lookup is for the error message, not for the decision.
 *
 * The database decides. This code just explains the decision.
 */
export async function allocate(ctx: Ctx, input: CreateAllocationInput) {
  const asset = await mustFindAsset(ctx, input.assetId);

  // Pre-checks that the DB cannot express: an asset under maintenance or already
  // retired should not be handed out even though no allocation row blocks it.
  // (The "already allocated" case is deliberately NOT pre-checked — see above.)
  if (!ALLOCATABLE.has(asset.status) && asset.status !== "allocated") {
    throw new AppError(
      409,
      "ASSET_NOT_ALLOCATABLE",
      `${asset.assetTag} ${STATUS_REASON[asset.status] ?? "is unavailable"} and cannot be allocated.`,
    );
  }

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(allocations)
        .values({
          organizationId: ctx.orgId,
          assetId: input.assetId,
          holderUserId: input.holderUserId ?? null,
          holderDepartmentId: input.holderDepartmentId ?? null,
          allocatedBy: ctx.user.id,
          expectedReturnDate: input.expectedReturnDate ?? null,
        })
        .returning();

      await tx.update(assets).set({ status: "allocated" }).where(eq(assets.id, input.assetId));

      return created!;
    });
  } catch (error) {
    const pg = pgErrorOf(error);

    // The index fired: someone already holds this asset.
    if (pg?.code === PG.UNIQUE_VIOLATION && pg.constraint === "one_active_allocation") {
      const held = await currentHolder(input.assetId);
      const holderName = held?.userName ?? held?.departmentName ?? "someone else";

      // The 409 carries the holder in `details`, so the UI can render
      // "currently held by Priya Sharma" and the Transfer Request button without
      // a second round-trip.
      throw new AppError(
        409,
        "ASSET_ALREADY_ALLOCATED",
        `${asset.assetTag} is currently held by ${holderName}. Direct re-allocation is blocked — submit a transfer request instead.`,
        {
          holder: {
            id: held?.userId ?? null,
            name: holderName,
            department: held?.holderDepartmentName ?? held?.departmentName ?? null,
          },
          canRequestTransfer: true,
        },
      );
    }

    throw error;
  }
}

/** Allocation happened; now tell the world. Split out so allocate() stays readable. */
export async function allocateAndNotify(ctx: Ctx, input: CreateAllocationInput) {
  const created = await allocate(ctx, input);
  const asset = await mustFindAsset(ctx, input.assetId);
  const held = await currentHolder(input.assetId);
  const holderName = held?.userName ?? held?.departmentName ?? "a department";

  await record(ctx, {
    entity: "asset",
    entityId: input.assetId,
    action: "allocated",
    summary: `${asset.name} (${asset.assetTag}) allocated to ${holderName}`,
    metadata: { holder: holderName, expectedReturnDate: input.expectedReturnDate ?? null },
    ...(input.holderUserId && {
      notify: {
        userId: input.holderUserId,
        type: "asset_assigned" as const,
        title: `${asset.assetTag} assigned to you`,
        body: input.expectedReturnDate
          ? `${asset.name} — please return it by ${input.expectedReturnDate}.`
          : asset.name,
        link: "/allocation",
      },
    }),
  });

  return created;
}

/**
 * Return flow: close the allocation and put the asset back to Available.
 *
 * Setting `returned_at` is what releases the partial unique index — the row stays
 * as history, but it no longer blocks the next allocation. That is the whole
 * elegance of `WHERE returned_at IS NULL`.
 */
export async function returnAsset(ctx: Ctx, assetId: string, input: ReturnAllocationInput) {
  const asset = await mustFindAsset(ctx, assetId);
  const held = await currentHolder(assetId);

  if (!held) {
    throw new AppError(
      409,
      "NOT_ALLOCATED",
      `${asset.assetTag} is not currently allocated to anyone.`,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(allocations)
      .set({
        returnedAt: new Date(),
        returnConditionNotes: input.returnConditionNotes ?? null,
      })
      .where(eq(allocations.id, held.allocationId));

    await tx
      .update(assets)
      .set({
        status: "available",
        ...(input.condition && { condition: input.condition }),
      })
      .where(eq(assets.id, assetId));
  });

  const holderName = held.userName ?? held.departmentName ?? "someone";

  await record(ctx, {
    entity: "asset",
    entityId: assetId,
    action: "returned",
    summary: `${asset.name} (${asset.assetTag}) returned by ${holderName}${
      input.condition ? ` — condition: ${input.condition}` : ""
    }`,
    metadata: { notes: input.returnConditionNotes ?? null, condition: input.condition ?? null },
  });

  return { assetId, status: "available" as const };
}

export async function listAllocations(ctx: Ctx, query: ListAllocationsInput) {
  const filters = [eq(allocations.organizationId, ctx.orgId)];

  if (query.assetId) filters.push(eq(allocations.assetId, query.assetId));
  if (query.holderUserId) filters.push(eq(allocations.holderUserId, query.holderUserId));
  if (query.active === "true") filters.push(isNull(allocations.returnedAt));
  if (query.active === "false") filters.push(isNotNull(allocations.returnedAt));

  // Overdue = past the expected return date and still not returned.
  if (query.overdue === "true") {
    filters.push(isNull(allocations.returnedAt));
    filters.push(lt(allocations.expectedReturnDate, sql`current_date`));
  }

  const rows = await db
    .select({
      id: allocations.id,
      assetId: allocations.assetId,
      assetTag: assets.assetTag,
      assetName: assets.name,
      holderName: holder.name,
      holderDepartmentName: departments.name,
      allocatedByName: allocator.name,
      allocatedAt: allocations.allocatedAt,
      expectedReturnDate: allocations.expectedReturnDate,
      returnedAt: allocations.returnedAt,
      returnConditionNotes: allocations.returnConditionNotes,
      isOverdue: sql<boolean>`(
        "allocations"."returned_at" is null
        and "allocations"."expected_return_date" is not null
        and "allocations"."expected_return_date" < current_date
      )`,
    })
    .from(allocations)
    .innerJoin(assets, eq(allocations.assetId, assets.id))
    .leftJoin(holder, eq(allocations.holderUserId, holder.id))
    .leftJoin(departments, eq(allocations.holderDepartmentId, departments.id))
    .leftJoin(allocator, eq(allocations.allocatedBy, allocator.id))
    .where(and(...filters))
    .orderBy(desc(allocations.allocatedAt));

  return rows.map((row) => ({
    ...row,
    allocatedAt: row.allocatedAt.toISOString(),
    returnedAt: row.returnedAt?.toISOString() ?? null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Transfers — the sanctioned way around the double-allocation block.
// Requested → Approved → Re-allocated.
// ─────────────────────────────────────────────────────────────────────────────

export async function requestTransfer(ctx: Ctx, input: CreateTransferInput) {
  const asset = await mustFindAsset(ctx, input.assetId);
  const held = await currentHolder(input.assetId);

  if (!held) {
    throw new AppError(
      409,
      "NOT_ALLOCATED",
      `${asset.assetTag} is not held by anyone — allocate it directly instead of requesting a transfer.`,
    );
  }

  if (held.userId === input.toUserId) {
    throw new AppError(
      422,
      "ALREADY_HELD_BY_TARGET",
      `${held.userName} already holds ${asset.assetTag}.`,
    );
  }

  const [existing] = await db
    .select()
    .from(transferRequests)
    .where(
      and(
        eq(transferRequests.assetId, input.assetId),
        eq(transferRequests.status, "requested"),
      ),
    );

  if (existing) {
    throw new AppError(
      409,
      "TRANSFER_ALREADY_PENDING",
      `A transfer request for ${asset.assetTag} is already awaiting approval.`,
    );
  }

  const [created] = await db
    .insert(transferRequests)
    .values({
      organizationId: ctx.orgId,
      assetId: input.assetId,
      fromUserId: held.userId,
      toUserId: input.toUserId,
      reason: input.reason,
      requestedBy: ctx.user.id,
      // status omitted — the DB default is 'requested'
    })
    .returning();

  const [recipient] = await db.select().from(users).where(eq(users.id, input.toUserId));

  await record(ctx, {
    entity: "transfer",
    entityId: created!.id,
    action: "transfer_requested",
    summary: `Transfer requested: ${asset.assetTag} from ${held.userName} to ${recipient?.name}`,
    metadata: { assetTag: asset.assetTag },
  });

  return created!;
}

/**
 * Approving a transfer performs the re-allocation ATOMICALLY.
 *
 * Both writes must land together: close the old allocation, open the new one. If
 * they were separate statements and the second failed, the asset would be held by
 * nobody — silently lost from the ledger. Inside one transaction, either the
 * handover completes or nothing changed.
 *
 * Ordering matters too: the close must precede the open, or the new INSERT would
 * hit one_active_allocation and be refused by the very constraint this flow exists
 * to work around.
 */
export async function approveTransfer(ctx: Ctx, transferId: string) {
  const [transfer] = await db
    .select()
    .from(transferRequests)
    .where(
      and(
        eq(transferRequests.id, transferId),
        eq(transferRequests.organizationId, ctx.orgId),
      ),
    );

  if (!transfer) throw new AppError(404, "TRANSFER_NOT_FOUND", "That transfer request does not exist.");

  if (transfer.status !== "requested") {
    throw new AppError(
      409,
      "TRANSFER_NOT_PENDING",
      `This transfer has already been ${transfer.status}.`,
    );
  }

  const asset = await mustFindAsset(ctx, transfer.assetId);
  const held = await currentHolder(transfer.assetId);
  const [recipient] = await db.select().from(users).where(eq(users.id, transfer.toUserId));

  await db.transaction(async (tx) => {
    // 1. Close the current allocation — this is what frees the partial unique index.
    if (held) {
      await tx
        .update(allocations)
        .set({
          returnedAt: new Date(),
          returnConditionNotes: `Transferred to ${recipient?.name ?? "another employee"}.`,
        })
        .where(eq(allocations.id, held.allocationId));
    }

    // 2. Open the new one. Only possible because step 1 already ran.
    await tx.insert(allocations).values({
      organizationId: ctx.orgId,
      assetId: transfer.assetId,
      holderUserId: transfer.toUserId,
      allocatedBy: ctx.user.id,
      expectedReturnDate: held?.expectedReturnDate ?? null,
    });

    await tx
      .update(transferRequests)
      .set({ status: "reallocated", approvedBy: ctx.user.id, resolvedAt: new Date() })
      .where(eq(transferRequests.id, transferId));

    await tx.update(assets).set({ status: "allocated" }).where(eq(assets.id, transfer.assetId));
  });

  await record(ctx, {
    entity: "asset",
    entityId: transfer.assetId,
    action: "transfer_approved",
    summary: `Transfer approved: ${asset.assetTag} from ${held?.userName ?? "—"} to ${recipient?.name}`,
    metadata: { transferId },
    notify: {
      userId: transfer.toUserId,
      type: "transfer_approved",
      title: `${asset.assetTag} transferred to you`,
      body: `${asset.name} is now allocated to you.`,
      link: "/allocation",
    },
  });

  // The previous holder is told too — their asset moved on.
  if (transfer.fromUserId) {
    await record(ctx, {
      entity: "transfer",
      entityId: transferId,
      action: "transfer_completed",
      summary: `${asset.assetTag} handed over to ${recipient?.name}`,
      notify: {
        userId: transfer.fromUserId,
        type: "transfer_approved",
        title: `${asset.assetTag} transferred away`,
        body: `${asset.name} is now held by ${recipient?.name}.`,
        link: "/allocation",
      },
    });
  }

  return { id: transferId, status: "reallocated" as const };
}

export async function rejectTransfer(ctx: Ctx, transferId: string) {
  const [transfer] = await db
    .select()
    .from(transferRequests)
    .where(
      and(eq(transferRequests.id, transferId), eq(transferRequests.organizationId, ctx.orgId)),
    );

  if (!transfer) throw new AppError(404, "TRANSFER_NOT_FOUND", "That transfer request does not exist.");

  if (transfer.status !== "requested") {
    throw new AppError(
      409,
      "TRANSFER_NOT_PENDING",
      `This transfer has already been ${transfer.status}.`,
    );
  }

  await db
    .update(transferRequests)
    .set({ status: "rejected", approvedBy: ctx.user.id, resolvedAt: new Date() })
    .where(eq(transferRequests.id, transferId));

  const asset = await mustFindAsset(ctx, transfer.assetId);

  await record(ctx, {
    entity: "transfer",
    entityId: transferId,
    action: "transfer_rejected",
    summary: `Transfer of ${asset.assetTag} rejected by ${ctx.user.name}`,
    ...(transfer.requestedBy && {
      notify: {
        userId: transfer.requestedBy,
        type: "transfer_approved" as const,
        title: `Transfer of ${asset.assetTag} was rejected`,
        body: `${ctx.user.name} declined the request.`,
        link: "/allocation",
      },
    }),
  });

  return { id: transferId, status: "rejected" as const };
}

export async function listTransfers(ctx: Ctx, query: ListTransfersInput) {
  const filters = [eq(transferRequests.organizationId, ctx.orgId)];

  if (query.status) filters.push(eq(transferRequests.status, query.status));
  if (query.assetId) filters.push(eq(transferRequests.assetId, query.assetId));

  const rows = await db
    .select({
      id: transferRequests.id,
      assetId: transferRequests.assetId,
      assetTag: assets.assetTag,
      assetName: assets.name,
      fromName: fromUser.name,
      toName: toUser.name,
      reason: transferRequests.reason,
      status: transferRequests.status,
      requestedByName: requester.name,
      createdAt: transferRequests.createdAt,
      resolvedAt: transferRequests.resolvedAt,
    })
    .from(transferRequests)
    .innerJoin(assets, eq(transferRequests.assetId, assets.id))
    .leftJoin(fromUser, eq(transferRequests.fromUserId, fromUser.id))
    .leftJoin(toUser, eq(transferRequests.toUserId, toUser.id))
    .leftJoin(requester, eq(transferRequests.requestedBy, requester.id))
    .where(and(...filters))
    .orderBy(desc(transferRequests.createdAt));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  }));
}
