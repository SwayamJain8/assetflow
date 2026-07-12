import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";

import { db } from "../../config/db";
import { organizations } from "../../db/schema";
import { createRouter, json } from "../../lib/router";
import { requireAuth, requireRole } from "../../middleware/auth";
import { AppError } from "../../middleware/error-handler";
import { record } from "../../services/activity";
import { saveUpload } from "../../services/storage";
import { ctxFrom } from "../../types";

/**
 * The organization's brand.
 *
 * `theme` is a bag of CSS custom-property values — the frontend derives it from
 * the uploaded logo (in the browser, where an image decoder already exists) and
 * posts the result here. The server stores it verbatim: it does not need to
 * understand colour, and keeping node-vibrant's native image dependencies off the
 * server is worth a great deal on a Bun/alpine image.
 */
const UpdateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2, "Organization name must be at least 2 characters.").optional(),
    theme: z
      .record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/, "Theme values must be hex colours."))
      .optional()
      .openapi({ example: { primary: "#0d9488", "brand-500": "#0d9488" } }),
  })
  .openapi("UpdateOrganization");

export const organizationRouter = createRouter();

organizationRouter.use("/organization", requireAuth);
organizationRouter.use("/organization/*", requireAuth);
organizationRouter.on(["PATCH"], "/organization", requireRole("admin"));
organizationRouter.on(["POST"], "/organization/*", requireRole("admin"));

organizationRouter.openapi(
  createRoute({
    method: "get",
    path: "/organization",
    tags: ["Organization"],
    summary: "The current organization, including its generated theme",
    security: [{ Bearer: [] }],
    responses: { 200: { description: "The organization." } },
  }),
  async (c) => {
    const ctx = ctxFrom(c.get("user"));
    const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
    return c.json(org!, 200);
  },
);

organizationRouter.openapi(
  createRoute({
    method: "patch",
    path: "/organization",
    tags: ["Organization"],
    summary: "Update the organization's name or theme (Admin only)",
    description:
      "The theme is a set of hex tokens generated from the logo in the browser. " +
      "Persisting it here is what makes the branding survive a refresh and apply to " +
      "every user in the organization, not just the admin who uploaded the logo.",
    security: [{ Bearer: [] }],
    request: { body: json(UpdateOrganizationSchema) },
    responses: {
      200: { description: "Updated." },
      403: { description: "Only an Admin may change the organization." },
    },
  }),
  async (c) => {
    const ctx = ctxFrom(c.get("user"));
    const input = c.req.valid("json");

    const [updated] = await db
      .update(organizations)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.theme !== undefined && { theme: input.theme }),
      })
      .where(eq(organizations.id, ctx.orgId))
      .returning();

    if (input.theme) {
      await record(ctx, {
        entity: "organization",
        entityId: ctx.orgId,
        action: "theme_updated",
        summary: `${updated!.name}'s brand theme updated`,
      });
    }

    return c.json(updated!, 200);
  },
);

/** Multipart — see the note in assets.routes.ts. */
organizationRouter.post("/organization/logo", async (c) => {
  const ctx = ctxFrom(c.get("user"));
  const body = await c.req.parseBody();
  const file = body["file"] as File;

  if (!file) throw new AppError(422, "NO_FILE", "Choose a logo to upload.");

  // Magic-byte validated in storage.ts — a "logo" that is really a script is
  // refused there, not here.
  const logoPath = await saveUpload(file);

  const [updated] = await db
    .update(organizations)
    .set({ logoPath })
    .where(eq(organizations.id, ctx.orgId))
    .returning();

  await record(ctx, {
    entity: "organization",
    entityId: ctx.orgId,
    action: "logo_updated",
    summary: `${updated!.name}'s logo updated`,
  });

  return c.json({ logoPath }, 200);
});
