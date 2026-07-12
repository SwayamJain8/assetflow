import { z } from "@hono/zod-openapi";

export const AuditItemStatusSchema = z.enum(["pending", "verified", "missing", "damaged"]);

export const CreateAuditCycleSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "Give the cycle a name.")
      .max(120)
      .openapi({ example: "Q3 Audit — Engineering" }),

    // Scope. Either, both, or neither (neither = the whole organization).
    scopeDepartmentId: z.string().uuid("Select a valid department.").nullish(),
    scopeLocation: z.string().trim().max(160).nullish().openapi({ example: "HQ Floor 2" }),

    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD."),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD."),

    /** The spec says "one or more auditors" — hence an array, and a real M2M table. */
    auditorIds: z
      .array(z.string().uuid())
      .min(1, "Assign at least one auditor.")
      .max(10, "That is a lot of auditors."),
  })
  .refine((input) => new Date(input.endDate) >= new Date(input.startDate), {
    message: "The cycle must end on or after it starts.",
    path: ["endDate"],
  })
  .openapi("CreateAuditCycle");

export const MarkAuditItemSchema = z
  .object({
    status: z.enum(["verified", "missing", "damaged"], {
      message: "Mark the asset Verified, Missing, or Damaged.",
    }),
    notes: z.string().trim().max(500).nullish(),
  })
  .openapi("MarkAuditItem");

export const AuditCycleSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    scopeDepartmentId: z.string().uuid().nullable(),
    scopeDepartmentName: z.string().nullable(),
    scopeLocation: z.string().nullable(),
    startDate: z.string(),
    endDate: z.string(),
    status: z.enum(["open", "closed"]),
    auditors: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
    totalItems: z.number(),
    checkedItems: z.number(),
    discrepancies: z.number(),
    createdAt: z.string(),
    closedAt: z.string().nullable(),
  })
  .openapi("AuditCycle");

export const AuditItemSchema = z
  .object({
    id: z.string().uuid(),
    assetId: z.string().uuid(),
    assetTag: z.string(),
    assetName: z.string(),
    expectedLocation: z.string().nullable(),
    status: AuditItemStatusSchema,
    notes: z.string().nullable(),
    checkedByName: z.string().nullable(),
    checkedAt: z.string().nullable(),
  })
  .openapi("AuditItem");

export const IdParam = z.object({ id: z.string().uuid("Not a valid id.") });
export const ItemParams = z.object({
  id: z.string().uuid("Not a valid id."),
  itemId: z.string().uuid("Not a valid id."),
});

export type CreateAuditCycleInput = z.infer<typeof CreateAuditCycleSchema>;
export type MarkAuditItemInput = z.infer<typeof MarkAuditItemSchema>;
