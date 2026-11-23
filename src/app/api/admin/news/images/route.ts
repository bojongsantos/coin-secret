import { requireAdmin } from "@/infrastructure/auth/current-user";
import { adminMutationLimiter } from "@/infrastructure/admin/rate-limit";
import { uploadNewsImage } from "@/infrastructure/news/images";
import { assertAdminOrigin } from "@/shared/server/admin-request";
import { apiError, tooManyRequests } from "@/shared/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin();
    assertAdminOrigin(request);
    const decision = adminMutationLimiter.check(actor.id);
    if (!decision.allowed) return tooManyRequests(decision.retryAfterSeconds);
    return Response.json({ image: await uploadNewsImage(actor.id, request) }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
