/**
 * Barrel for every Drizzle table definition.
 *
 * The schema is the centrepiece of this project (see CLAUDE.md §5). Each domain
 * gets its own file here and is re-exported below so that both `drizzle-kit`
 * (for migrations) and the query builder see one complete schema.
 *
 * Planned tables — see docs/database-schema.md:
 *   organizations, departments, asset_categories, users, assets, allocations,
 *   transfer_requests, resources, bookings, maintenance_requests,
 *   audit_cycles, audit_items, notifications, activity_logs
 */

export {};
