import { z } from "zod";
import { getActiveSession, recordSessionActivity } from "@/infrastructure/auth/active-session";
import { sessionDeadline } from "@/core/domain/identity/session-policy";
import { readAdminMutation } from "@/shared/server/admin-request";
import { apiError, HttpError } from "@/shared/server/http";

const empty = z.object({}).strict();

function response(result: Awaited<ReturnType<typeof getActiveSession>>) {
  if (!result || !result.user.emailVerified) throw new HttpError(401, "Session expired. Please sign in again.", "SESSION_EXPIRED");
  return Response.json({
    deadline: sessionDeadline(result.session, result.user.role),
    serverNow: Date.now(),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  try { return response(await getActiveSession(request.headers)); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    await readAdminMutation(request, empty);
    return response(await recordSessionActivity(request.headers));
  } catch (error) { return apiError(error); }
}
