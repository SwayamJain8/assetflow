import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Native PostgreSQL ENUM types rather than free-text columns with CHECK
 * constraints. The database itself rejects an unknown status, so an invalid
 * state cannot exist in the data — not even via a stray psql session.
 */

/** Signup only ever creates `employee`. Every other role is granted by an Admin. */
export const userRole = pgEnum("user_role", [
  "admin",
  "asset_manager",
  "department_head",
  "employee",
]);

export const entityStatus = pgEnum("entity_status", ["active", "inactive"]);

/** The 7-state asset lifecycle from the spec. */
export const assetStatus = pgEnum("asset_status", [
  "available",
  "allocated",
  "reserved",
  "under_maintenance",
  "lost",
  "retired",
  "disposed",
]);

export const assetCondition = pgEnum("asset_condition", [
  "new",
  "good",
  "fair",
  "poor",
  "damaged",
]);

/** Requested → Approved → Re-allocated. `rejected` is our addition; the spec omits it. */
export const transferStatus = pgEnum("transfer_status", [
  "requested",
  "approved",
  "rejected",
  "reallocated",
]);

export const bookingStatus = pgEnum("booking_status", [
  "upcoming",
  "ongoing",
  "completed",
  "cancelled",
]);

/** Pending → Approved/Rejected → Technician Assigned → In Progress → Resolved. */
export const maintenanceStatus = pgEnum("maintenance_status", [
  "pending",
  "approved",
  "rejected",
  "technician_assigned",
  "in_progress",
  "resolved",
]);

export const priority = pgEnum("priority", ["low", "medium", "high", "critical"]);

export const auditCycleStatus = pgEnum("audit_cycle_status", ["open", "closed"]);

/** `pending` = the auditor has not looked at this asset yet. */
export const auditItemStatus = pgEnum("audit_item_status", [
  "pending",
  "verified",
  "missing",
  "damaged",
]);

/** The 6 notification events named in the spec, expanded to one value each. */
export const notificationType = pgEnum("notification_type", [
  "asset_assigned",
  "maintenance_approved",
  "maintenance_rejected",
  "booking_confirmed",
  "booking_cancelled",
  "booking_reminder",
  "transfer_approved",
  "overdue_return",
  "audit_discrepancy",
]);
