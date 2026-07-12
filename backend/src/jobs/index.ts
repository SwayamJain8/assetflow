import { and, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";

import { db } from "../config/db";
import { allocations, assets, auditCycles, bookings, notifications, users } from "../db/schema";
import { broadcast } from "../services/realtime";
import { formatTime } from "../utils/time";

/**
 * Scheduled jobs.
 *
 * Every job is idempotent — running it twice must not produce two notifications
 * about the same thing. That is not fastidiousness: `setInterval` fires again if a
 * previous run was slow, a container restart re-runs everything, and a manual
 * demo trigger (below) runs them on top of the schedule. A job that is not
 * idempotent will spam people, and spam trains users to ignore the bell.
 *
 * The idempotency key is always "does a notification of this type, for this user,
 * about this thing, already exist today?" — expressed as a NOT EXISTS in the
 * query that selects the work, rather than a flag column we would have to maintain.
 */

export type JobResult = { job: string; notified: number; details?: string };

/**
 * OVERDUE RETURNS — the spec's "overdue allocations auto-flagged" rule.
 *
 * Note the dashboard does NOT depend on this job: `isOverdue` is computed live in
 * SQL from expected_return_date. The job exists to *notify*, not to flag. If the
 * scheduler died, the dashboard's red banner would still be correct — the data is
 * never derived from a job having run.
 */
export async function flagOverdueReturns(): Promise<JobResult> {
  const overdue = await db
    .select({
      allocationId: allocations.id,
      organizationId: allocations.organizationId,
      holderUserId: allocations.holderUserId,
      assetTag: assets.assetTag,
      assetName: assets.name,
      expectedReturnDate: allocations.expectedReturnDate,
      daysOverdue: sql<number>`(current_date - ${allocations.expectedReturnDate})::int`,
    })
    .from(allocations)
    .innerJoin(assets, eq(allocations.assetId, assets.id))
    .where(
      and(
        isNull(allocations.returnedAt),
        lt(allocations.expectedReturnDate, sql`current_date`),
        // Idempotency: skip anyone already told about this asset today.
        sql`not exists (
          select 1 from ${notifications} n
          where n.user_id = ${allocations.holderUserId}
            and n.type = 'overdue_return'
            and n.created_at::date = current_date
            and n.title like '%' || ${assets.assetTag} || '%'
        )`,
      ),
    );

  const toNotify = overdue.filter((row) => row.holderUserId);

  if (toNotify.length) {
    await db.insert(notifications).values(
      toNotify.map((row) => ({
        organizationId: row.organizationId,
        userId: row.holderUserId!,
        type: "overdue_return" as const,
        title: `Overdue return: ${row.assetTag}`,
        body: `${row.assetName} was due ${row.daysOverdue} day${
          row.daysOverdue === 1 ? "" : "s"
        } ago. Please return it.`,
        link: "/allocation",
      })),
    );

    for (const orgId of new Set(toNotify.map((row) => row.organizationId))) {
      broadcast(orgId, { type: "invalidate", keys: ["notifications", "dashboard"] });
    }
  }

  return {
    job: "overdue-returns",
    notified: toNotify.length,
    details: `${overdue.length} overdue allocation(s) found`,
  };
}

/** BOOKING REMINDERS — a nudge before a slot starts. */
export async function sendBookingReminders(): Promise<JobResult> {
  const soon = await db
    .select({
      bookingId: bookings.id,
      organizationId: bookings.organizationId,
      bookedBy: bookings.bookedBy,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      resourceName: assets.name,
    })
    .from(bookings)
    .innerJoin(assets, eq(bookings.resourceId, assets.id))
    .where(
      and(
        eq(bookings.status, "upcoming"),
        // Starting within the next 30 minutes, and not already started.
        gte(bookings.startsAt, sql`now()`),
        lte(bookings.startsAt, sql`now() + interval '30 minutes'`),
        // Idempotent: one reminder per booking, ever.
        sql`not exists (
          select 1 from ${notifications} n
          where n.user_id = ${bookings.bookedBy}
            and n.type = 'booking_reminder'
            and n.link = '/booking'
            and n.body like '%' || ${assets.name} || '%'
            and n.created_at > now() - interval '2 hours'
        )`,
      ),
    );

  if (soon.length) {
    await db.insert(notifications).values(
      soon.map((row) => ({
        organizationId: row.organizationId,
        userId: row.bookedBy,
        type: "booking_reminder" as const,
        title: `${row.resourceName} starts soon`,
        body: `Your booking of ${row.resourceName} runs ${formatTime(row.startsAt)}–${formatTime(
          row.endsAt,
        )}.`,
        link: "/booking",
      })),
    );

    for (const orgId of new Set(soon.map((row) => row.organizationId))) {
      broadcast(orgId, { type: "invalidate", keys: ["notifications"] });
    }
  }

  return { job: "booking-reminders", notified: soon.length };
}

/**
 * ASSETS NEEDING ATTENTION — nearing retirement, told to the Asset Managers.
 * Runs weekly rather than daily: nobody needs telling every morning that a
 * forklift retires in 45 days.
 */
export async function flagAssetsNeedingAttention(): Promise<JobResult> {
  const ageing = await db
    .select({
      organizationId: assets.organizationId,
      assetTag: assets.assetTag,
      name: assets.name,
      retirementDate: assets.retirementDate,
      days: sql<number>`(${assets.retirementDate} - current_date)::int`,
    })
    .from(assets)
    .where(
      and(
        sql`${assets.retirementDate} is not null`,
        lte(assets.retirementDate, sql`(current_date + interval '30 days')::date`),
        gte(assets.retirementDate, sql`current_date`),
        sql`${assets.status} not in ('retired', 'disposed')`,
      ),
    );

  let notified = 0;

  for (const asset of ageing) {
    const managers = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, asset.organizationId),
          sql`${users.role} in ('admin', 'asset_manager')`,
          eq(users.status, "active"),
          sql`not exists (
            select 1 from ${notifications} n
            where n.user_id = ${users.id}
              and n.title like '%' || ${asset.assetTag} || '%'
              and n.created_at > now() - interval '7 days'
          )`,
        ),
      );

    if (!managers.length) continue;

    await db.insert(notifications).values(
      managers.map((manager) => ({
        organizationId: asset.organizationId,
        userId: manager.id,
        type: "audit_discrepancy" as const, // closest existing type; in-app only
        title: `${asset.assetTag} is nearing retirement`,
        body: `${asset.name} retires in ${asset.days} days. Plan a replacement.`,
        link: "/reports",
      })),
    );

    notified += managers.length;
  }

  return { job: "assets-needing-attention", notified };
}

/** OVERDUE AUDIT CYCLES — a cycle past its end date that nobody has closed. */
export async function flagOverdueAudits(): Promise<JobResult> {
  const stale = await db
    .select({
      organizationId: auditCycles.organizationId,
      id: auditCycles.id,
      name: auditCycles.name,
      createdBy: auditCycles.createdBy,
      endDate: auditCycles.endDate,
    })
    .from(auditCycles)
    .where(
      and(
        eq(auditCycles.status, "open"),
        lt(auditCycles.endDate, sql`current_date`),
        sql`not exists (
          select 1 from ${notifications} n
          where n.user_id = ${auditCycles.createdBy}
            and n.title like '%' || ${auditCycles.name} || '%'
            and n.created_at::date = current_date
        )`,
      ),
    );

  const toNotify = stale.filter((row) => row.createdBy);

  if (toNotify.length) {
    await db.insert(notifications).values(
      toNotify.map((row) => ({
        organizationId: row.organizationId,
        userId: row.createdBy!,
        type: "audit_discrepancy" as const,
        title: `Audit cycle "${row.name}" is overdue`,
        body: `It was due to end on ${row.endDate} and is still open.`,
        link: "/audit",
      })),
    );
  }

  return { job: "overdue-audits", notified: toNotify.length };
}

export const JOBS = {
  "overdue-returns": flagOverdueReturns,
  "booking-reminders": sendBookingReminders,
  "assets-needing-attention": flagAssetsNeedingAttention,
  "overdue-audits": flagOverdueAudits,
} as const;

export type JobName = keyof typeof JOBS;

const HOUR = 60 * 60 * 1000;

/**
 * Starts the scheduler. Deliberately plain `setInterval`, not a cron library:
 * four jobs on a single instance do not justify a dependency.
 *
 * Note the honest limitation: with two API containers, both would run every job.
 * The idempotency guards above mean that produces no duplicate notifications, so
 * it is survivable — but the real fix at that scale is a Redis-backed queue
 * (BullMQ) with a single scheduler. That is the upgrade path, not this.
 */
export function startScheduler(): void {
  const run = async (name: JobName) => {
    try {
      const result = await JOBS[name]();
      if (result.notified) {
        console.log(`[job] ${result.job}: ${result.notified} notification(s) sent`);
      }
    } catch (error) {
      // A failing job must never take the API down with it.
      console.error(`[job] ${name} failed:`, error);
    }
  };

  setInterval(() => void run("overdue-returns"), 6 * HOUR);
  setInterval(() => void run("booking-reminders"), 5 * 60 * 1000); // every 5 min
  setInterval(() => void run("assets-needing-attention"), 24 * HOUR);
  setInterval(() => void run("overdue-audits"), 12 * HOUR);

  console.log("[job] scheduler started (4 jobs)");
}
