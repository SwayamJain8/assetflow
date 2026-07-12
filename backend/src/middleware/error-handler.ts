import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { isProduction } from "../config/env";
import { PG, pgErrorOf, type PgError } from "../utils/pg-error";

/**
 * Every error leaves the API in one shape, so the frontend only ever parses one
 * thing:
 *
 *   { "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
 */
export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

/** A business-rule failure the caller can act on (409 conflict, 403, etc.). */
export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * The two showpiece constraints (CLAUDE.md §5) are enforced by PostgreSQL, not by
 * application code — so the database is what rejects a double-allocation or an
 * overlapping booking. That rejection arrives here as a driver error, and this is
 * where it becomes a clear message for the user.
 *
 * The database refuses the write; this function explains why.
 */
function fromDatabaseError(error: PgError): AppError | null {
  switch (error.code) {
    // ── The booking exclusion constraint fired ──────────────────────────────
    case PG.EXCLUSION_VIOLATION:
      return new AppError(
        409,
        "BOOKING_OVERLAP",
        "That time slot overlaps an existing booking for this resource. Pick a different slot.",
      );

    case PG.UNIQUE_VIOLATION:
      // ── The partial unique index fired: the asset is already held ─────────
      if (error.constraint === "one_active_allocation") {
        return new AppError(
          409,
          "ASSET_ALREADY_ALLOCATED",
          "This asset is already allocated to someone else. Raise a transfer request instead.",
        );
      }
      if (error.constraint === "users_org_email_unique") {
        return new AppError(409, "EMAIL_TAKEN", "An account with that email already exists.");
      }
      return new AppError(409, "DUPLICATE_VALUE", "That value is already taken.");

    case PG.FOREIGN_KEY_VIOLATION:
      return new AppError(409, "RELATED_RECORD_MISSING", "A referenced record does not exist.");

    // A reversed booking (ends before it starts) trips the generated tstzrange
    // column before any CHECK constraint runs — see PG.DATA_EXCEPTION.
    case PG.DATA_EXCEPTION:
      return new AppError(422, "INVALID_TIME_RANGE", "A booking must end after it starts.");

    case PG.CHECK_VIOLATION:
      if (error.constraint === "booking_ends_after_it_starts") {
        return new AppError(422, "INVALID_TIME_RANGE", "A booking must end after it starts.");
      }
      if (error.constraint === "allocation_has_a_holder") {
        return new AppError(
          422,
          "NO_HOLDER",
          "An allocation must name either an employee or a department.",
        );
      }
      return new AppError(422, "CONSTRAINT_VIOLATION", "That change violates a data rule.");

    default:
      return null;
  }
}

export const onError: ErrorHandler = (error, c: Context) => {
  if (error instanceof AppError) {
    return c.json<ApiErrorBody>(
      { error: { code: error.code, message: error.message, details: error.details } },
      error.status,
    );
  }

  // Validation failures surfaced outside the request-validation hook.
  if (error instanceof ZodError) {
    return c.json<ApiErrorBody>(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "The request contains invalid data.",
          details: error.issues.map((issue) => ({
            field: issue.path.join(".") || "(root)",
            message: issue.message,
          })),
        },
      },
      422,
    );
  }

  // Drizzle wraps driver errors, so the real PostgreSQL error (with its SQLSTATE
  // and constraint name) lives further down the `cause` chain — see utils/pg-error.
  const pgError = pgErrorOf(error);
  if (pgError) {
    const mapped = fromDatabaseError(pgError);
    if (mapped) {
      return c.json<ApiErrorBody>(
        { error: { code: mapped.code, message: mapped.message, details: mapped.details } },
        mapped.status,
      );
    }
  }

  if (error instanceof HTTPException) {
    return c.json<ApiErrorBody>(
      { error: { code: "HTTP_ERROR", message: error.message } },
      error.status,
    );
  }

  // Anything reaching here is a bug: log it in full, but never leak internals.
  console.error("Unhandled error:", error);

  return c.json<ApiErrorBody>(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong on our end. Please try again.",
        details: isProduction ? undefined : { message: (error as Error).message },
      },
    },
    500,
  );
};

export const onNotFound: NotFoundHandler = (c) =>
  c.json<ApiErrorBody>(
    {
      error: {
        code: "NOT_FOUND",
        message: `No route matches ${c.req.method} ${c.req.path}.`,
      },
    },
    404,
  );
