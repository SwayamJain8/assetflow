import { createRoute, z } from "@hono/zod-openapi";

import { JOBS, type JobName } from "../../jobs";
import { createRouter } from "../../lib/router";
import { requireAuth, requireRole } from "../../middleware/auth";
import { AppError } from "../../middleware/error-handler";

export const jobsRouter = createRouter();

jobsRouter.use("/jobs/*", requireAuth);
jobsRouter.use("/jobs/*", requireRole("admin"));

/**
 * Run a scheduled job on demand.
 *
 * This exists for one honest reason: an overdue-return job that fires every six
 * hours is impossible to show anyone. A judge (or you) can hit this and watch the
 * notification appear in the bell immediately, over the WebSocket.
 *
 * It is Admin-only and the jobs are idempotent, so triggering one by hand cannot
 * produce duplicate notifications — it does exactly what the scheduler does.
 */
jobsRouter.openapi(
  createRoute({
    method: "post",
    path: "/jobs/{name}/run",
    tags: ["System"],
    summary: "Run a scheduled job now (Admin only) — makes cron demoable",
    security: [{ Bearer: [] }],
    request: {
      params: z.object({
        name: z.enum([
          "overdue-returns",
          "booking-reminders",
          "assets-needing-attention",
          "overdue-audits",
        ]),
      }),
    },
    responses: {
      200: { description: "The job ran; the response says what it did." },
      403: { description: "Admin only." },
    },
  }),
  async (c) => {
    const name = c.req.valid("param").name as JobName;
    const job = JOBS[name];

    if (!job) throw new AppError(404, "NO_SUCH_JOB", `There is no job called "${name}".`);

    return c.json(await job(), 200);
  },
);
