/**
 * The two rules the spec cares most about, tested against a REAL PostgreSQL —
 * not a mock. That is the whole point: these guarantees live in the database, so
 * a test that stubbed the database would prove nothing.
 *
 *   bun test
 *
 * Requires a migrated + seeded DB:  bun run db:reset
 *
 * Every test runs inside a transaction that is always rolled back, so the suite
 * never mutates the seed data and can be run repeatedly.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { closeDatabase, db } from "../../config/db";
import { PG, pgErrorOf, type PgError } from "../../utils/pg-error";
import { allocations, assets, bookings, users } from "../schema";

const { UNIQUE_VIOLATION, EXCLUSION_VIOLATION, CHECK_VIOLATION, DATA_EXCEPTION } = PG;

class Rollback extends Error {}

/**
 * Runs `fn` in a transaction and always rolls back, so the suite never mutates
 * the seed data. Returns the underlying PostgreSQL error (or null if the write
 * succeeded), unwrapped via the same helper the HTTP error handler uses — so
 * these tests exercise the real production code path, not a parallel one.
 */
async function attempt(fn: (tx: typeof db) => Promise<unknown>): Promise<PgError | null> {
  let caught: unknown = null;

  try {
    await db.transaction(async (tx) => {
      try {
        await fn(tx as unknown as typeof db);
      } catch (error) {
        caught = error;
      }
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  return caught ? pgErrorOf(caught) : null;
}

const findAsset = async (tag: string) => {
  const [row] = await db.select().from(assets).where(eq(assets.assetTag, tag));
  if (!row) throw new Error(`Seed data missing: asset ${tag}. Run: bun run db:reset`);
  return row;
};

const findUser = async (email: string) => {
  const [row] = await db.select().from(users).where(eq(users.email, email));
  if (!row) throw new Error(`Seed data missing: user ${email}. Run: bun run db:reset`);
  return row;
};

afterAll(async () => {
  await closeDatabase();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("one_active_allocation — an asset cannot be held by two people", () => {
  // Spec: "Priya has Laptop AF-0114. If Raj tries to allocate it, the system
  // blocks it, shows 'currently held by Priya', and offers a Transfer Request."

  test("rejects a second active allocation of AF-0114", async () => {
    const laptop = await findAsset("AF-0114"); // already held by Priya (seed)
    const raj = await findUser("raj@acme.test");

    const error = await attempt((tx) =>
      tx.insert(allocations).values({
        organizationId: laptop.organizationId,
        assetId: laptop.id,
        holderUserId: raj.id,
      }),
    );

    expect(error).not.toBeNull();
    expect(error!.code).toBe(UNIQUE_VIOLATION);
    expect(error!.constraint).toBe("one_active_allocation");
  });

  test("allows re-allocation once the asset is returned", async () => {
    // The index is PARTIAL (WHERE returned_at IS NULL), so closing the open
    // allocation must free the asset — while keeping the history row.
    const laptop = await findAsset("AF-0114");
    const raj = await findUser("raj@acme.test");

    const error = await attempt(async (tx) => {
      await tx
        .update(allocations)
        .set({ returnedAt: new Date(), returnConditionNotes: "Returned, good condition." })
        .where(eq(allocations.assetId, laptop.id));

      await tx.insert(allocations).values({
        organizationId: laptop.organizationId,
        assetId: laptop.id,
        holderUserId: raj.id,
      });
    });

    expect(error).toBeNull();
  });

  test("requires a holder — an allocation to nobody is rejected", async () => {
    const chair = await findAsset("AF-0202");

    const error = await attempt((tx) =>
      tx.insert(allocations).values({
        organizationId: chair.organizationId,
        assetId: chair.id,
        // neither holderUserId nor holderDepartmentId
      }),
    );

    expect(error).not.toBeNull();
    expect(error!.code).toBe(CHECK_VIOLATION);
    expect(error!.constraint).toBe("allocation_has_a_holder");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("no_overlap — two bookings of one resource cannot overlap", () => {
  // Spec: "Room B2 booked 9:00–10:00 → request for 9:30–10:30 rejected (overlaps);
  // request for 10:00–11:00 is fine (starts right after)."
  //
  // These tests build their OWN 09:00–10:00 booking at a fixed absolute instant
  // rather than leaning on the seeded one. That is deliberate: `bun test` runs
  // with TZ=UTC while `bun run` uses the machine's local zone, so a test written
  // against a wall-clock hour would silently compare 09:30 UTC against a row
  // seeded at 09:30 IST and pass or fail depending on where you live. Fixed
  // UTC instants make the assertion mean the same thing everywhere.
  //
  // The date is far in the future so it can never collide with seeded rows.
  const DAY = "2030-03-15";
  const utc = (time: string) => new Date(`${DAY}T${time}:00.000Z`);

  const NINE_TO_TEN = { from: utc("09:00"), to: utc("10:00") };

  /** Books `from`–`to` on `room`, with the 09:00–10:00 booking already in place. */
  const bookAgainstExisting = (room: { id: string; organizationId: string }, userId: string, from: Date, to: Date) =>
    attempt(async (tx) => {
      await tx.insert(bookings).values({
        organizationId: room.organizationId,
        resourceId: room.id,
        bookedBy: userId,
        startsAt: NINE_TO_TEN.from,
        endsAt: NINE_TO_TEN.to,
        purpose: "Procurement Team sync",
      });

      await tx.insert(bookings).values({
        organizationId: room.organizationId,
        resourceId: room.id,
        bookedBy: userId,
        startsAt: from,
        endsAt: to,
      });
    });

  test("rejects 09:30–10:30 against an existing 09:00–10:00", async () => {
    const room = await findAsset("AF-0500"); // Room B2
    const raj = await findUser("raj@acme.test");

    const error = await bookAgainstExisting(room, raj.id, utc("09:30"), utc("10:30"));

    expect(error).not.toBeNull();
    expect(error!.code).toBe(EXCLUSION_VIOLATION);
    expect(error!.constraint).toBe("no_overlap");
  });

  test("accepts 10:00–11:00 — touching endpoints do not overlap", async () => {
    // This is what the half-open '[)' range buys us. With a closed '[]' range,
    // 10:00 would collide with the 10:00 end of the existing booking and this
    // perfectly legal back-to-back booking would be refused.
    const room = await findAsset("AF-0500");
    const raj = await findUser("raj@acme.test");

    const error = await bookAgainstExisting(room, raj.id, utc("10:00"), utc("11:00"));

    expect(error).toBeNull();
  });

  test("rejects a booking that fully contains the existing one", async () => {
    const room = await findAsset("AF-0500");
    const raj = await findUser("raj@acme.test");

    const error = await bookAgainstExisting(room, raj.id, utc("08:00"), utc("12:00"));

    expect(error).not.toBeNull();
    expect(error!.code).toBe(EXCLUSION_VIOLATION);
  });

  test("rejects a booking strictly inside the existing one", async () => {
    const room = await findAsset("AF-0500");
    const raj = await findUser("raj@acme.test");

    const error = await bookAgainstExisting(room, raj.id, utc("09:15"), utc("09:45"));

    expect(error).not.toBeNull();
    expect(error!.code).toBe(EXCLUSION_VIOLATION);
  });

  test("allows the identical slot on a DIFFERENT resource", async () => {
    // The constraint is scoped by resource_id (WITH =), so what Room B2 is doing
    // has no bearing on Room A1.
    const roomB2 = await findAsset("AF-0500");
    const roomA1 = await findAsset("AF-0501");
    const raj = await findUser("raj@acme.test");

    const error = await attempt(async (tx) => {
      for (const room of [roomB2, roomA1]) {
        await tx.insert(bookings).values({
          organizationId: room.organizationId,
          resourceId: room.id,
          bookedBy: raj.id,
          startsAt: NINE_TO_TEN.from,
          endsAt: NINE_TO_TEN.to,
        });
      }
    });

    expect(error).toBeNull();
  });

  test("cancelling frees the slot without deleting the row", async () => {
    // The constraint's WHERE (status <> 'cancelled') predicate means a cancelled
    // booking stops reserving its time the instant it is cancelled — yet the row
    // survives as history.
    const room = await findAsset("AF-0500");
    const raj = await findUser("raj@acme.test");

    const error = await attempt(async (tx) => {
      const [original] = await tx
        .insert(bookings)
        .values({
          organizationId: room.organizationId,
          resourceId: room.id,
          bookedBy: raj.id,
          startsAt: NINE_TO_TEN.from,
          endsAt: NINE_TO_TEN.to,
        })
        .returning();

      await tx
        .update(bookings)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(bookings.id, original!.id));

      // The exact slot that was refused above is now free.
      await tx.insert(bookings).values({
        organizationId: room.organizationId,
        resourceId: room.id,
        bookedBy: raj.id,
        startsAt: utc("09:30"),
        endsAt: utc("10:30"),
      });
    });

    expect(error).toBeNull();
  });

  test("rejects a zero-length booking", async () => {
    const room = await findAsset("AF-0501");
    const raj = await findUser("raj@acme.test");

    const error = await attempt((tx) =>
      tx.insert(bookings).values({
        organizationId: room.organizationId,
        resourceId: room.id,
        bookedBy: raj.id,
        startsAt: utc("15:00"),
        endsAt: utc("15:00"),
      }),
    );

    expect(error).not.toBeNull();
    expect(error!.code).toBe(CHECK_VIOLATION);
    expect(error!.constraint).toBe("booking_ends_after_it_starts");
  });

  test("rejects a booking that ends before it starts", async () => {
    // Note the SQLSTATE: 22000 (data_exception), not the 23514 you might expect.
    // The generated `during` column is computed BEFORE the CHECK constraint runs,
    // and tstzrange('15:00','14:00') is itself an invalid range, so PostgreSQL
    // rejects it a step earlier. Still refused by the database — just not by the
    // constraint we would have guessed.
    const room = await findAsset("AF-0501");
    const raj = await findUser("raj@acme.test");

    const error = await attempt((tx) =>
      tx.insert(bookings).values({
        organizationId: room.organizationId,
        resourceId: room.id,
        bookedBy: raj.id,
        startsAt: utc("15:00"),
        endsAt: utc("14:00"),
      }),
    );

    expect(error).not.toBeNull();
    expect(error!.code).toBe(DATA_EXCEPTION);
  });
});
