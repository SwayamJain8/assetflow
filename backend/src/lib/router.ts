import { OpenAPIHono } from "@hono/zod-openapi";

import type { ApiErrorBody } from "../middleware/error-handler";
import type { AppEnv } from "../types";

/**
 * Every module's router MUST be created with this factory — never with
 * `new OpenAPIHono()` directly.
 *
 * Why: `defaultHook` is what turns a Zod failure into our 422 envelope, and it is
 * NOT inherited from the parent app. A router built by hand would fall back to
 * Hono's stock behaviour and answer a bad email with a raw ZodError dump under a
 * 400 — exactly the "clear validation message" the spec asks us to get right.
 * Centralising it here means a new module cannot get this wrong by omission.
 */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    /**
     * Runs whenever a request fails its Zod schema, so invalid input produces the
     * same error shape as everything else — and names the offending field, which
     * is what lets the frontend render the message under the right input:
     *
     *   422 {
     *     "error": {
     *       "code": "VALIDATION_ERROR",
     *       "message": "The request contains invalid data.",
     *       "details": [
     *         { "field": "email", "message": "That doesn't look like a valid email address." }
     *       ]
     *     }
     *   }
     */
    defaultHook: (result, c) => {
      if (result.success) return;

      return c.json<ApiErrorBody>(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "The request contains invalid data.",
            details: result.error.issues.map((issue) => ({
              field: issue.path.join(".") || "(root)",
              message: issue.message,
            })),
          },
        },
        422,
      );
    },
  });
}
