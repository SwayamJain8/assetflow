import { relations, sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { assets } from "./assets";
import { organizations, users } from "./org";
import { bookingStatus } from "./enums";

/**
 * SHOWPIECE #2 — two bookings for the same resource can never overlap, enforced
 * by a PostgreSQL EXCLUSION CONSTRAINT (btree_gist), not by application code.
 *
 * The app writes only `starts_at` and `ends_at`. The migration adds a THIRD,
 * generated column that the app never touches:
 *
 *   during tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED
 *
 *   ALTER TABLE bookings ADD CONSTRAINT no_overlap
 *     EXCLUDE USING gist (resource_id WITH =, during WITH &&)
 *     WHERE (status <> 'cancelled');
 *
 * `'[)'` is a HALF-OPEN interval — start inclusive, end exclusive. That single
 * character pair is what makes the spec's example behave correctly:
 *
 *   Room B2 booked 09:00–10:00
 *     → 09:30–10:30  REJECTED  (ranges overlap)
 *     → 10:00–11:00  ACCEPTED  (touching endpoints do NOT overlap)
 *
 * The `WHERE (status <> 'cancelled')` predicate means cancelling a booking frees
 * its slot immediately, without deleting the row — the history survives.
 *
 * `during` is intentionally NOT declared here. Drizzle has no tstzrange type, and
 * a generated column must never be written by the client anyway. Because Drizzle
 * only ever selects the columns it knows about, its absence is invisible.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /** A bookable asset (is_bookable = true) — e.g. Room B2. */
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),

    bookedBy: uuid("booked_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),

    purpose: text("purpose"),
    status: bookingStatus("status").notNull().default("upcoming"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    // A zero-length or reversed booking is meaningless — reject it at the DB.
    check("booking_ends_after_it_starts", sql`${t.endsAt} > ${t.startsAt}`),

    index("bookings_org_idx").on(t.organizationId),
    index("bookings_resource_idx").on(t.resourceId),
    index("bookings_starts_at_idx").on(t.startsAt),
    index("bookings_status_idx").on(t.status),
  ],
);

export const bookingsRelations = relations(bookings, ({ one }) => ({
  resource: one(assets, { fields: [bookings.resourceId], references: [assets.id] }),
  bookedByUser: one(users, { fields: [bookings.bookedBy], references: [users.id] }),
}));
