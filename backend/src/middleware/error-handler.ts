import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { isProduction } from "../config/env";

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

/** PostgreSQL error codes we translate into friendly messages. */
const PG_UNIQUE_VIOLATION = "23505";
const PG_EXCLUSION_VIOLATION = "23P01";
const PG_FOREIGN_KEY_VIOLATION = "23503";
const PG_CHECK_VIOLATION = "23514";

function isPgError(error: unknown): error is { code: string; constraint?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}

/**
 * The two showpiece constraints (CLAUDE.md §5) are enforced by PostgreSQL, not
 * by application code — so the database is what rejects a double-allocation or
 * an overlapping booking. That rejection arrives here as a driver error, and
 * this is where it becomes a clear message for the user.
 */
function fromDatabaseError(error: { code: string; constraint?: string }): AppError | null {
  switch (error.code) {
    case PG_EXCLUSION_VIOLATION:
      return new AppError(
        409,
        "BOOKING_OVERLAP",
        "That time slot overlaps an existing booking for this resource. Pick a different slot.",
      );

    case PG_UNIQUE_VIOLATION:
      if (error.constraint === "one_active_allocation") {
        return new AppError(
          409,
          "ASSET_ALREADY_ALLOCATED",
          "This asset is already allocated to someone else. Raise a transfer request instead.",
        );
      }
      return new AppError(409, "DUPLICATE_VALUE", "That value is already taken.");

    case PG_FOREIGN_KEY_VIOLATION:
      return new AppError(409, "RELATED_RECORD_MISSING", "A referenced record does not exist.");

    case PG_CHECK_VIOLATION:
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

  if (isPgError(error)) {
    const mapped = fromDatabaseError(error);
    if (mapped) {
      return c.json<ApiErrorBody>(
        { error: { code: mapped.code, message: mapped.message } },
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
