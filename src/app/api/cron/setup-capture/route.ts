import { runSetupCapture } from "@/infrastructure/monitoring/setup-capture-service";
import { readSignalsPublication } from "@/infrastructure/monitoring/signals-publication";
import { apiError, HttpError } from "@/shared/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    if (new URL(request.url).searchParams.get("check") === "1") {
      const publication = await readSignalsPublication();
      return Response.json({ publication }, { status: publication.verified ? 200 : 503, headers: { "Cache-Control": "no-store" } });
    }
    // One coordinated scan publishes the board before feeding the proof archive.
    const capture = await runSetupCapture();
    const inProgress = capture.publication?.status === "in-progress";
    const status = inProgress ? 202 : capture.publication?.verified ? 200 : 503;
    return Response.json(capture, { status, headers: {
      "Cache-Control": "no-store", ...(status === 200 ? {} : { "Retry-After": "15" }),
    } });
  } catch (error) {
    if (!(error instanceof HttpError)) console.warn("[setup.capture]", { status: "failed" });
    const response = apiError(error instanceof HttpError ? error : new HttpError(503, "Setup capture unavailable.", "CAPTURE_UNAVAILABLE"));
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}

export async function POST(request: Request) {
  return GET(request);
}
