import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";

import { db } from "../../config/db";
import {
  activityLogs,
  allocations,
  assetCategories,
  assets,
  departments,
  maintenanceRequests,
  users,
} from "../../db/schema";
import { AppError } from "../../middleware/error-handler";
import { record } from "../../services/activity";
import { saveUpload } from "../../services/storage";
import type { Ctx } from "../../types";
import type { CreateAssetInput, ListAssetsInput, UpdateAssetInput } from "./assets.schema";

/**
 * Who is holding this asset right now. `returned_at IS NULL` is the definition of
 * an open allocation — the very predicate the one_active_allocation index uses, so
 * this can only ever match a single row.
 */
const currentHolderName = sql<string | null>`(
  select u.name from "allocations" al
  join "users" u on u.id = al.holder_user_id
  where al.asset_id = "assets"."id" and al.returned_at is null
  limit 1
)`;

const currentHolderId = sql<string | null>`(
  select al.holder_user_id from "allocations" al
  where al.asset_id = "assets"."id" and al.returned_at is null
  limit 1
)`;

const currentExpectedReturn = sql<string | null>`(
  select al.expected_return_date::text from "allocations" al
  where al.asset_id = "assets"."id" and al.returned_at is null
  limit 1
)`;

const assetColumns = {
  id: assets.id,
  assetTag: assets.assetTag,
  name: assets.name,
  categoryId: assets.categoryId,
  categoryName: assetCategories.name,
  departmentId: assets.departmentId,
  departmentName: departments.name,
  serialNumber: assets.serialNumber,
  acquisitionDate: assets.acquisitionDate,
  acquisitionCost: assets.acquisitionCost,
  condition: assets.condition,
  location: assets.location,
  photoPath: assets.photoPath,
  isBookable: assets.isBookable,
  status: assets.status,
  retirementDate: assets.retirementDate,
  customValues: assets.customValues,
  holderName: currentHolderName,
  holderId: currentHolderId,
  expectedReturnDate: currentExpectedReturn,
};

export async function listAssets(ctx: Ctx, query: ListAssetsInput) {
  const filters = [eq(assets.organizationId, ctx.orgId)];

  /**
   * The spec's search keys: "Asset Tag, Serial Number, QR code, category, status,
   * department, or location."
   *
   * Searching "by QR code" needs no separate column: the QR image encodes the
   * asset tag, so a scanner types the tag straight into this same box and the tag
   * match handles it. One code path, and it works with a phone camera or a
   * keyboard-wedge scanner alike.
   */
  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(
      or(
        ilike(assets.assetTag, term),
        ilike(assets.serialNumber, term),
        ilike(assets.name, term),
      )!,
    );
  }

  if (query.status) filters.push(eq(assets.status, query.status));
  if (query.categoryId) filters.push(eq(assets.categoryId, query.categoryId));
  if (query.departmentId) filters.push(eq(assets.departmentId, query.departmentId));
  if (query.location) filters.push(ilike(assets.location, `%${query.location}%`));
  if (query.isBookable) filters.push(eq(assets.isBookable, query.isBookable === "true"));

  return db
    .select(assetColumns)
    .from(assets)
    .leftJoin(assetCategories, eq(assets.categoryId, assetCategories.id))
    .leftJoin(departments, eq(assets.departmentId, departments.id))
    .where(and(...filters))
    .orderBy(assets.assetTag)
    .limit(query.limit)
    .offset(query.offset);
}

export async function getAsset(ctx: Ctx, id: string) {
  const [asset] = await db
    .select(assetColumns)
    .from(assets)
    .leftJoin(assetCategories, eq(assets.categoryId, assetCategories.id))
    .leftJoin(departments, eq(assets.departmentId, departments.id))
    .where(and(eq(assets.id, id), eq(assets.organizationId, ctx.orgId)));

  if (!asset) throw new AppError(404, "ASSET_NOT_FOUND", "That asset does not exist.");

  return asset;
}

/** Both histories the spec requires per asset, in one call for the detail drawer. */
export async function getAssetHistory(ctx: Ctx, id: string) {
  await getAsset(ctx, id); // 404s if it is not ours — do not leak another org's data

  const allocationHistory = await db
    .select({
      id: allocations.id,
      holderName: users.name,
      allocatedAt: allocations.allocatedAt,
      expectedReturnDate: allocations.expectedReturnDate,
      returnedAt: allocations.returnedAt,
      returnConditionNotes: allocations.returnConditionNotes,
    })
    .from(allocations)
    .leftJoin(users, eq(allocations.holderUserId, users.id))
    .where(eq(allocations.assetId, id))
    .orderBy(desc(allocations.allocatedAt));

  const maintenanceHistory = await db
    .select({
      id: maintenanceRequests.id,
      issueDescription: maintenanceRequests.issueDescription,
      priority: maintenanceRequests.priority,
      status: maintenanceRequests.status,
      createdAt: maintenanceRequests.createdAt,
      resolvedAt: maintenanceRequests.resolvedAt,
    })
    .from(maintenanceRequests)
    .where(eq(maintenanceRequests.assetId, id))
    .orderBy(desc(maintenanceRequests.createdAt));

  return { allocationHistory, maintenanceHistory };
}

/**
 * THE LIFECYCLE TIMELINE.
 *
 * No new table, no new writes — this is just a query over `activity_logs`, which
 * every mutation already appends to via services/activity.ts. The feature exists
 * because the history was modelled properly, which is precisely the point worth
 * showing.
 */
export async function getAssetTimeline(ctx: Ctx, id: string) {
  await getAsset(ctx, id);

  const rows = await db
    .select({
      id: activityLogs.id,
      action: activityLogs.action,
      summary: activityLogs.summary,
      actorName: users.name,
      metadata: activityLogs.metadata,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    .leftJoin(users, eq(activityLogs.actorId, users.id))
    .where(and(eq(activityLogs.entityType, "asset"), eq(activityLogs.entityId, id)))
    .orderBy(desc(activityLogs.createdAt));

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function createAsset(ctx: Ctx, input: CreateAssetInput) {
  // No assetTag is supplied: the column's DEFAULT calls nextval('asset_tag_seq'),
  // so PostgreSQL mints AF-0001, AF-0002 … atomically. A read-max-then-increment
  // in application code would race under concurrent registrations.
  const [created] = await db
    .insert(assets)
    .values({
      organizationId: ctx.orgId,
      name: input.name,
      categoryId: input.categoryId ?? null,
      departmentId: input.departmentId ?? null,
      serialNumber: input.serialNumber ?? null,
      acquisitionDate: input.acquisitionDate ?? null,
      acquisitionCost: input.acquisitionCost?.toString() ?? null,
      condition: input.condition,
      location: input.location ?? null,
      isBookable: input.isBookable,
      retirementDate: input.retirementDate ?? null,
      customValues: input.customValues,
      createdBy: ctx.user.id,
      // status omitted: the DB default is 'available' — "registers a new asset →
      // enters as Available".
    })
    .returning();

  await record(ctx, {
    entity: "asset",
    entityId: created!.id,
    action: "registered",
    summary: `${created!.name} (${created!.assetTag}) registered`,
    metadata: { assetTag: created!.assetTag },
  });

  return created!;
}

export async function updateAsset(ctx: Ctx, id: string, input: UpdateAssetInput) {
  const existing = await getAsset(ctx, id);

  // An asset someone is holding cannot be retired or disposed of out from under
  // them — the holder would be left with an object the system says no longer exists.
  if (input.status && input.status !== "available" && existing.holderName) {
    throw new AppError(
      409,
      "ASSET_IS_HELD",
      `${existing.assetTag} is currently held by ${existing.holderName}. Process the return before retiring it.`,
    );
  }

  const [updated] = await db
    .update(assets)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
      ...(input.departmentId !== undefined && { departmentId: input.departmentId }),
      ...(input.serialNumber !== undefined && { serialNumber: input.serialNumber }),
      ...(input.acquisitionDate !== undefined && { acquisitionDate: input.acquisitionDate }),
      ...(input.acquisitionCost !== undefined && {
        acquisitionCost: input.acquisitionCost?.toString() ?? null,
      }),
      ...(input.condition !== undefined && { condition: input.condition }),
      ...(input.location !== undefined && { location: input.location }),
      ...(input.isBookable !== undefined && { isBookable: input.isBookable }),
      ...(input.retirementDate !== undefined && { retirementDate: input.retirementDate }),
      ...(input.customValues !== undefined && { customValues: input.customValues }),
      ...(input.status !== undefined && { status: input.status }),
    })
    .where(and(eq(assets.id, id), eq(assets.organizationId, ctx.orgId)))
    .returning();

  await record(ctx, {
    entity: "asset",
    entityId: id,
    action: input.status ?? "updated",
    summary: input.status
      ? `${existing.assetTag} marked ${input.status.replace(/_/g, " ")}`
      : `${existing.assetTag} details updated`,
  });

  return updated!;
}

export async function setAssetPhoto(ctx: Ctx, id: string, file: File) {
  const existing = await getAsset(ctx, id);
  const photoPath = await saveUpload(file);

  await db
    .update(assets)
    .set({ photoPath })
    .where(and(eq(assets.id, id), eq(assets.organizationId, ctx.orgId)));

  await record(ctx, {
    entity: "asset",
    entityId: id,
    action: "photo_updated",
    summary: `Photo added to ${existing.assetTag}`,
  });

  return { photoPath };
}

/** The bookable resources, for the Resource Booking screen's picker. */
export async function listBookableResources(ctx: Ctx) {
  return db
    .select({
      id: assets.id,
      assetTag: assets.assetTag,
      name: assets.name,
      location: assets.location,
      categoryName: assetCategories.name,
      status: assets.status,
    })
    .from(assets)
    .leftJoin(assetCategories, eq(assets.categoryId, assetCategories.id))
    .where(
      and(
        eq(assets.organizationId, ctx.orgId),
        eq(assets.isBookable, true),
        // A room under maintenance or disposed of cannot be booked.
        or(eq(assets.status, "available"), eq(assets.status, "reserved"))!,
      ),
    )
    .orderBy(assets.name);
}

/** Fed by both the asset picker and the Cmd-K palette. */
export async function findAssetByTag(ctx: Ctx, tag: string) {
  const [asset] = await db
    .select(assetColumns)
    .from(assets)
    .leftJoin(assetCategories, eq(assets.categoryId, assetCategories.id))
    .leftJoin(departments, eq(assets.departmentId, departments.id))
    .where(and(eq(assets.organizationId, ctx.orgId), ilike(assets.assetTag, tag)));

  if (!asset) throw new AppError(404, "ASSET_NOT_FOUND", `No asset with the tag "${tag}".`);

  return asset;
}

export { isNull };
