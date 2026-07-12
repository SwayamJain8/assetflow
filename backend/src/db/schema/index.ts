/**
 * The complete AssetFlow schema — 15 tables, 11 native enums.
 *
 * Everything is re-exported here so that drizzle-kit (for migrations) and the
 * query builder both see one whole schema. Full ER diagram and rationale:
 * docs/database-schema.md
 *
 * The two constraints that carry this design are enforced by PostgreSQL itself,
 * not by application code — see the comments in allocation.ts and booking.ts:
 *
 *   one_active_allocation  partial unique index  → an asset cannot be held twice
 *   no_overlap             gist EXCLUDE constraint → bookings cannot overlap
 *
 * Both are impossible to violate even under concurrent writes, which a
 * SELECT-then-INSERT check in the service layer could never guarantee.
 */

export * from "./enums";

// Tenancy + master data
export * from "./org"; // organizations, departments, asset_categories, users

// The estate
export * from "./assets"; // assets (a bookable resource is an asset, not a 2nd table)

// Who holds what
export * from "./allocation"; // allocations, transfer_requests

// Shared resources over time
export * from "./booking"; // bookings

// Workflows
export * from "./maintenance"; // maintenance_requests
export * from "./audit"; // audit_cycles, audit_cycle_auditors, audit_items

// Cross-cutting
export * from "./system"; // notifications, activity_logs
