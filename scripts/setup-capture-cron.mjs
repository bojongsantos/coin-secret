import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

/** Existing hosting env supplies the URL and bearer secret; never print either. */
export async function runCaptureCron(env = process.env, request = fetch) {
  const started = performance.now();
  const secret = env.CRON_SECRET;
  let base;
  try { base = new URL(env.APP_URL ?? env.BETTER_AUTH_URL ?? ""); } catch { throw new Error("CRON_CONFIGURATION_INVALID"); }
  if (!secret?.trim() || base.protocol !== "https:" || base.username || base.password) throw new Error("CRON_CONFIGURATION_INVALID");
  const response = await request(new URL("/api/cron/setup-capture", base), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
  });
  let body;
  try { body = await response.json(); } catch { throw new Error("CRON_RESPONSE_INVALID"); }
  const publication = body?.publication;
  if (response.status === 202 && publication?.status === "in-progress" && publication.verified === false) {
    return { status: "in-progress", elapsedMs: Math.round(performance.now() - started) };
  }
  if (response.status !== 200) throw new Error("CRON_REQUEST_FAILED");
  const age = publication?.ageSeconds;
  const scannedAt = Date.parse(publication?.scannedAt);
  if (publication?.verified !== true || publication.durable !== true
    || !["fresh", "stale"].includes(publication.status)
    || !Number.isFinite(age) || age < 0 || age > 45 * 60
    || !Number.isFinite(scannedAt) || scannedAt > Date.now()
    || Date.now() - scannedAt > 45 * 60_000) throw new Error("CRON_PUBLICATION_UNVERIFIED");
  return { status: "published", elapsedMs: Math.round(performance.now() - started),
    scannedAt: publication.scannedAt, ageSeconds: age };
}

let entryUrl;
try { if (process.argv[1]) entryUrl = pathToFileURL(realpathSync(process.argv[1])).href; }
catch { /* An importing process can supply a non-file argument instead of an entrypoint. */ }
if (import.meta.url === entryUrl) {
  const started = performance.now();
  runCaptureCron().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    const allowed = ["CRON_CONFIGURATION_INVALID", "CRON_RESPONSE_INVALID", "CRON_REQUEST_FAILED", "CRON_PUBLICATION_UNVERIFIED"];
    const code = error instanceof Error && allowed.includes(error.message) ? error.message : "CRON_TRANSPORT_FAILED";
    console.error(JSON.stringify({ status: "failed", code, elapsedMs: Math.round(performance.now() - started) }));
    process.exitCode = 1;
  });
}
