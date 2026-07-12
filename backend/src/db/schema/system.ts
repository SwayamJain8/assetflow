import { relations, sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizations, users } from "./org";
import { notificationType } from "./enums";

/**
 * The in-app feed. Every event the spec names (Asset Assigned, Maintenance
 * Approved/Rejected, Booking Confirmed/Cancelled/Reminder, Transfer Approved,
 * Overdue Return, Audit Discrepancy) lands here as a row, and is pushed to the
 * user's open WebSocket at the same time.
 *
 * `read_at IS NULL` = unread, which is the bell's badge count.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /** The recipient. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    type: notificationType("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),

    /** Deep link into the app, e.g. /assets/<id>. */
    link: text("link"),

    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The feed query: this user's notifications, newest first.
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    index("notifications_type_idx").on(t.type),
  ],
);

/**
 * "Who did what, when" — the immutable trail behind three separate features:
 *
 *   1. the Activity Log screen,
 *   2. the Dashboard's "Recent Activity" list, and
 *   3. the per-asset LIFECYCLE TIMELINE (filter by entity_type='asset' + entity_id).
 *
 * One append-only table serving all three is the point: the timeline is not a
 * separate feature to maintain, it is a query over history we were recording
 * anyway. Nothing ever UPDATEs or DELETEs a row here.
 */
export const activityLogs = pgTable(
  "activity_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /** NULL when the actor is the system (a cron job). */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),

    /** e.g. 'asset' | 'allocation' | 'booking' | 'maintenance' | 'audit' */
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),

    /** e.g. 'registered' | 'allocated' | 'returned' | 'maintenance_approved' */
    action: text("action").notNull(),

    /** Human-readable line for the feed: "Laptop AF-0114 allocated to Priya Shah". */
    summary: text("summary").notNull(),

    /** Structured extras (old/new status, amounts) without a schema change. */
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // THE timeline query: everything that ever happened to one asset, in order.
    index("activity_logs_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("activity_logs_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  actor: one(users, { fields: [activityLogs.actorId], references: [users.id] }),
}));
