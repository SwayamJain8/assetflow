import { createRoute, z } from "@hono/zod-openapi";

import { createRouter, json } from "../../lib/router";
import { requireAuth } from "../../middleware/auth";
import { ctxFrom } from "../../types";
import {
  listActivity,
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from "./notifications.service";

const IdParam = z.object({ id: z.string().uuid("Not a valid id.") });

const ListQuery = z.object({
  // The mockup's filter tabs.
  tab: z.enum(["all", "alerts", "approvals", "bookings"]).default("all"),
  unread: z.enum(["true"]).optional(),
});

const NotificationSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string(),
    title: z.string(),
    body: z.string().nullable(),
    link: z.string().nullable(),
    isRead: z.boolean(),
    readAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("Notification");

export const notificationsRouter = createRouter();

notificationsRouter.use("/notifications", requireAuth);
notificationsRouter.use("/notifications/*", requireAuth);
notificationsRouter.use("/activity", requireAuth);

notificationsRouter.openapi(
  createRoute({
    method: "get",
    path: "/notifications",
    tags: ["Notifications"],
    summary: "Your notification feed (tabs: All / Alerts / Approvals / Bookings)",
    security: [{ Bearer: [] }],
    request: { query: ListQuery },
    responses: { 200: { description: "Feed.", ...json(z.array(NotificationSchema)) } },
  }),
  async (c) => {
    const { tab, unread } = c.req.valid("query");
    return c.json(
      await listNotifications(ctxFrom(c.get("user")), tab, unread === "true"),
      200,
    );
  },
);

notificationsRouter.openapi(
  createRoute({
    method: "get",
    path: "/notifications/unread-count",
    tags: ["Notifications"],
    summary: "The bell's badge count",
    security: [{ Bearer: [] }],
    responses: { 200: { description: "Unread count." } },
  }),
  async (c) => c.json(await unreadCount(ctxFrom(c.get("user"))), 200),
);

notificationsRouter.openapi(
  createRoute({
    method: "post",
    path: "/notifications/read-all",
    tags: ["Notifications"],
    summary: "Mark every notification read",
    security: [{ Bearer: [] }],
    responses: { 200: { description: "Marked." } },
  }),
  async (c) => c.json(await markAllRead(ctxFrom(c.get("user"))), 200),
);

notificationsRouter.openapi(
  createRoute({
    method: "post",
    path: "/notifications/{id}/read",
    tags: ["Notifications"],
    summary: "Mark one notification read",
    security: [{ Bearer: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: "Marked." },
      404: { description: "No such notification (or it is not yours)." },
    },
  }),
  async (c) => c.json(await markRead(ctxFrom(c.get("user")), c.req.valid("param").id), 200),
);

notificationsRouter.openapi(
  createRoute({
    method: "get",
    path: "/activity",
    tags: ["Notifications"],
    summary: "The org-wide activity log — who did what, when",
    description:
      "Distinct from notifications: a notification is addressed to one person and " +
      "can be dismissed; an activity entry is an immutable record belonging to the " +
      "organization. This same table powers the per-asset lifecycle timeline.",
    security: [{ Bearer: [] }],
    request: {
      query: z.object({
        entityType: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      }),
    },
    responses: { 200: { description: "Activity log." } },
  }),
  async (c) => {
    const { entityType, limit } = c.req.valid("query");
    return c.json(await listActivity(ctxFrom(c.get("user")), entityType, limit), 200);
  },
);
