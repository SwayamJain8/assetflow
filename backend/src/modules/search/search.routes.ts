import { createRoute, z } from "@hono/zod-openapi";
import { and, eq, ilike, or, sql } from "drizzle-orm";

import { db } from "../../config/db";
import { assets, users } from "../../db/schema";
import { createRouter, json } from "../../lib/router";
import { requireAuth } from "../../middleware/auth";
import { ctxFrom } from "../../types";

const SearchResult = z
  .object({
    assets: z.array(
      z.object({
        id: z.string(),
        assetTag: z.string(),
        name: z.string(),
        status: z.string(),
        holderName: z.string().nullable(),
        isBookable: z.boolean(),
      }),
    ),
    people: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        role: z.string(),
        assetsHeld: z.number(),
      }),
    ),
  })
  .openapi("SearchResult");

export const searchRouter = createRouter();

searchRouter.use("/search", requireAuth);

/**
 * One query behind the ⌘K palette.
 *
 * Scoped to the caller's organization, like everything else — a global search that
 * quietly reached across tenants would be the easiest possible data leak, and the
 * one most likely to go unnoticed because it "only" returns names.
 */
searchRouter.openapi(
  createRoute({
    method: "get",
    path: "/search",
    tags: ["System"],
    summary: "Global search across assets and people (the ⌘K palette)",
    security: [{ Bearer: [] }],
    request: {
      query: z.object({
        q: z.string().trim().min(1, "Type something to search for."),
      }),
    },
    responses: { 200: { description: "Matches.", ...json(SearchResult) } },
  }),
  async (c) => {
    const ctx = ctxFrom(c.get("user"));
    const term = `%${c.req.valid("query").q}%`;

    const [assetMatches, peopleMatches] = await Promise.all([
      db
        .select({
          id: assets.id,
          assetTag: assets.assetTag,
          name: assets.name,
          status: assets.status,
          isBookable: assets.isBookable,
          // Who holds it, so the palette can say so without a second call.
          holderName: sql<string | null>`(
            select u.name from "allocations" al
            join "users" u on u.id = al.holder_user_id
            where al.asset_id = "assets"."id" and al.returned_at is null
            limit 1
          )`,
        })
        .from(assets)
        .where(
          and(
            eq(assets.organizationId, ctx.orgId),
            or(
              ilike(assets.assetTag, term),
              ilike(assets.name, term),
              ilike(assets.serialNumber, term),
              ilike(assets.location, term),
            ),
          ),
        )
        .orderBy(assets.assetTag)
        .limit(6),

      db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          assetsHeld: sql<number>`(
            select count(*)::int from "allocations"
            where "allocations"."holder_user_id" = "users"."id"
              and "allocations"."returned_at" is null
          )`,
        })
        .from(users)
        .where(
          and(
            eq(users.organizationId, ctx.orgId),
            or(ilike(users.name, term), ilike(users.email, term)),
          ),
        )
        .orderBy(users.name)
        .limit(5),
    ]);

    return c.json({ assets: assetMatches, people: peopleMatches }, 200);
  },
);
