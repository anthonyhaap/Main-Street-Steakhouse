/**
 * A team's crest — the one picture a manager owns.
 *
 * The database stores an object KEY (`<team_id>/<file>`), never a URL, and this
 * is where a key becomes something a browser can load. That split is the whole
 * security story: a URL column would be a stored redirect that any member could
 * point anywhere, printed on every screen in the league. A key can only address
 * the league's own bucket, and the storage policy only lets a manager write
 * under the folder named for the team he owns.
 *
 * Uploads are downscaled here rather than on a server. A phone photograph is
 * four megabytes of a picture that will be drawn at 46 pixels; sending it as-is
 * would cost the manager his upload and everyone else the download, forever.
 */

import { SUPABASE_URL } from "@/lib/config";

export const CREST_BUCKET = "team-logos";

/** What the bucket accepts, and what the file picker offers. */
export const CREST_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** The bucket's own ceiling, repeated here so the browser can say so first. */
export const CREST_MAX_BYTES = 2 * 1024 * 1024;

/** Longest edge after downscaling. The biggest seal drawn is 46px at 2x. */
const EDGE = 512;

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** The public URL of a stored crest, or null for a team that has none. */
export function crestUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const key = path.split("/").map(encodeURIComponent).join("/");
  return `${SUPABASE_URL}/storage/v1/object/public/${CREST_BUCKET}/${key}`;
}

/**
 * The bytes to upload for a chosen file, and the extension to store them under.
 *
 * Throws with something worth reading if the file cannot be used at all — the
 * caller shows the message.
 */
export async function crestUpload(file: File): Promise<{ blob: Blob; ext: string }> {
  if (!CREST_TYPES.includes(file.type)) {
    throw new Error("Use a PNG, JPEG, WebP or GIF.");
  }

  const shrunk = await shrink(file).catch(() => null);
  const blob = shrunk ?? file;

  // Only the original can still be too big: anything the canvas re-encoded at
  // 512px is orders of magnitude under the ceiling.
  if (blob.size > CREST_MAX_BYTES) {
    throw new Error("That image is over 2 MB and this browser couldn't shrink it. Try a smaller one.");
  }

  const ext = EXT[blob.type];
  if (!ext) throw new Error("Use a PNG, JPEG, WebP or GIF.");
  return { blob, ext };
}

/**
 * Re-encode to at most 512px on the long edge. Null means leave the file alone,
 * which is always safe — the size check above still applies.
 */
async function shrink(file: File): Promise<Blob | null> {
  // A GIF may be animated, and a canvas keeps only the frame it drew. Somebody
  // will upload a moving logo, and silently freezing it is worse than the
  // hundred kilobytes.
  if (file.type === "image/gif") return null;
  if (typeof createImageBitmap !== "function") return null;

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);

    // toBlob falls back to PNG when it cannot encode the type asked for, so the
    // extension is taken from what came back rather than from what was wanted.
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  } finally {
    bitmap.close();
  }
}
