import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The wordmark, as a data URI for the server-rendered proof images.
 *
 * Those images are composed on a schedule with no browser anywhere near them
 * and are downloaded as standalone files, so an `<image href="/logo/…">` would
 * resolve to nothing the moment the file left the site. The bytes travel
 * inside it instead.
 *
 * Read once and kept: the file ships with the deployment and cannot change
 * under a running instance.
 */
let cached: string | null | undefined;

export async function wordmarkDataUri(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    const file = path.join(process.cwd(), "public", "logo", "logo-text.png");
    cached = `data:image/png;base64,${(await readFile(file)).toString("base64")}`;
  } catch {
    // The composer falls back to setting the name in type, which is a plainer
    // picture but still a complete one.
    cached = null;
  }
  return cached;
}

/** Ink box of the wordmark, so callers can size it without measuring. */
export const WORDMARK_RATIO = 844 / 105;
