import { randomUUID } from "node:crypto";
import { extname, join, resolve } from "node:path";

import { AppError } from "../middleware/error-handler";

/**
 * File storage on local disk, mounted as a Docker volume — no S3, no third-party
 * service. Files survive container restarts because `./uploads` is a bind mount
 * (see docker-compose.yml).
 */
const UPLOAD_DIR = resolve(process.cwd(), "uploads");

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Allowed types, identified by their MAGIC BYTES rather than by what the client
 * claims.
 *
 * The declared Content-Type is attacker-controlled: anyone can label a shell
 * script `image/png` and it would sail through a MIME-only check. So we read the
 * file's actual leading bytes and require them to match a format we accept.
 *
 * SVG is deliberately NOT allowed. It is XML, it can carry a <script> tag, and we
 * serve uploads from our own origin — an SVG "logo" would be stored XSS against
 * every user who views it. PNG/JPEG/WebP cover logos and photos; PDF covers docs.
 */
type Magic = { ext: string; mime: string; matches: (head: Uint8Array) => boolean };

const startsWith = (head: Uint8Array, bytes: number[]) =>
  bytes.every((byte, index) => head[index] === byte);

const SIGNATURES: Magic[] = [
  {
    ext: ".png",
    mime: "image/png",
    matches: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    ext: ".jpg",
    mime: "image/jpeg",
    matches: (h) => startsWith(h, [0xff, 0xd8, 0xff]),
  },
  {
    // "RIFF" .... "WEBP"
    ext: ".webp",
    mime: "image/webp",
    matches: (h) =>
      startsWith(h, [0x52, 0x49, 0x46, 0x46]) &&
      h[8] === 0x57 &&
      h[9] === 0x45 &&
      h[10] === 0x42 &&
      h[11] === 0x50,
  },
  {
    // "%PDF"
    ext: ".pdf",
    mime: "application/pdf",
    matches: (h) => startsWith(h, [0x25, 0x50, 0x44, 0x46]),
  },
];

/**
 * Writes an uploaded file and returns the opaque name to store on the record.
 *
 * The stored name is a fresh UUID, never the client's filename. Two reasons:
 * a user-supplied name could contain `../` and escape the upload directory, and
 * two people uploading `photo.jpg` must not overwrite each other.
 */
export async function saveUpload(file: File): Promise<string> {
  if (!(file instanceof File) || file.size === 0) {
    throw new AppError(422, "NO_FILE", "No file was uploaded.");
  }

  if (file.size > MAX_BYTES) {
    throw new AppError(
      422,
      "FILE_TOO_LARGE",
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`,
    );
  }

  // Read the real bytes. Neither the declared Content-Type nor the filename is
  // evidence of anything — both come from the client.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = SIGNATURES.find((signature) => signature.matches(bytes));

  if (!format) {
    throw new AppError(
      422,
      "UNSUPPORTED_FILE_TYPE",
      "That file is not a PNG, JPEG, WebP, or PDF. (The check reads the file's actual contents, not its name or declared type.)",
    );
  }

  // The stored extension comes from the detected format, never from file.name.
  const storedName = `${randomUUID()}${format.ext}`;

  await Bun.write(join(UPLOAD_DIR, storedName), bytes);

  return storedName;
}

/**
 * Resolves a stored name to a file on disk.
 *
 * The path is re-resolved and checked to still sit inside UPLOAD_DIR, so a
 * crafted name like `../../.env` cannot be used to read arbitrary files off the
 * server — the classic path-traversal hole in any download endpoint.
 */
export function resolveUpload(storedName: string): string {
  const path = resolve(UPLOAD_DIR, storedName);

  if (!path.startsWith(UPLOAD_DIR)) {
    throw new AppError(400, "INVALID_PATH", "That is not a valid file.");
  }

  return path;
}
