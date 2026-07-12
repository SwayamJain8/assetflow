import { createRoute, z } from "@hono/zod-openapi";

import { createRouter, json } from "../../lib/router";
import { requireAuth, requireRole } from "../../middleware/auth";
import { ctxFrom } from "../../types";
import {
  AssetSchema,
  CreateAssetSchema,
  IdParam,
  ListAssetsQuery,
  TimelineEntrySchema,
  UpdateAssetSchema,
} from "./assets.schema";
import {
  createAsset,
  getAsset,
  getAssetHistory,
  getAssetTimeline,
  listAssets,
  listBookableResources,
  setAssetPhoto,
  updateAsset,
} from "./assets.service";

export const assetsRouter = createRouter();

// Anyone signed in may browse the estate. Only an Asset Manager or an Admin may
// register or amend an asset.
assetsRouter.use("/assets", requireAuth);
assetsRouter.use("/assets/*", requireAuth);
assetsRouter.use("/resources", requireAuth);
assetsRouter.on(["POST", "PATCH"], "/assets", requireRole("admin", "asset_manager"));
assetsRouter.on(["POST", "PATCH"], "/assets/*", requireRole("admin", "asset_manager"));

assetsRouter.openapi(
  createRoute({
    method: "get",
    path: "/assets",
    tags: ["Assets"],
    summary: "Search and filter the asset directory",
    description:
      "Search `q` matches asset tag, serial number, or name. Scanning an asset's QR " +
      "code yields its tag, so a scan lands in this same `q` — no separate QR lookup.",
    security: [{ Bearer: [] }],
    request: { query: ListAssetsQuery },
    responses: { 200: { description: "Assets.", ...json(z.array(AssetSchema)) } },
  }),
  async (c) => c.json(await listAssets(ctxFrom(c.get("user")), c.req.valid("query")), 200),
);

assetsRouter.openapi(
  createRoute({
    method: "get",
    path: "/resources",
    tags: ["Assets"],
    summary: "Bookable resources (rooms, vehicles) for the booking screen",
    description: "A resource is not a separate table — it is an asset with is_bookable = true.",
    security: [{ Bearer: [] }],
    responses: { 200: { description: "Bookable assets." } },
  }),
  async (c) => c.json(await listBookableResources(ctxFrom(c.get("user"))), 200),
);

assetsRouter.openapi(
  createRoute({
    method: "get",
    path: "/assets/{id}",
    tags: ["Assets"],
    summary: "One asset, including who currently holds it",
    security: [{ Bearer: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: "The asset.", ...json(AssetSchema) },
      404: { description: "No such asset." },
    },
  }),
  async (c) => c.json(await getAsset(ctxFrom(c.get("user")), c.req.valid("param").id), 200),
);

assetsRouter.openapi(
  createRoute({
    method: "get",
    path: "/assets/{id}/timeline",
    tags: ["Assets"],
    summary: "The asset's lifecycle timeline",
    description:
      "Every event in this asset's life, newest first — registered, allocated, sent " +
      "for maintenance, returned, audited. This is a query over activity_logs, which " +
      "every mutation already writes to; there is no separate timeline table to drift.",
    security: [{ Bearer: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: "Timeline entries.", ...json(z.array(TimelineEntrySchema)) },
      404: { description: "No such asset." },
    },
  }),
  async (c) => c.json(await getAssetTimeline(ctxFrom(c.get("user")), c.req.valid("param").id), 200),
);

assetsRouter.openapi(
  createRoute({
    method: "get",
    path: "/assets/{id}/history",
    tags: ["Assets"],
    summary: "Allocation history and maintenance history for one asset",
    security: [{ Bearer: [] }],
    request: { params: IdParam },
    responses: { 200: { description: "Both histories." } },
  }),
  async (c) => c.json(await getAssetHistory(ctxFrom(c.get("user")), c.req.valid("param").id), 200),
);

assetsRouter.openapi(
  createRoute({
    method: "post",
    path: "/assets",
    tags: ["Assets"],
    summary: "Register an asset (Asset Manager or Admin)",
    description:
      "The asset tag (AF-0001) is minted by a PostgreSQL sequence — it cannot be " +
      "supplied, and concurrent registrations cannot collide. A new asset always " +
      "enters as `available`.",
    security: [{ Bearer: [] }],
    request: { body: json(CreateAssetSchema) },
    responses: {
      201: { description: "Registered." },
      403: { description: "Only an Asset Manager or Admin may register assets." },
      422: { description: "Validation failed." },
    },
  }),
  async (c) => c.json(await createAsset(ctxFrom(c.get("user")), c.req.valid("json")), 201),
);

assetsRouter.openapi(
  createRoute({
    method: "patch",
    path: "/assets/{id}",
    tags: ["Assets"],
    summary: "Update an asset (Asset Manager or Admin)",
    security: [{ Bearer: [] }],
    request: { params: IdParam, body: json(UpdateAssetSchema) },
    responses: {
      200: { description: "Updated." },
      409: { description: "The asset is currently held and cannot be retired." },
    },
  }),
  async (c) =>
    c.json(
      await updateAsset(ctxFrom(c.get("user")), c.req.valid("param").id, c.req.valid("json")),
      200,
    ),
);

/**
 * Multipart upload. Declared outside the Zod pipeline on purpose: `parseBody`
 * hands back a File, which is not something a Zod body schema can validate —
 * services/storage.ts does the checking (size, MIME type, path safety) instead.
 */
assetsRouter.post("/assets/:id/photo", async (c) => {
  const body = await c.req.parseBody();
  const result = await setAssetPhoto(
    ctxFrom(c.get("user")),
    c.req.param("id"),
    body["file"] as File,
  );
  return c.json(result, 200);
});
