import { createRoute } from "@hono/zod-openapi";

import { createRouter } from "../../lib/router";
import { requireAuth } from "../../middleware/auth";
import { ctxFrom } from "../../types";
import { getDashboard } from "./dashboard.service";
import { getReports } from "../reports/reports.service";

export const dashboardRouter = createRouter();

dashboardRouter.use("/dashboard", requireAuth);
dashboardRouter.use("/reports", requireAuth);

dashboardRouter.openapi(
  createRoute({
    method: "get",
    path: "/dashboard",
    tags: ["Dashboard"],
    summary: "The 6 KPI cards, the overdue banner, and recent activity",
    description:
      "The six counts come from ONE query of scalar subqueries rather than six " +
      "round-trips — this is the first screen every user loads.",
    security: [{ Bearer: [] }],
    responses: { 200: { description: "Dashboard payload." } },
  }),
  async (c) => c.json(await getDashboard(ctxFrom(c.get("user"))), 200),
);

dashboardRouter.openapi(
  createRoute({
    method: "get",
    path: "/reports",
    tags: ["Dashboard"],
    summary: "Every analytic on the Reports screen",
    description:
      "Utilization by department, maintenance frequency (12 months + by category), " +
      "most-used vs idle assets, assets needing attention, the booking heatmap, and " +
      "the department allocation summary. All computed in SQL — the API returns " +
      "numbers, not rows to be counted in JavaScript.",
    security: [{ Bearer: [] }],
    responses: { 200: { description: "Reports payload." } },
  }),
  async (c) => c.json(await getReports(ctxFrom(c.get("user"))), 200),
);
