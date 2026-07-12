import { and, count, eq, sql } from "drizzle-orm";

import { db } from "../../config/db";
import { assetCategories, assets } from "../../db/schema";
import { AppError } from "../../middleware/error-handler";
import { record } from "../../services/activity";
import type { Ctx } from "../../types";
import type { CreateCategoryInput, UpdateCategoryInput } from "./categories.schema";

/**
 * The outer column in this correlated subquery is written out in full
 * ("asset_categories"."id") rather than interpolated as ${assetCategories.id}.
 *
 * That is not stylistic. Drizzle only qualifies an interpolated column reference
 * when the surrounding query has a JOIN; without one it emits a bare "id", which
 * inside `from "assets"` silently resolves to assets.id. The comparison then reads
 * `category_id = assets.id`, is never true, and every count comes back 0 — no
 * error, just a wrong number. Spelling the table out removes the ambiguity.
 */
const assetCountForCategory = sql<number>`(
  select count(*)::int from "assets"
  where "assets"."category_id" = "asset_categories"."id"
)`;

export async function listCategories(ctx: Ctx) {
  return db
    .select({
      id: assetCategories.id,
      name: assetCategories.name,
      description: assetCategories.description,
      customFields: assetCategories.customFields,
      assetCount: assetCountForCategory,
    })
    .from(assetCategories)
    .where(eq(assetCategories.organizationId, ctx.orgId))
    .orderBy(assetCategories.name);
}

async function mustExist(ctx: Ctx, id: string) {
  const [row] = await db
    .select()
    .from(assetCategories)
    .where(and(eq(assetCategories.id, id), eq(assetCategories.organizationId, ctx.orgId)));

  if (!row) throw new AppError(404, "CATEGORY_NOT_FOUND", "That category does not exist.");
  return row;
}

/** Two fields sharing a key would silently overwrite each other in custom_values. */
function assertUniqueKeys(fields: { key: string }[]) {
  const seen = new Set<string>();

  for (const field of fields) {
    if (seen.has(field.key)) {
      throw new AppError(
        422,
        "DUPLICATE_FIELD_KEY",
        `The field key "${field.key}" is used more than once.`,
      );
    }
    seen.add(field.key);
  }
}

export async function createCategory(ctx: Ctx, input: CreateCategoryInput) {
  assertUniqueKeys(input.customFields);

  const [created] = await db
    .insert(assetCategories)
    .values({
      organizationId: ctx.orgId,
      name: input.name,
      description: input.description ?? null,
      customFields: input.customFields,
    })
    .returning();

  await record(ctx, {
    entity: "category",
    entityId: created!.id,
    action: "created",
    summary: `Category "${created!.name}" created`,
  });

  return created!;
}

export async function updateCategory(ctx: Ctx, id: string, input: UpdateCategoryInput) {
  await mustExist(ctx, id);
  if (input.customFields) assertUniqueKeys(input.customFields);

  const [updated] = await db
    .update(assetCategories)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.customFields !== undefined && { customFields: input.customFields }),
    })
    .where(and(eq(assetCategories.id, id), eq(assetCategories.organizationId, ctx.orgId)))
    .returning();

  await record(ctx, {
    entity: "category",
    entityId: id,
    action: "updated",
    summary: `Category "${updated!.name}" updated`,
  });

  return updated!;
}

export async function deleteCategory(ctx: Ctx, id: string) {
  const existing = await mustExist(ctx, id);

  const [useRow] = await db
    .select({ n: count() })
    .from(assets)
    .where(eq(assets.categoryId, id));

  const inUse = useRow?.n ?? 0;

  if (inUse) {
    throw new AppError(
      409,
      "CATEGORY_IN_USE",
      `"${existing.name}" is still used by ${inUse} asset${inUse === 1 ? "" : "s"}. Recategorise them first.`,
    );
  }

  await db.delete(assetCategories).where(eq(assetCategories.id, id));

  await record(ctx, {
    entity: "category",
    entityId: id,
    action: "deleted",
    summary: `Category "${existing.name}" deleted`,
  });

  return { id };
}
