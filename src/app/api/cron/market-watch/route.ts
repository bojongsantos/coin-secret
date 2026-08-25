import { runMarketWatch } from "@/infrastructure/monitoring/market-watch-service";
import { runSetupCapture } from "@/infrastructure/monitoring/setup-capture-service";
import { apiError, HttpError } from "@/shared/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Constant-time-ish comparison so a wrong secret cannot be recovered by
 * measuring how quickly this endpoint rejects it.
 */
function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function authorize(request: Request): void {
  const expected = process.env.CRON_SECRET;
  // Without a configured secret the endpoint stays shut rather than open.
  if (!expected) {
    throw new HttpError(503, "CRON_SECRET belum dikonfigurasi.", "CRON_NOT_CONFIGURED");
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !secretMatches(token, expected)) {
    throw new HttpError(401, "Tidak diizinkan.", "UNAUTHORIZED");
  }
}

export async function GET(request: Request) {
  try {
    authorize(request);
    const report = await runMarketWatch();
    // Runs after the alert sweep, and its failures are reported rather than
    // thrown: the archive is a marketing asset, and losing one photograph is
    // not a reason to fail the run that also evaluates users' price alerts.
    const capture = await runSetupCapture().catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
    return Response.json({ ...report, capture }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  return GET(request);
}
