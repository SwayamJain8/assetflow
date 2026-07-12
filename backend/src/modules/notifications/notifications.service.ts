import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "../../config/db";
import { activityLogs, notifications, users } from "../../db/schema";
import { AppError } from "../../middleware/error-handler";
import type { Ctx } from "../../types";

/**
 * The filter tabs from the mockup: All / Alerts / Approvals / Bookings.
 *
 * Kept as a map rather than scattered `if`s so the tabs and the notification
 * types can never drift apart — adding a new type without classifying it is a
 * compile error, not a notification that silently appears under no tab.
 */
export const TABS = {
  alerts: ["overdue_return", "audit_discrepancy"],
  approvals: [
    "maintenance_approved",
    "maintenance_rejected",
    "transfer_approved",
    "asset_assigned",
  ],
  bookings: ["booking_confirmed", "booking_cancelled", "booking_reminder"],
} as const;

export type Tab = keyof typeof TABS | "all";

export async function listNotifications(ctx: Ctx, tab: Tab = "all", unreadOnly = false) {
  const filters = [
    eq(notifications.organizationId, ctx.orgId),
    // A notification belongs to ONE person. Never show someone else's.
    eq(notifications.userId, ctx.user.id),
  ];

  if (tab !== "all") {
    filters.push(inArray(notifications.type, [...TABS[tab]]));
  }

  if (unreadOnly) filters.push(isNull(notifications.readAt));

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(...filters))
    .orderBy(desc(notifications.createdAt))
    .limit(100);

  return rows.map((row) => ({
    ...row,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    isRead: row.readAt !== null,
  }));
}

/** The bell's badge. */
export async function unreadCount(ctx: Ctx) {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, ctx.orgId),
        eq(notifications.userId, ctx.user.id),
        isNull(notifications.readAt),
      ),
    );

  return { unread: row?.n ?? 0 };
}

export async function markRead(ctx: Ctx, id: string) {
  const [updated] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        // Scoped to the caller: you cannot mark somebody else's notification read.
        eq(notifications.userId, ctx.user.id),
      ),
    )
    .returning();

  if (!updated) {
    throw new AppError(404, "NOTIFICATION_NOT_FOUND", "That notification does not exist.");
  }

  return { id, isRead: true };
}

export async function markAllRead(ctx: Ctx) {
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.organizationId, ctx.orgId),
        eq(notifications.userId, ctx.user.id),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });

  return { markedRead: updated.length };
}

/**
 * The Activity Log — "who did what, when", org-wide.
 *
 * Distinct from notifications: a notification is addressed to one person and can
 * be dismissed; an activity log entry is an immutable record of what happened and
 * belongs to the organization.
 */
export async function listActivity(ctx: Ctx, entityType?: string, limit = 100) {
  const filters = [eq(activityLogs.organizationId, ctx.orgId)];
  if (entityType) filters.push(eq(activityLogs.entityType, entityType));

  const rows = await db
    .select({
      id: activityLogs.id,
      entityType: activityLogs.entityType,
      entityId: activityLogs.entityId,
      action: activityLogs.action,
      summary: activityLogs.summary,
      actorName: users.name,
      metadata: activityLogs.metadata,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    .leftJoin(users, eq(activityLogs.actorId, users.id))
    .where(and(...filters))
    .orderBy(desc(activityLogs.createdAt))
    .limit(limit);

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export { sql };
