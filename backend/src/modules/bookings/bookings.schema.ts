import { z } from "@hono/zod-openapi";

const isoDateTime = z
  .string()
  .datetime({ offset: true, message: "Use an ISO timestamp, e.g. 2026-07-13T09:00:00Z." });

export const CreateBookingSchema = z
  .object({
    resourceId: z.string().uuid("Select a resource to book."),
    startsAt: isoDateTime.openapi({ example: "2026-07-13T09:00:00Z" }),
    endsAt: isoDateTime.openapi({ example: "2026-07-13T10:00:00Z" }),
    purpose: z.string().trim().max(200, "Keep the purpose under 200 characters.").nullish(),

    /**
     * A Department Head may book on behalf of their department (per the spec).
     * Anyone else booking for someone else is refused in the service.
     */
    bookedForUserId: z.string().uuid().nullish(),
  })
  .refine((input) => new Date(input.endsAt) > new Date(input.startsAt), {
    message: "The booking must end after it starts.",
    path: ["endsAt"],
  })
  .refine(
    (input) =>
      new Date(input.endsAt).getTime() - new Date(input.startsAt).getTime() <= 24 * 3600 * 1000,
    { message: "A single booking cannot exceed 24 hours.", path: ["endsAt"] },
  )
  .openapi("CreateBooking");

export const RescheduleBookingSchema = z
  .object({
    startsAt: isoDateTime,
    endsAt: isoDateTime,
  })
  .refine((input) => new Date(input.endsAt) > new Date(input.startsAt), {
    message: "The booking must end after it starts.",
    path: ["endsAt"],
  })
  .openapi("RescheduleBooking");

export const BookingSchema = z
  .object({
    id: z.string().uuid(),
    resourceId: z.string().uuid(),
    resourceName: z.string(),
    resourceTag: z.string(),
    bookedById: z.string().uuid(),
    bookedByName: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    purpose: z.string().nullable(),
    status: z.enum(["upcoming", "ongoing", "completed", "cancelled"]),
    isMine: z.boolean(),
  })
  .openapi("Booking");

export const ListBookingsQuery = z.object({
  resourceId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  status: z.enum(["upcoming", "ongoing", "completed", "cancelled"]).optional(),
  mine: z.enum(["true"]).optional(),
});

export const IdParam = z.object({ id: z.string().uuid("Not a valid id.") });

export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;
export type RescheduleBookingInput = z.infer<typeof RescheduleBookingSchema>;
export type ListBookingsInput = z.infer<typeof ListBookingsQuery>;
