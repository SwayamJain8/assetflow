import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";

import { db } from "../../config/db";
import { activityLogs, allocations, assets, users } from "../../db/schema";
import type { Ctx } from "../../types";

type Kpis = {
  available: number;
  allocated: number;
  underMaintenance: number;
  maintenanceToday: number;
  activeBookings: number;
  pendingTransfers: number;
  upcomingReturns: number;
  overdueReturns: number;
};

/**
 * All six KPI cards in ONE round-trip.
 *
 * Six separate COUNT queries would be six network round-trips and six sequential
 * scans; a single SELECT of scalar subqueries is one. The dashboard is the first
 * thing every user loads, so this is the query worth being careful about.
 */
export async function getKpis(ctx: Ctx): Promise<Kpis> {
  const result = await db.execute<Record<keyof Kpis, string>>(sql`
    select
      (select count(*) from assets
        where organization_id = ${ctx.orgId} and status = 'available')          as available,

      (select count(*) from assets
        where organization_id = ${ctx.orgId} and status = 'allocated')          as allocated,

      (select count(*) from assets
        where organization_id = ${ctx.orgId} and status = 'under_maintenance')  as "underMaintenance",

      -- "Maintenance Today": raised or resolved today, i.e. what actually moved.
      (select count(*) from maintenance_requests
        where organization_id = ${ctx.orgId}
          and (created_at::date = current_date or resolved_at::date = current_date))
                                                                                as "maintenanceToday",

      -- Active = happening right now (not merely 'upcoming' in the column).
      (select count(*) from bookings
        where organization_id = ${ctx.orgId}
          and status <> 'cancelled'
          and now() >= starts_at and now() < ends_at)                           as "activeBookings",

      (select count(*) from transfer_requests
        where organization_id = ${ctx.orgId} and status = 'requested')          as "pendingTransfers",

      -- Due back within the next 7 days and not yet returned.
      (select count(*) from allocations
        where organization_id = ${ctx.orgId}
          and returned_at is null
          and expected_return_date is not null
          and expected_return_date >= current_date
          and expected_return_date <= current_date + interval '7 days')         as "upcomingReturns",

      -- Past due and still out. This drives the red banner.
      (select count(*) from allocations
        where organization_id = ${ctx.orgId}
          and returned_at is null
          and expected_return_date is not null
          and expected_return_date < current_date)                              as "overdueReturns"
  `);

  const row = result.rows[0]!;

  // Postgres returns bigint as a string — Number() it, or the UI renders "12" as
  // a string and arithmetic on it silently concatenates.
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)]),
  ) as unknown as Kpis;
}

/** The red banner: who is holding what, past its due date. */
export async function getOverdue(ctx: Ctx) {
  const rows = await db
    .select({
      allocationId: allocations.id,
      assetId: assets.id,
      assetTag: assets.assetTag,
      assetName: assets.name,
      holderName: users.name,
      expectedReturnDate: allocations.expectedReturnDate,
      daysOverdue: sql<number>`(current_date - "allocations"."expected_return_date")::int`,
    })
    .from(allocations)
    .innerJoin(assets, eq(allocations.assetId, assets.id))
    .leftJoin(users, eq(allocations.holderUserId, users.id))
    .where(
      and(
        eq(allocations.organizationId, ctx.orgId),
        isNull(allocations.returnedAt),
        lt(allocations.expectedReturnDate, sql`current_date`),
      ),
    )
    .orderBy(allocations.expectedReturnDate);

  return rows;
}

/** "Recent Activity" — straight off the activity_logs table every mutation writes. */
export async function getRecentActivity(ctx: Ctx, limit = 8) {
  const rows = await db
    .select({
      id: activityLogs.id,
      action: activityLogs.action,
      summary: activityLogs.summary,
      entityType: activityLogs.entityType,
      entityId: activityLogs.entityId,
      actorName: users.name,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    .leftJoin(users, eq(activityLogs.actorId, users.id))
    .where(eq(activityLogs.organizationId, ctx.orgId))
    .orderBy(desc(activityLogs.createdAt))
    .limit(limit);

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/** One call: everything the dashboard screen needs. */
export async function getDashboard(ctx: Ctx) {
  const [kpis, overdue, recentActivity] = await Promise.all([
    getKpis(ctx),
    getOverdue(ctx),
    getRecentActivity(ctx),
  ]);

  return { kpis, overdue, recentActivity };
}
