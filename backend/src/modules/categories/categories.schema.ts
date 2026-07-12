import { z } from "@hono/zod-openapi";

/**
 * A category-specific field definition. The spec's example: Electronics wants a
 * warranty period, Furniture does not. Rather than a table per category, a
 * category declares its extra fields here and each asset fills them into
 * `assets.custom_values`.
 */
export const CustomFieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1, "Field key is required.")
      .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Key must start with a letter and contain no spaces.")
      .openapi({ example: "warrantyMonths" }),
    label: z.string().trim().min(1, "Field label is required.").openapi({ example: "Warranty (months)" }),
    type: z.enum(["text", "number", "date"]).openapi({ example: "number" }),
  })
  .openapi("CustomField");

export const CreateCategorySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Category name must be at least 2 characters.")
      .max(80, "Category name is too long.")
      .openapi({ example: "Electronics" }),
    description: z.string().trim().max(300).nullish(),
    customFields: z.array(CustomFieldSchema).max(12, "A category can define at most 12 fields.").default([]),
  })
  .openapi("CreateCategory");

export const UpdateCategorySchema = CreateCategorySchema.partial().openapi("UpdateCategory");

export const CategorySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    customFields: z.array(CustomFieldSchema),
    assetCount: z.number(),
  })
  .openapi("Category");

export const IdParam = z.object({ id: z.string().uuid("Not a valid id.") });

export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;
