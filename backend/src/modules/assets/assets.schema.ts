import { z } from "@hono/zod-openapi";

export const AssetStatusSchema = z.enum([
  "available",
  "allocated",
  "reserved",
  "under_maintenance",
  "lost",
  "retired",
  "disposed",
]);

export const ConditionSchema = z.enum(["new", "good", "fair", "poor", "damaged"]);

/**
 * Note what is NOT here: `assetTag`. Tags are minted by a PostgreSQL sequence
 * (AF-0001, AF-0002, …), so a client cannot choose or collide on one. `status` is
 * likewise absent — a new asset always enters as `available`, per the spec, and
 * status thereafter changes only through the workflows that own it (allocation,
 * maintenance, audit), never by direct edit.
 */
export const CreateAssetSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Asset name must be at least 2 characters.")
      .max(160, "Asset name is too long.")
      .openapi({ example: "MacBook Pro 14" }),

    categoryId: z.string().uuid("Select a valid category.").nullish(),
    departmentId: z.string().uuid("Select a valid department.").nullish(),

    serialNumber: z.string().trim().max(120).nullish().openapi({ example: "C02XY1114" }),

    acquisitionDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD.")
      .nullish(),

    acquisitionCost: z
      .number()
      .nonnegative("Cost cannot be negative.")
      .max(999_999_999, "That cost is implausibly large.")
      .nullish()
      .openapi({ description: "For ranking and reports only — AssetFlow does not do accounting." }),

    condition: ConditionSchema.default("good"),
    location: z.string().trim().max(160).nullish().openapi({ example: "Bengaluru" }),

    /** Makes this asset a bookable resource (a room, a van). */
    isBookable: z.boolean().default(false),

    retirementDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD.")
      .nullish(),

    /** Values for the category's custom fields, e.g. { warrantyMonths: 24 }. */
    customValues: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  })
  .openapi("CreateAsset");

export const UpdateAssetSchema = CreateAssetSchema.partial()
  .extend({
    // Retiring or disposing of an asset IS a direct status edit, and is the only
    // one allowed. Everything else is driven by a workflow.
    status: z.enum(["retired", "disposed", "available"]).optional(),
  })
  .openapi("UpdateAsset");

/** Every search and filter key the spec names for the asset directory. */
export const ListAssetsQuery = z.object({
  q: z
    .string()
    .trim()
    .optional()
    .openapi({ description: "Search by asset tag, serial number, QR payload, or name." }),
  status: AssetStatusSchema.optional(),
  categoryId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  location: z.string().trim().optional(),
  isBookable: z
    .enum(["true", "false"])
    .optional()
    .openapi({ description: "Filter to bookable resources (rooms, vehicles)." }),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const AssetSchema = z
  .object({
    id: z.string().uuid(),
    assetTag: z.string(),
    name: z.string(),
    categoryId: z.string().uuid().nullable(),
    categoryName: z.string().nullable(),
    departmentId: z.string().uuid().nullable(),
    departmentName: z.string().nullable(),
    serialNumber: z.string().nullable(),
    acquisitionDate: z.string().nullable(),
    acquisitionCost: z.string().nullable(),
    condition: ConditionSchema,
    location: z.string().nullable(),
    photoPath: z.string().nullable(),
    isBookable: z.boolean(),
    status: AssetStatusSchema,
    retirementDate: z.string().nullable(),
    customValues: z.record(z.string(), z.union([z.string(), z.number()])),
    holderName: z.string().nullable().openapi({ description: "Who currently holds it, if anyone." }),
    holderId: z.string().uuid().nullable(),
    expectedReturnDate: z.string().nullable(),
  })
  .openapi("Asset");

export const TimelineEntrySchema = z
  .object({
    id: z.string().uuid(),
    action: z.string(),
    summary: z.string(),
    actorName: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  })
  .openapi("TimelineEntry");

export const IdParam = z.object({ id: z.string().uuid("Not a valid id.") });

export type CreateAssetInput = z.infer<typeof CreateAssetSchema>;
export type UpdateAssetInput = z.infer<typeof UpdateAssetSchema>;
export type ListAssetsInput = z.infer<typeof ListAssetsQuery>;
