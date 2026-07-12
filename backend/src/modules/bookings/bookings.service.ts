import { and, asc, eq, gte, lte, ne, sql } from "drizzle-orm";

import { db } from "../../config/db";
import { assets, bookings, users } from "../../db/schema";
import { AppError } from "../../middleware/error-handler";
import { record } from "../../services/activity";
import { formatDateTime, formatRange, formatTime } from "../../utils/time";
import type { Ctx } from "../../types";
import { PG, pgErrorOf } from "../../utils/pg-error";
import type {
  CreateBookingInput,
  ListBookingsInput,
  RescheduleBookingInput,
} from "./bookings.schema";

/**
 * A booking's status is a function of the clock, so deriving it in SQL means it is
 * always right — no cron lag, no rows stuck on `upcoming` an hour after they ended.
 * The stored `status` column is the source of truth only for `cancelled`, which is
 * the one transition a human actually makes.
 */
const derivedStatus = sql<"upcoming" | "ongoing" | "completed" | "cancelled">`
  case
    when "bookings"."status" = 'cancelled' then 'cancelled'
    when now() >= "bookings"."starts_at" and now() < "bookings"."ends_at" then 'ongoing'
    when now() >= "bookings"."ends_at" then 'completed'
    else 'upcoming'
  end
`;

async function mustFindResource(ctx: Ctx, resourceId: string) {
  const [resource] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, resourceId), eq(assets.organizationId, ctx.orgId)));

  if (!resource) throw new AppError(404, "RESOURCE_NOT_FOUND", "That resource does not exist.");

  if (!resource.isBookable) {
    throw new AppError(
      422,
      "NOT_BOOKABLE",
      `${resource.name} (${resource.assetTag}) is not a bookable resource.`,
    );
  }

  if (resource.status === "under_maintenance") {
    throw new AppError(
      409,
      "RESOURCE_UNAVAILABLE",
      `${resource.name} is under maintenance and cannot be booked.`,
    );
  }

  return resource;
}

/**
 * Finds the booking(s) that collide with a proposed slot — used ONLY to explain a
 * rejection the database has already made, never to decide one.
 *
 * Overlap is `new_start < existing_end AND new_end > existing_start`: the exact
 * half-open semantics of the `'[)'` tstzrange the constraint indexes. Which is
 * why 10:00–11:00 does not collide with 09:00–10:00.
 */
async function findConflicts(resourceId: string, startsAt: Date, endsAt: Date, excludeId?: string) {
  const filters = [
    eq(bookings.resourceId, resourceId),
    ne(bookings.status, "cancelled"),
    sql`${bookings.startsAt} < ${endsAt.toISOString()}`,
    sql`${bookings.endsAt} > ${startsAt.toISOString()}`,
  ];

  if (excludeId) filters.push(ne(bookings.id, excludeId));

  return db
    .select({
      id: bookings.id,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      purpose: bookings.purpose,
      bookedByName: users.name,
    })
    .from(bookings)
    .innerJoin(users, eq(bookings.bookedBy, users.id))
    .where(and(...filters))
    .orderBy(asc(bookings.startsAt));
}

/** Turns the database's refusal into a message and the data the grid needs. */
async function conflictError(
  resource: { name: string; assetTag: string },
  resourceId: string,
  startsAt: Date,
  endsAt: Date,
  excludeId?: string,
): Promise<never> {
  const conflicts = await findConflicts(resourceId, startsAt, endsAt, excludeId);

  const clash = conflicts[0];

  throw new AppError(
    409,
    "BOOKING_OVERLAP",
    clash
      ? `${resource.name} is already booked ${formatRange(clash.startsAt, clash.endsAt)}${
          clash.bookedByName ? ` by ${clash.bookedByName}` : ""
        }. Pick a slot that does not overlap.`
      : `That time slot overlaps an existing booking for ${resource.name}.`,
    {
      // The grid highlights exactly these slots in red.
      conflicts: conflicts.map((c) => ({
        id: c.id,
        startsAt: c.startsAt.toISOString(),
        endsAt: c.endsAt.toISOString(),
        purpose: c.purpose,
        bookedByName: c.bookedByName,
      })),
    },
  );
}

/**
 * ★ GOLDEN SCENARIO #2 ★
 *
 * Spec: "Room B2 booked 9:00–10:00 → request for 9:30–10:30 rejected (overlaps);
 * request for 10:00–11:00 is fine (starts right after)."
 *
 * As with allocation, notice what is NOT here: no query asking "is this slot
 * free?" before inserting. Two people clicking the same slot at the same instant
 * would both be told yes, and both would write.
 *
 * The insert is simply attempted. PostgreSQL's EXCLUDE constraint (no_overlap,
 * over a GiST index on a generated tstzrange) refuses any row whose resource
 * matches and whose time range overlaps an existing one — atomically, so the
 * second of two simultaneous requests loses. We catch that refusal and only then
 * look up what it collided with, to build the message.
 *
 * The `'[)'` half-open range is doing the subtle work: 10:00–11:00 touches
 * 09:00–10:00 at a single instant but does not overlap it, so it is allowed.
 */
export async function createBooking(ctx: Ctx, input: CreateBookingInput) {
  const resource = await mustFindResource(ctx, input.resourceId);

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);

  // Booking on behalf of someone else is a Department Head's privilege (spec:
  // "books shared resources on behalf of the department").
  let bookedBy = ctx.user.id;

  if (input.bookedForUserId && input.bookedForUserId !== ctx.user.id) {
    if (!["admin", "department_head", "asset_manager"].includes(ctx.user.role)) {
      throw new AppError(
        403,
        "CANNOT_BOOK_FOR_OTHERS",
        "Only a Department Head, Asset Manager, or Admin may book on someone else's behalf.",
      );
    }
    bookedBy = input.bookedForUserId;
  }

  try {
    const [created] = await db
      .insert(bookings)
      .values({
        organizationId: ctx.orgId,
        resourceId: input.resourceId,
        bookedBy,
        startsAt,
        endsAt,
        purpose: input.purpose ?? null,
      })
      .returning();

    await record(ctx, {
      entity: "booking",
      entityId: created!.id,
      action: "booking_confirmed",
      summary: `${resource.name} booked ${formatRange(startsAt, endsAt)}${
        input.purpose ? ` — ${input.purpose}` : ""
      }`,
      metadata: { resourceTag: resource.assetTag },
      notify: {
        userId: bookedBy,
        type: "booking_confirmed",
        title: `Booking confirmed: ${resource.name}`,
        body: `${formatDateTime(startsAt)} – ${formatTime(endsAt)}`,
        link: "/booking",
      },
    });

    return created!;
  } catch (error) {
    const pg = pgErrorOf(error);

    // The exclusion constraint fired: this slot collides with an existing booking.
    if (pg?.code === PG.EXCLUSION_VIOLATION && pg.constraint === "no_overlap") {
      await conflictError(resource, input.resourceId, startsAt, endsAt);
    }

    throw error;
  }
}

/**
 * Rescheduling is an UPDATE, and the exclusion constraint applies to updates just
 * as it does to inserts — a row cannot be moved on top of another one either.
 */
export async function rescheduleBooking(ctx: Ctx, id: string, input: RescheduleBookingInput) {
  const existing = await mustFindBooking(ctx, id);

  if (existing.status === "cancelled") {
    throw new AppError(409, "BOOKING_CANCELLED", "A cancelled booking cannot be rescheduled.");
  }

  const resource = await mustFindResource(ctx, existing.resourceId);
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);

  if (existing.bookedBy !== ctx.user.id && ctx.user.role === "employee") {
    throw new AppError(403, "NOT_YOUR_BOOKING", "You can only change your own bookings.");
  }

  try {
    const [updated] = await db
      .update(bookings)
      .set({ startsAt, endsAt })
      .where(and(eq(bookings.id, id), eq(bookings.organizationId, ctx.orgId)))
      .returning();

    await record(ctx, {
      entity: "booking",
      entityId: id,
      action: "booking_rescheduled",
      summary: `${resource.name} booking moved to ${formatRange(startsAt, endsAt)}`,
    });

    return updated!;
  } catch (error) {
    const pg = pgErrorOf(error);

    if (pg?.code === PG.EXCLUSION_VIOLATION && pg.constraint === "no_overlap") {
      // Exclude this booking's own row: it must not be treated as conflicting
      // with itself.
      await conflictError(resource, existing.resourceId, startsAt, endsAt, id);
    }

    throw error;
  }
}

async function mustFindBooking(ctx: Ctx, id: string) {
  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, id), eq(bookings.organizationId, ctx.orgId)));

  if (!booking) throw new AppError(404, "BOOKING_NOT_FOUND", "That booking does not exist.");
  return booking;
}

/**
 * Cancelling sets status = 'cancelled'. It does NOT delete the row.
 *
 * The exclusion constraint carries `WHERE (status <> 'cancelled')`, so the moment
 * the status flips, the slot stops being reserved and someone else can book it —
 * while the cancelled booking survives in the history and the reports.
 */
export async function cancelBooking(ctx: Ctx, id: string) {
  const existing = await mustFindBooking(ctx, id);

  if (existing.status === "cancelled") {
    throw new AppError(409, "ALREADY_CANCELLED", "That booking is already cancelled.");
  }

  if (existing.bookedBy !== ctx.user.id && ctx.user.role === "employee") {
    throw new AppError(403, "NOT_YOUR_BOOKING", "You can only cancel your own bookings.");
  }

  await db
    .update(bookings)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(eq(bookings.id, id));

  const [resource] = await db.select().from(assets).where(eq(assets.id, existing.resourceId));

  await record(ctx, {
    entity: "booking",
    entityId: id,
    action: "booking_cancelled",
    summary: `${resource?.name} booking cancelled — the slot is free again`,
    notify: {
      userId: existing.bookedBy,
      type: "booking_cancelled",
      title: `Booking cancelled: ${resource?.name}`,
      body: "The time slot is available again.",
      link: "/booking",
    },
  });

  return { id, status: "cancelled" as const };
}

/** Feeds the day/week grid on the Resource Booking screen. */
export async function listBookings(ctx: Ctx, query: ListBookingsInput) {
  const filters = [eq(bookings.organizationId, ctx.orgId)];

  if (query.resourceId) filters.push(eq(bookings.resourceId, query.resourceId));
  if (query.mine === "true") filters.push(eq(bookings.bookedBy, ctx.user.id));

  // A booking is in the window if it overlaps it at all — not merely if it starts
  // inside it. A 08:00–17:00 van booking must still appear on a 09:00–10:00 grid.
  if (query.from) filters.push(gte(bookings.endsAt, new Date(query.from)));
  if (query.to) filters.push(lte(bookings.startsAt, new Date(query.to)));

  const rows = await db
    .select({
      id: bookings.id,
      resourceId: bookings.resourceId,
      resourceName: assets.name,
      resourceTag: assets.assetTag,
      bookedById: bookings.bookedBy,
      bookedByName: users.name,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      purpose: bookings.purpose,
      status: derivedStatus,
    })
    .from(bookings)
    .innerJoin(assets, eq(bookings.resourceId, assets.id))
    .innerJoin(users, eq(bookings.bookedBy, users.id))
    .where(and(...filters))
    .orderBy(asc(bookings.startsAt));

  const filtered = query.status ? rows.filter((row) => row.status === query.status) : rows;

  return filtered.map((row) => ({
    ...row,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    isMine: row.bookedById === ctx.user.id,
  }));
}
