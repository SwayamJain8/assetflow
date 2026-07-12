import { z } from "@hono/zod-openapi";

export const CreateDepartmentSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Department name must be at least 2 characters.")
      .max(120, "Department name is too long.")
      .openapi({ example: "Engineering" }),
    headUserId: z.string().uuid("Select a valid employee.").nullish(),
    parentDepartmentId: z.string().uuid("Select a valid parent department.").nullish(),
    status: z.enum(["active", "inactive"]).default("active"),
  })
  .openapi("CreateDepartment");

export const UpdateDepartmentSchema = CreateDepartmentSchema.partial().openapi("UpdateDepartment");

export const DepartmentSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    headUserId: z.string().uuid().nullable(),
    headName: z.string().nullable(),
    parentDepartmentId: z.string().uuid().nullable(),
    parentName: z.string().nullable(),
    status: z.enum(["active", "inactive"]),
    memberCount: z.number(),
    assetCount: z.number(),
  })
  .openapi("Department");

export const IdParam = z.object({
  id: z.string().uuid("Not a valid id."),
});

export type CreateDepartmentInput = z.infer<typeof CreateDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof UpdateDepartmentSchema>;
