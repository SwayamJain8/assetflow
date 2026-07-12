/**
 * Drizzle wraps every driver failure in a `DrizzleQueryError` and hangs the real
 * `pg` error off `.cause`. So the SQLSTATE we care about — 23505 for the
 * double-allocation index, 23P01 for the booking exclusion constraint — is never
 * on the error we actually catch.
 *
 * Everything that needs to react to a database rule (the HTTP error handler, the
 * constraint tests) goes through this one unwrapper. Getting it wrong is silent:
 * the code just reads `undefined`, no rule matches, and a precise 409 degrades
 * into a generic 500.
 */
export type PgError = {
  code: string;
  constraint?: string;
  detail?: string;
  table?: string;
};

/**
 * Walks the `cause` chain and returns the first PostgreSQL error found, or null.
 * Depth-limited, since a cause chain can in principle be cyclic.
 */
export function pgErrorOf(error: unknown): PgError | null {
  let current: unknown = error;

  for (let depth = 0; current && depth < 5; depth++) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      typeof (current as { code: unknown }).code === "string"
    ) {
      return current as PgError;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

/** PostgreSQL SQLSTATE codes this application reacts to. */
export const PG = {
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  CHECK_VIOLATION: "23514",
  EXCLUSION_VIOLATION: "23P01",
  NOT_NULL_VIOLATION: "23502",

  /**
   * Raised when a booking's end precedes its start. Surprising, but correct: the
   * generated `during` column is computed BEFORE the CHECK constraint runs, and
   * tstzrange('15:00', '14:00') is an invalid range in its own right — so this
   * fails a step earlier than `booking_ends_after_it_starts` ever gets to see it.
   */
  DATA_EXCEPTION: "22000",
} as const;
