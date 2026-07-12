import { z } from "@hono/zod-openapi";

export const MaintenanceStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "technician_assigned",
  "in_progress",
  "resolved",
]);

export const PrioritySchema = z.enum(["low", "medium", "high", "critical"]);

export const CreateMaintenanceSchema = z
  .object({
    assetId: z.string().uuid("Select the asset that needs attention."),
    issueDescription: z
      .string()
      .trim()
      .min(10, "Describe the issue in at least 10 characters.")
      .max(1000, "Keep the description under 1000 characters.")
      .openapi({ example: "Projector bulb not turning on." }),
    priority: PrioritySchema.default("medium"),
  })
  .openapi("CreateMaintenance");

/**
 * The single endpoint the Kanban board drives. Dragging a card from one column to
 * another sends the target status here; the service decides whether that move is
 * legal and applies the side effects on the asset.
 */
export const TransitionSchema = z
  .object({
    status: MaintenanceStatusSchema,

    /** Required when moving to `technician_assigned`. */
    technicianId: z.string().uuid("Select a technician.").nullish(),

    /** Required when moving to `rejected`. */
    rejectionReason: z.string().trim().max(500).nullish(),

    /** Optional when moving to `resolved`. */
    resolutionNotes: z.string().trim().max(1000).nullish(),

    /** Optional condition update on resolution. */
    condition: z.enum(["new", "good", "fair", "poor", "damaged"]).optional(),
  })
  .openapi("MaintenanceTransition");

export const MaintenanceSchema = z
  .object({
    id: z.string().uuid(),
    assetId: z.string().uuid(),
    assetTag: z.string(),
    assetName: z.string(),
    issueDescription: z.string(),
    priority: PrioritySchema,
    status: MaintenanceStatusSchema,
    photoPath: z.string().nullable(),
    reportedByName: z.string().nullable(),
    technicianId: z.string().uuid().nullable(),
    technicianName: z.string().nullable(),
    approvedByName: z.string().nullable(),
    rejectionReason: z.string().nullable(),
    resolutionNotes: z.string().nullable(),
    createdAt: z.string(),
    approvedAt: z.string().nullable(),
    resolvedAt: z.string().nullable(),
  })
  .openapi("MaintenanceRequest");

export const ListMaintenanceQuery = z.object({
  status: MaintenanceStatusSchema.optional(),
  assetId: z.string().uuid().optional(),
  priority: PrioritySchema.optional(),
  mine: z.enum(["true"]).optional().openapi({ description: "Only requests I raised." }),
});

export const IdParam = z.object({ id: z.string().uuid("Not a valid id.") });

export type CreateMaintenanceInput = z.infer<typeof CreateMaintenanceSchema>;
export type TransitionInput = z.infer<typeof TransitionSchema>;
export type ListMaintenanceInput = z.infer<typeof ListMaintenanceQuery>;
