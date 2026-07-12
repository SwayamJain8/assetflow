import { relations, sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { assets } from "./assets";
import { departments, organizations, users } from "./org";
import { transferStatus } from "./enums";

/**
 * SHOWPIECE #1 — an asset can have at most one active allocation, enforced by
 * PostgreSQL, not by application code.
 *
 * `returned_at IS NULL` means "still held". The partial unique index below
 * therefore permits unlimited *returned* allocations per asset (that is the
 * history), while allowing exactly one *open* one.
 *
 * Why this matters: the usual approach is a SELECT-then-INSERT check in the
 * service layer, which is a race — two concurrent requests both see "free" and
 * both insert. Here the database refuses the second write, so the guarantee
 * holds under concurrency. The name `one_active_allocation` is a contract:
 * middleware/error-handler.ts keys on it to produce
 * "This asset is already allocated to someone else."
 */
export const allocations = pgTable(
  "allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),

    // An asset is allocated to a person OR to a department. The CHECK below
    // guarantees at least one is present.
    holderUserId: uuid("holder_user_id").references(() => users.id, { onDelete: "cascade" }),
    holderDepartmentId: uuid("holder_department_id").references(() => departments.id, {
      onDelete: "cascade",
    }),

    allocatedBy: uuid("allocated_by").references(() => users.id, { onDelete: "set null" }),
    allocatedAt: timestamp("allocated_at", { withTimezone: true }).notNull().defaultNow(),

    /** Past this date with returned_at still NULL = overdue. The cron job reads this. */
    expectedReturnDate: date("expected_return_date"),

    /** NULL = still held. This single column drives the partial unique index. */
    returnedAt: timestamp("returned_at", { withTimezone: true }),

    returnConditionNotes: text("return_condition_notes"),
  },
  (t) => [
    uniqueIndex("one_active_allocation")
      .on(t.assetId)
      .where(sql`${t.returnedAt} is null`),

    check(
      "allocation_has_a_holder",
      sql`${t.holderUserId} is not null or ${t.holderDepartmentId} is not null`,
    ),

    index("allocations_org_idx").on(t.organizationId),
    index("allocations_asset_idx").on(t.assetId),
    index("allocations_holder_user_idx").on(t.holderUserId),
    // Powers the overdue-returns query on the dashboard.
    index("allocations_expected_return_idx").on(t.expectedReturnDate),
  ],
);

/**
 * The escape hatch from the constraint above: you cannot re-allocate a held
 * asset directly, so you request a transfer instead.
 * Requested → Approved → Re-allocated.
 */
export const transferRequests = pgTable(
  "transfer_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),

    fromUserId: uuid("from_user_id").references(() => users.id, { onDelete: "set null" }),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    reason: text("reason"),
    status: transferStatus("status").notNull().default("requested"),

    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("transfer_requests_org_idx").on(t.organizationId),
    index("transfer_requests_asset_idx").on(t.assetId),
    // Powers the "Pending Transfers" KPI card.
    index("transfer_requests_status_idx").on(t.status),
  ],
);

export const allocationsRelations = relations(allocations, ({ one }) => ({
  asset: one(assets, { fields: [allocations.assetId], references: [assets.id] }),
  holderUser: one(users, { fields: [allocations.holderUserId], references: [users.id] }),
  holderDepartment: one(departments, {
    fields: [allocations.holderDepartmentId],
    references: [departments.id],
  }),
}));

export const transferRequestsRelations = relations(transferRequests, ({ one }) => ({
  asset: one(assets, { fields: [transferRequests.assetId], references: [assets.id] }),
  fromUser: one(users, { fields: [transferRequests.fromUserId], references: [users.id] }),
  toUser: one(users, { fields: [transferRequests.toUserId], references: [users.id] }),
}));
