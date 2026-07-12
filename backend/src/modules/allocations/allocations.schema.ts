import { z } from "@hono/zod-openapi";

export const CreateAllocationSchema = z
  .object({
    assetId: z.string().uuid("Select a valid asset."),

    // An asset goes to a person OR a department. The DB enforces that at least
    // one is present (CHECK allocation_has_a_holder).
    holderUserId: z.string().uuid("Select a valid employee.").nullish(),
    holderDepartmentId: z.string().uuid("Select a valid department.").nullish(),

    expectedReturnDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD.")
      .nullish()
      .openapi({ description: "Past this date with no return, the asset is flagged overdue." }),
  })
  .refine((input) => input.holderUserId || input.holderDepartmentId, {
    message: "Choose an employee or a department to allocate to.",
    path: ["holderUserId"],
  })
  .openapi("CreateAllocation");

export const ReturnAllocationSchema = z
  .object({
    returnConditionNotes: z
      .string()
      .trim()
      .max(500, "Keep the condition notes under 500 characters.")
      .nullish()
      .openapi({ example: "Returned in good condition. Minor scuff on the lid." }),
    condition: z.enum(["new", "good", "fair", "poor", "damaged"]).optional(),
  })
  .openapi("ReturnAllocation");

export const CreateTransferSchema = z
  .object({
    assetId: z.string().uuid("Select a valid asset."),
    toUserId: z.string().uuid("Select who the asset should go to."),
    reason: z
      .string()
      .trim()
      .min(5, "Give a brief reason for the transfer.")
      .max(500)
      .openapi({ example: "Arjun is moving teams and no longer needs this machine." }),
  })
  .openapi("CreateTransfer");

export const AllocationSchema = z
  .object({
    id: z.string().uuid(),
    assetId: z.string().uuid(),
    assetTag: z.string(),
    assetName: z.string(),
    holderName: z.string().nullable(),
    holderDepartmentName: z.string().nullable(),
    allocatedByName: z.string().nullable(),
    allocatedAt: z.string(),
    expectedReturnDate: z.string().nullable(),
    returnedAt: z.string().nullable(),
    returnConditionNotes: z.string().nullable(),
    isOverdue: z.boolean(),
  })
  .openapi("Allocation");

export const TransferSchema = z
  .object({
    id: z.string().uuid(),
    assetId: z.string().uuid(),
    assetTag: z.string(),
    assetName: z.string(),
    fromName: z.string().nullable(),
    toName: z.string().nullable(),
    reason: z.string().nullable(),
    status: z.enum(["requested", "approved", "rejected", "reallocated"]),
    requestedByName: z.string().nullable(),
    createdAt: z.string(),
    resolvedAt: z.string().nullable(),
  })
  .openapi("Transfer");

export const ListAllocationsQuery = z.object({
  assetId: z.string().uuid().optional(),
  holderUserId: z.string().uuid().optional(),
  active: z.enum(["true", "false"]).optional().openapi({ description: "Only open allocations." }),
  overdue: z.enum(["true"]).optional().openapi({ description: "Only overdue allocations." }),
});

export const ListTransfersQuery = z.object({
  status: z.enum(["requested", "approved", "rejected", "reallocated"]).optional(),
  assetId: z.string().uuid().optional(),
});

export const IdParam = z.object({ id: z.string().uuid("Not a valid id.") });

export type CreateAllocationInput = z.infer<typeof CreateAllocationSchema>;
export type ReturnAllocationInput = z.infer<typeof ReturnAllocationSchema>;
export type CreateTransferInput = z.infer<typeof CreateTransferSchema>;
export type ListAllocationsInput = z.infer<typeof ListAllocationsQuery>;
export type ListTransfersInput = z.infer<typeof ListTransfersQuery>;
