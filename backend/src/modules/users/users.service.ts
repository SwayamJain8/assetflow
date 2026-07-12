import { and, count, eq, ilike, isNull, or, sql } from "drizzle-orm";

import { db } from "../../config/db";
import { allocations, departments, users } from "../../db/schema";
import { AppError } from "../../middleware/error-handler";
import { record } from "../../services/activity";
import type { Ctx } from "../../types";
import type { ListUsersInput, UpdateUserInput } from "./users.schema";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  asset_manager: "Asset Manager",
  department_head: "Department Head",
  employee: "Employee",
};

export async function listUsers(ctx: Ctx, query: ListUsersInput) {
  const filters = [eq(users.organizationId, ctx.orgId)];

  if (query.q) {
    filters.push(or(ilike(users.name, `%${query.q}%`), ilike(users.email, `%${query.q}%`))!);
  }
  if (query.role) filters.push(eq(users.role, query.role));
  if (query.departmentId) filters.push(eq(users.departmentId, query.departmentId));

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      departmentId: users.departmentId,
      departmentName: departments.name,
      status: users.status,
      // How many assets this person is currently holding — an open allocation.
      // Outer column spelled out in full; see the note in categories.service.ts.
      assetsHeld: sql<number>`(
        select count(*)::int from "allocations"
        where "allocations"."holder_user_id" = "users"."id"
          and "allocations"."returned_at" is null
      )`,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(departments, eq(users.departmentId, departments.id))
    .where(and(...filters))
    .orderBy(users.name);

  // Dates cross the wire as ISO strings, so say so in the type rather than
  // letting a Date leak into a contract that promises a string.
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

async function mustExist(ctx: Ctx, id: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.organizationId, ctx.orgId)));

  if (!row) throw new AppError(404, "USER_NOT_FOUND", "That employee does not exist.");
  return row;
}

/**
 * The Employee Directory update — the ONE place a role is ever assigned. The
 * route is Admin-only, so promotion is impossible anywhere else in the system.
 *
 * Two guards worth knowing about:
 *
 *  1. Removing the last Admin would lock every human out of the organization
 *     permanently — nobody could ever promote anyone again. Refused.
 *  2. Deactivating someone who still holds assets would strand those assets with
 *     an inactive holder. Refused, with the count, so the admin knows to collect
 *     the returns first.
 */
export async function updateUser(ctx: Ctx, id: string, input: UpdateUserInput) {
  const target = await mustExist(ctx, id);

  const losingAdmin =
    target.role === "admin" &&
    ((input.role !== undefined && input.role !== "admin") || input.status === "inactive");

  if (losingAdmin) {
    const [adminRow] = await db
      .select({ n: count() })
      .from(users)
      .where(
        and(
          eq(users.organizationId, ctx.orgId),
          eq(users.role, "admin"),
          eq(users.status, "active"),
        ),
      );

    if ((adminRow?.n ?? 0) <= 1) {
      throw new AppError(
        409,
        "LAST_ADMIN",
        "This is the only active Admin. Promote someone else to Admin first — otherwise nobody could ever assign roles again.",
      );
    }
  }

  if (input.status === "inactive") {
    const [heldRow] = await db
      .select({ n: count() })
      .from(allocations)
      .where(and(eq(allocations.holderUserId, id), isNull(allocations.returnedAt)));

    const held = heldRow?.n ?? 0;

    if (held) {
      throw new AppError(
        409,
        "USER_HOLDS_ASSETS",
        `${target.name} still holds ${held} asset${held === 1 ? "" : "s"}. Process the return${held === 1 ? "" : "s"} or transfer them first.`,
      );
    }
  }

  const [updated] = await db
    .update(users)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.departmentId !== undefined && { departmentId: input.departmentId }),
      ...(input.status !== undefined && { status: input.status }),
    })
    .where(and(eq(users.id, id), eq(users.organizationId, ctx.orgId)))
    .returning();

  // A role change is the security-relevant event here, so it gets its own audit
  // line naming both the old and the new role — and the person is told.
  if (input.role && input.role !== target.role) {
    await record(ctx, {
      entity: "user",
      entityId: id,
      action: "role_changed",
      summary: `${target.name} changed from ${ROLE_LABEL[target.role]} to ${ROLE_LABEL[input.role]} by ${ctx.user.name}`,
      metadata: { from: target.role, to: input.role },
    });
  } else {
    await record(ctx, {
      entity: "user",
      entityId: id,
      action: "updated",
      summary: `${target.name}'s profile updated`,
    });
  }

  return updated!;
}
