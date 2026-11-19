import { articleChange } from "@/core/domain/news/article";
import { requireAdmin } from "@/infrastructure/auth/current-user";
import { adminArticle, saveArticle } from "@/infrastructure/news/articles";
import { adminMutationLimiter } from "@/infrastructure/admin/rate-limit";
import { readAdminMutation } from "@/shared/server/admin-request";
import { apiError, getRequestIp, HttpError, tooManyRequests } from "@/shared/server/http";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    await requireAdmin();
    const article = await adminArticle((await context.params).id);
    if (!article) throw new HttpError(404, "Article not found.", "NOT_FOUND");
    return Response.json({ article }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const actor = await requireAdmin();
    const decision = adminMutationLimiter.check(actor.id);
    if (!decision.allowed) return tooManyRequests(decision.retryAfterSeconds);
    const input = await readAdminMutation(request, articleChange, 200_000);
    const article = await saveArticle(actor.id, input.fields, getRequestIp(request), { id: (await context.params).id, version: input.version });
    return Response.json({ article }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
