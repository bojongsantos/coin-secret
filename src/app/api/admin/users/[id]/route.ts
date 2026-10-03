import { z } from "zod";
import { requireAdmin } from "@/infrastructure/auth/current-user";
import { updateAdminUser } from "@/infrastructure/admin/mutations";
import { apiError, getRequestIp, tooManyRequests } from "@/shared/server/http";
import { readAdminMutation } from "@/shared/server/admin-request";
import { adminMutationLimiter } from "@/infrastructure/admin/rate-limit";

const patchSchema = z.object({
  role: z.enum(["USER", "ADMIN"]).optional(),
  plan: z.enum(["FREE", "PREMIUM"]).optional(),
}).strict().refine((data) => data.role || data.plan, "Minimal satu perubahan diperlukan.");

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const decision = adminMutationLimiter.check(admin.id);
    if (!decision.allowed) return tooManyRequests(decision.retryAfterSeconds);
    const { id } = await context.params;
    const input = await readAdminMutation(request, patchSchema);
    const user = await updateAdminUser(admin.id, id, input, getRequestIp(request));
    return Response.json({ user });
  } catch (error) {
    return apiError(error);
  }
}
