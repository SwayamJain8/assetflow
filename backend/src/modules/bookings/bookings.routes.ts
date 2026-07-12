import { createRoute, z } from "@hono/zod-openapi";

import { createRouter, json } from "../../lib/router";
import { requireAuth } from "../../middleware/auth";
import { ctxFrom } from "../../types";
import {
  BookingSchema,
  CreateBookingSchema,
  IdParam,
  ListBookingsQuery,
  RescheduleBookingSchema,
} from "./bookings.schema";
import {
  cancelBooking,
  createBooking,
  listBookings,
  rescheduleBooking,
} from "./bookings.service";

export const bookingsRouter = createRouter();

// Booking a shared resource is open to every role — that is the point of a
// shared resource. Ownership rules (you may only cancel your own) live in the
// service, since they depend on the row, not the route.
bookingsRouter.use("/bookings", requireAuth);
bookingsRouter.use("/bookings/*", requireAuth);

bookingsRouter.openapi(
  createRoute({
    method: "get",
    path: "/bookings",
    tags: ["Booking"],
    summary: "Bookings for the calendar grid",
    description:
      "`from`/`to` select every booking that OVERLAPS the window, not merely those " +
      "starting inside it — an 08:00–17:00 van booking must still appear on a " +
      "09:00–10:00 grid. Status is derived from the clock in SQL, so nothing sits " +
      "stale on `upcoming` an hour after it ended.",
    security: [{ Bearer: [] }],
    request: { query: ListBookingsQuery },
    responses: { 200: { description: "Bookings.", ...json(z.array(BookingSchema)) } },
  }),
  async (c) => c.json(await listBookings(ctxFrom(c.get("user")), c.req.valid("query")), 200),
);

bookingsRouter.openapi(
  createRoute({
    method: "post",
    path: "/bookings",
    tags: ["Booking"],
    summary: "Book a resource — overlapping slots are refused by the database",
    description:
      "★ The overlap rule. No 'is this slot free?' query runs before the insert — " +
      "two people clicking the same slot at once would both be told yes. The insert " +
      "is attempted and PostgreSQL's EXCLUDE constraint (no_overlap, a GiST index " +
      "over a generated tstzrange) refuses it. The half-open '[)' range means " +
      "09:00–10:00 blocks 09:30–10:30 but permits 10:00–11:00. On refusal the 409 " +
      "carries the clashing bookings in `details.conflicts` so the grid can flash " +
      "them red.",
    security: [{ Bearer: [] }],
    request: { body: json(CreateBookingSchema) },
    responses: {
      201: { description: "Booked." },
      403: { description: "Only a Department Head may book for someone else." },
      409: { description: "BOOKING_OVERLAP — `details.conflicts` lists the clashes." },
      422: { description: "Validation failed, or the resource is not bookable." },
    },
  }),
  async (c) => c.json(await createBooking(ctxFrom(c.get("user")), c.req.valid("json")), 201),
);

bookingsRouter.openapi(
  createRoute({
    method: "patch",
    path: "/bookings/{id}",
    tags: ["Booking"],
    summary: "Reschedule a booking",
    description:
      "The exclusion constraint applies to UPDATEs too — a booking cannot be moved " +
      "on top of another one.",
    security: [{ Bearer: [] }],
    request: { params: IdParam, body: json(RescheduleBookingSchema) },
    responses: {
      200: { description: "Rescheduled." },
      403: { description: "Not your booking." },
      409: { description: "The new slot overlaps another booking." },
    },
  }),
  async (c) =>
    c.json(
      await rescheduleBooking(ctxFrom(c.get("user")), c.req.valid("param").id, c.req.valid("json")),
      200,
    ),
);

bookingsRouter.openapi(
  createRoute({
    method: "post",
    path: "/bookings/{id}/cancel",
    tags: ["Booking"],
    summary: "Cancel a booking — frees the slot without deleting the row",
    description:
      "The constraint's `WHERE (status <> 'cancelled')` predicate means the slot is " +
      "released the instant the status flips, while the booking survives in history.",
    security: [{ Bearer: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: "Cancelled; the slot is free." },
      403: { description: "Not your booking." },
      409: { description: "Already cancelled." },
    },
  }),
  async (c) => c.json(await cancelBooking(ctxFrom(c.get("user")), c.req.valid("param").id), 200),
);
