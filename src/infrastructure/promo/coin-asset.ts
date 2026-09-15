import "server-only";

import { coinIconSources } from "@/core/domain/market/coin-icon";

/**
 * A coin's logo, as a data URI for the server-rendered result cards.
 *
 * Those cards are composed on a schedule with no browser anywhere near them and
 * are downloaded as standalone files, so an `<image href="https://…">` would
 * resolve to nothing the moment the file left the site — and to nothing at all
 * when the SVG is rasterised. The bytes travel inside it instead.
 */

/** Largest logo we will inline. Measured across the watchlist: the biggest is 59 KB. */
const MAX_BYTES = 200_000;

/** How long to wait for a CDN before giving up and drawing the fallback. */
const TIMEOUT_MS = 4_000;

/**
 * Kept for the life of the instance.
 *
 * One sweep renders many cards and a symbol repeats across runs; re-fetching
 * the same logo every time would put the archive's render time at the mercy of
 * a CDN it does not control. `null` is cached too — a coin with no logo
 * anywhere should not be looked up again and again.
 */
const cache = new Map<string, string | null>();

function isPng(bytes: Uint8Array): boolean {
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

/**
 * Fetches one candidate and returns it only if it is really an image.
 *
 * A CDN that answers 200 with an HTML error page is not a logo, and inlining
 * one would put a broken image where the coin should be.
 */
async function fetchIcon(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 200 || buffer.byteLength > MAX_BYTES) return null;
    const bytes = new Uint8Array(buffer);
    if (!isPng(bytes.subarray(0, 4))) return null;
    return `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * The logo for a pair, or null when no source has one.
 *
 * Sources are tried in order. Binance is first because the board is made of
 * Binance pairs and it has a logo for every one of them — measured across the
 * whole watchlist, 193 of 193, where the previous source covered 138.
 */
export async function coinIconDataUri(symbol: string): Promise<string | null> {
  const key = symbol.replace(/USDT$/i, "").toUpperCase();
  if (!key) return null;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  for (const url of coinIconSources(key)) {
    const found = await fetchIcon(url);
    if (found) {
      cache.set(key, found);
      return found;
    }
  }
  cache.set(key, null);
  return null;
}
