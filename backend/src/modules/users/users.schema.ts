import { z } from "@hono/zod-openapi";

export const RoleSchema = z
  .enum(["admin", "asset_manager", "department_head", "employee"])
  .openapi({ example: "asset_manager" });

/**
 * The Employee Directory update. This is the ONLY schema in the entire API that
 * accepts a `role`, and its route is Admin-only — which is exactly the spec's
 * rule: "Admin promotes an Employee to Department Head or Asset Manager here —
 * the ONLY place roles are assigned."
 */
export const UpdateUserSchema = z
  .object({
    role: RoleSchema.optional(),
    departmentId: z.string().uuid("Select a valid department.").nullish(),
    status: z.enum(["active", "inactive"]).optional(),
    name: z.string().trim().min(2, "Name must be at least 2 characters.").max(120).optional(),
  })
  .openapi("UpdateUser");

export const UserSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string(),
    role: RoleSchema,
    departmentId: z.string().uuid().nullable(),
    departmentName: z.string().nullable(),
    status: z.enum(["active", "inactive"]),
    assetsHeld: z.number(),
    createdAt: z.string(),
  })
  .openapi("User");

export const ListUsersQuery = z.object({
  q: z.string().trim().optional().openapi({ description: "Search by name or email." }),
  role: RoleSchema.optional(),
  departmentId: z.string().uuid().optional(),
});

export const IdParam = z.object({ id: z.string().uuid("Not a valid id.") });

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type ListUsersInput = z.infer<typeof ListUsersQuery>;
