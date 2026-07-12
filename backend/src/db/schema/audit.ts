import { relations } from "drizzle-orm";
import {
  date,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { assets } from "./assets";
import { departments, organizations, users } from "./org";
import { auditCycleStatus, auditItemStatus } from "./enums";

/**
 * A scheduled verification pass over a slice of the estate ("Q3 audit:
 * Engineering dept, 1–15 Jul"), scoped by department and/or location.
 *
 * Closing the cycle LOCKS it (status → closed) and applies consequences:
 * assets confirmed missing become `lost`. A closed cycle rejects further edits.
 */
export const auditCycles = pgTable(
  "audit_cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),

    // Scope. Either, both, or neither (= the whole org).
    scopeDepartmentId: uuid("scope_department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    scopeLocation: text("scope_location"),

    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),

    status: auditCycleStatus("status").notNull().default("open"),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("audit_cycles_org_idx").on(t.organizationId),
    index("audit_cycles_status_idx").on(t.status),
  ],
);

/**
 * The spec says "assign ONE OR MORE auditors" — so this is a genuine many-to-many
 * join table, not an `auditor_id` column. A composite primary key makes assigning
 * the same auditor twice impossible.
 */
export const auditCycleAuditors = pgTable(
  "audit_cycle_auditors",
  {
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => auditCycles.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.cycleId, t.userId] })],
);

/**
 * One row per asset in the cycle's scope — the auditor's checklist.
 * `missing` and `damaged` are the discrepancies; the report is a query over
 * these, not a stored document, so it can never go stale.
 */
export const auditItems = pgTable(
  "audit_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => auditCycles.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),

    /** Where the system BELIEVES the asset is — compared against reality. */
    expectedLocation: text("expected_location"),

    status: auditItemStatus("status").notNull().default("pending"),
    notes: text("notes"),

    checkedBy: uuid("checked_by").references(() => users.id, { onDelete: "set null" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (t) => [
    // An asset appears at most once per cycle.
    unique("audit_items_cycle_asset_unique").on(t.cycleId, t.assetId),
    index("audit_items_cycle_idx").on(t.cycleId),
    index("audit_items_status_idx").on(t.status),
  ],
);

export const auditCyclesRelations = relations(auditCycles, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [auditCycles.organizationId],
    references: [organizations.id],
  }),
  scopeDepartment: one(departments, {
    fields: [auditCycles.scopeDepartmentId],
    references: [departments.id],
  }),
  auditors: many(auditCycleAuditors),
  items: many(auditItems),
}));

export const auditCycleAuditorsRelations = relations(auditCycleAuditors, ({ one }) => ({
  cycle: one(auditCycles, {
    fields: [auditCycleAuditors.cycleId],
    references: [auditCycles.id],
  }),
  user: one(users, { fields: [auditCycleAuditors.userId], references: [users.id] }),
}));

export const auditItemsRelations = relations(auditItems, ({ one }) => ({
  cycle: one(auditCycles, { fields: [auditItems.cycleId], references: [auditCycles.id] }),
  asset: one(assets, { fields: [auditItems.assetId], references: [assets.id] }),
}));
