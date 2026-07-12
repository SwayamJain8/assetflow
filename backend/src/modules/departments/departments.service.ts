import { aliasedTable, and, count, eq, sql } from "drizzle-orm";

import { db } from "../../config/db";
import { assets, departments, users } from "../../db/schema";
import { AppError } from "../../middleware/error-handler";
import { record } from "../../services/activity";
import type { Ctx } from "../../types";
import type { CreateDepartmentInput, UpdateDepartmentInput } from "./departments.schema";

const parent = aliasedTable(departments, "parent");
const head = aliasedTable(users, "head");

/**
 * The directory table: each department with its head, its parent, and live counts
 * of members and assets. Done as one query with joins + correlated subqueries
 * rather than N+1 round-trips per row.
 */
export async function listDepartments(ctx: Ctx) {
  return db
    .select({
      id: departments.id,
      name: departments.name,
      headUserId: departments.headUserId,
      headName: head.name,
      parentDepartmentId: departments.parentDepartmentId,
      parentName: parent.name,
      status: departments.status,
      // Outer columns spelled out in full — see the note in categories.service.ts.
      // Drizzle only qualifies interpolated columns when the query has a JOIN, and
      // relying on that is how a count silently becomes 0.
      memberCount: sql<number>`(
        select count(*)::int from "users"
        where "users"."department_id" = "departments"."id"
      )`,
      assetCount: sql<number>`(
        select count(*)::int from "assets"
        where "assets"."department_id" = "departments"."id"
      )`,
    })
    .from(departments)
    .leftJoin(parent, eq(departments.parentDepartmentId, parent.id))
    .leftJoin(head, eq(departments.headUserId, head.id))
    .where(eq(departments.organizationId, ctx.orgId))
    .orderBy(departments.name);
}

async function mustExist(ctx: Ctx, id: string) {
  const [row] = await db
    .select()
    .from(departments)
    .where(and(eq(departments.id, id), eq(departments.organizationId, ctx.orgId)));

  if (!row) throw new AppError(404, "DEPARTMENT_NOT_FOUND", "That department does not exist.");
  return row;
}

/**
 * A department cannot be its own ancestor — otherwise the hierarchy becomes a
 * cycle and any recursive walk of it (the org chart, a "departments under X"
 * report) spins forever. Foreign keys cannot express this, so it is checked here.
 */
async function assertNoCycle(ctx: Ctx, id: string, parentId: string) {
  if (id === parentId) {
    throw new AppError(422, "CYCLIC_HIERARCHY", "A department cannot be its own parent.");
  }

  const ancestors = await db.execute<{ id: string }>(sql`
    with recursive chain as (
      select id, parent_department_id from ${departments} where id = ${parentId}
      union all
      select d.id, d.parent_department_id
      from ${departments} d
      join chain c on d.id = c.parent_department_id
    )
    select id from chain
  `);

  if (ancestors.rows.some((row) => row.id === id)) {
    throw new AppError(
      422,
      "CYCLIC_HIERARCHY",
      "That would make the department a descendant of itself.",
    );
  }
}

export async function createDepartment(ctx: Ctx, input: CreateDepartmentInput) {
  if (input.parentDepartmentId) await mustExist(ctx, input.parentDepartmentId);

  const [created] = await db
    .insert(departments)
    .values({
      organizationId: ctx.orgId,
      name: input.name,
      headUserId: input.headUserId ?? null,
      parentDepartmentId: input.parentDepartmentId ?? null,
      status: input.status,
    })
    .returning();

  await record(ctx, {
    entity: "department",
    entityId: created!.id,
    action: "created",
    summary: `Department "${created!.name}" created`,
  });

  return created!;
}

export async function updateDepartment(ctx: Ctx, id: string, input: UpdateDepartmentInput) {
  const existing = await mustExist(ctx, id);

  if (input.parentDepartmentId) {
    await mustExist(ctx, input.parentDepartmentId);
    await assertNoCycle(ctx, id, input.parentDepartmentId);
  }

  const [updated] = await db
    .update(departments)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.headUserId !== undefined && { headUserId: input.headUserId }),
      ...(input.parentDepartmentId !== undefined && {
        parentDepartmentId: input.parentDepartmentId,
      }),
      ...(input.status !== undefined && { status: input.status }),
    })
    .where(and(eq(departments.id, id), eq(departments.organizationId, ctx.orgId)))
    .returning();

  await record(ctx, {
    entity: "department",
    entityId: id,
    action: input.status && input.status !== existing.status ? input.status : "updated",
    summary: `Department "${updated!.name}" updated`,
  });

  return updated!;
}

/**
 * Deletion is refused while anything still points at the department. The FKs use
 * ON DELETE SET NULL, so the delete would technically succeed — and silently
 * orphan every employee and asset in it. Refusing with a specific count is far
 * more useful than a surprise.
 */
export async function deleteDepartment(ctx: Ctx, id: string) {
  const existing = await mustExist(ctx, id);

  const [memberRow] = await db
    .select({ n: count() })
    .from(users)
    .where(eq(users.departmentId, id));

  const [assetRow] = await db
    .select({ n: count() })
    .from(assets)
    .where(eq(assets.departmentId, id));

  const [childRow] = await db
    .select({ n: count() })
    .from(departments)
    .where(eq(departments.parentDepartmentId, id));

  const members = memberRow?.n ?? 0;
  const owned = assetRow?.n ?? 0;
  const children = childRow?.n ?? 0;

  const blockers = [
    members && `${members} employee${members === 1 ? "" : "s"}`,
    owned && `${owned} asset${owned === 1 ? "" : "s"}`,
    children && `${children} sub-department${children === 1 ? "" : "s"}`,
  ].filter(Boolean);

  if (blockers.length) {
    throw new AppError(
      409,
      "DEPARTMENT_IN_USE",
      `"${existing.name}" still has ${blockers.join(", ")}. Reassign them first, or set the department to inactive instead.`,
    );
  }

  await db.delete(departments).where(eq(departments.id, id));

  await record(ctx, {
    entity: "department",
    entityId: id,
    action: "deleted",
    summary: `Department "${existing.name}" deleted`,
  });

  return { id };
}
