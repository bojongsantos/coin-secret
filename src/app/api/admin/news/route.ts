import { articleFields, articleQuery, articleStatus } from "@/core/domain/news/article";
import { requireAdmin } from "@/infrastructure/auth/current-user";
import { articleList, saveArticle } from "@/infrastructure/news/articles";
import { adminMutationLimiter } from "@/infrastructure/admin/rate-limit";
import { readAdminMutation } from "@/shared/server/admin-request";
import { apiError, getRequestIp, HttpError, tooManyRequests } from "@/shared/server/http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const query = articleQuery.safeParse(params);
    const status = articleStatus.optional().safeParse(params.status || undefined);
    if (!query.success || !status.success) throw new HttpError(400, "Invalid filters.");
    return Response.json(await articleList(query.data, true, status.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin();
    const decision = adminMutationLimiter.check(actor.id);
    if (!decision.allowed) return tooManyRequests(decision.retryAfterSeconds);
    const input = await readAdminMutation(request, articleFields, 200_000);
    const article = await saveArticle(actor.id, input, getRequestIp(request));
    return Response.json({ article }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
