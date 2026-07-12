import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { assets } from "./assets";
import { organizations, users } from "./org";
import { maintenanceStatus, priority } from "./enums";

/**
 * The approval workflow the Kanban board renders:
 *
 *   Pending → Approved → Technician Assigned → In Progress → Resolved
 *           ↘ Rejected
 *
 * Business rules the service enforces on transition (spec: "route repairs through
 * approval BEFORE work starts"):
 *   - approving  flips the asset to `under_maintenance`
 *   - resolving  flips it back to `available`
 *
 * `technician_id` points at a user. Note the spec lists "Technician Assigned" as a
 * workflow STATE but never as a role — so any user can be named as the technician.
 */
export const maintenanceRequests = pgTable(
  "maintenance_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),

    reportedBy: uuid("reported_by").references(() => users.id, { onDelete: "set null" }),
    issueDescription: text("issue_description").notNull(),
    priority: priority("priority").notNull().default("medium"),
    photoPath: text("photo_path"),

    status: maintenanceStatus("status").notNull().default("pending"),

    technicianId: uuid("technician_id").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    rejectionReason: text("rejection_reason"),
    resolutionNotes: text("resolution_notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("maintenance_org_idx").on(t.organizationId),
    index("maintenance_asset_idx").on(t.assetId),
    // The Kanban board groups by status; the dashboard counts by it.
    index("maintenance_status_idx").on(t.status),
  ],
);

export const maintenanceRequestsRelations = relations(maintenanceRequests, ({ one }) => ({
  asset: one(assets, { fields: [maintenanceRequests.assetId], references: [assets.id] }),
  reporter: one(users, {
    fields: [maintenanceRequests.reportedBy],
    references: [users.id],
  }),
  technician: one(users, {
    fields: [maintenanceRequests.technicianId],
    references: [users.id],
  }),
}));
