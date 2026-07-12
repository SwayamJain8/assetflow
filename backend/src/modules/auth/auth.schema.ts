import { z } from "@hono/zod-openapi";

/**
 * Validation for every auth request.
 *
 * Messages are written for a human, not a developer — the spec explicitly calls
 * out "invalid email must show a clear 'invalid email' message". The 422 body
 * names the offending field, so the frontend can render it under the right input.
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required.")
  .email("That doesn't look like a valid email address.")
  .openapi({ example: "priya@acme.test" });

const password = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(200, "Password is too long.")
  .openapi({ example: "password123" });

const name = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters.")
  .max(120, "Name is too long.");

/**
 * Self-serve onboarding: creates a brand-new organization and makes the caller
 * its Admin. This is the ONLY path that ever produces an admin, and it only does
 * so for an org that did not exist a moment ago — so it cannot be used to seize
 * control of someone else's organization.
 */
export const OnboardSchema = z
  .object({
    organizationName: name.openapi({ example: "Acme Corp" }),
    name: name.openapi({ example: "Admin User" }),
    email,
    password,
  })
  .openapi("OnboardRequest");

/**
 * Joining an EXISTING organization.
 *
 * Note what is absent: there is no `role` field. Signup cannot express a role, so
 * no request body — however malicious — can grant one. The database's DEFAULT
 * 'employee' is the only value that can land. Promotion happens exclusively in the
 * Employee Directory, by an Admin.
 */
export const SignupSchema = z
  .object({
    organizationSlug: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Organization is required.")
      .openapi({ example: "acme" }),
    name,
    email,
    password,
  })
  .openapi("SignupRequest");

export const LoginSchema = z
  .object({
    email,
    password: z.string().min(1, "Password is required."),
    // Only needed when the same address exists in more than one organization.
    organizationSlug: z.string().trim().toLowerCase().optional(),
  })
  .openapi("LoginRequest");

export const AuthUserSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string(),
    role: z.enum(["admin", "asset_manager", "department_head", "employee"]),
    departmentId: z.string().uuid().nullable(),
    organizationId: z.string().uuid(),
  })
  .openapi("AuthUser");

export const OrganizationSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    logoPath: z.string().nullable(),
    theme: z.record(z.string(), z.string()).nullable(),
  })
  .openapi("Organization");

export const SessionSchema = z
  .object({
    token: z.string(),
    user: AuthUserSchema,
    organization: OrganizationSchema,
  })
  .openapi("Session");

export type OnboardInput = z.infer<typeof OnboardSchema>;
export type SignupInput = z.infer<typeof SignupSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
