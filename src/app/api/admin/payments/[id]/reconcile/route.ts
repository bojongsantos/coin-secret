import { z } from "zod";
import { requireAdmin } from "@/infrastructure/auth/current-user";
import { reconcilePayment } from "@/infrastructure/billing/payment-reconciliation";
import { adminMutationLimiter } from "@/infrastructure/admin/rate-limit";
import { readAdminMutation } from "@/shared/server/admin-request";
import { apiError, tooManyRequests } from "@/shared/server/http";

const schema = z.object({ paymentId: z.string().regex(/^\d{1,30}$/).optional() }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const decision = adminMutationLimiter.check(admin.id);
    if (!decision.allowed) return tooManyRequests(decision.retryAfterSeconds);
    const input = await readAdminMutation(request, schema);
    const { id } = await context.params;
    const result = await reconcilePayment(admin.id, id, input.paymentId);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
