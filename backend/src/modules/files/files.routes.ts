import { Hono } from "hono";

import { AppError } from "../../middleware/error-handler";
import { resolveUpload } from "../../services/storage";
import type { AppEnv } from "../../types";

/**
 * Serves uploaded files (asset photos, maintenance photos, org logos) from the
 * local disk volume.
 *
 * Plain Hono rather than OpenAPIHono: the response is a binary stream, not JSON,
 * so there is no Zod schema to document and nothing for the validator to do.
 *
 * Deliberately unauthenticated. These are `<img src>` targets, and a browser will
 * not attach an Authorization header to an image request — gating them would mean
 * fetching every photo as a blob just to render it. The filenames are unguessable
 * UUIDs, and resolveUpload() blocks path traversal, so nothing outside the upload
 * directory is reachable.
 */
export const filesRouter = new Hono<AppEnv>();

filesRouter.get("/files/:name", async (c) => {
  const path = resolveUpload(c.req.param("name"));
  const file = Bun.file(path);

  if (!(await file.exists())) {
    throw new AppError(404, "FILE_NOT_FOUND", "That file does not exist.");
  }

  return new Response(file, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",

      // Content-addressed by a UUID name, so it can never change under a client.
      "Cache-Control": "public, max-age=31536000, immutable",

      // Belt and braces alongside the magic-byte check in storage.ts: even if
      // something unexpected did land on disk, the browser must not sniff it into
      // an executable type, and must not render it inline as a document.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
