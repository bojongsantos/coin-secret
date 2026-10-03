import { z } from "zod";
import { requireAdmin } from "@/infrastructure/auth/current-user";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError, getRequestIp, tooManyRequests } from "@/shared/server/http";
import { readAdminMutation } from "@/shared/server/admin-request";
import { updateAdminGate } from "@/infrastructure/admin/mutations";
import { adminMutationLimiter } from "@/infrastructure/admin/rate-limit";

const gateSchema = z.object({ feature: z.enum(["scannerExtended", "signals", "symbolSearch"]), free: z.boolean(), premium: z.boolean() }).strict();

export async function GET() {
  try {
    await requireAdmin();
    return Response.json({ gates: await prisma.featureGate.findMany({ orderBy: { feature: "asc" } }) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requireAdmin();
    const decision = adminMutationLimiter.check(admin.id);
    if (!decision.allowed) return tooManyRequests(decision.retryAfterSeconds);
    const input = await readAdminMutation(request, gateSchema);
    const gate = await updateAdminGate(admin.id, input, getRequestIp(request));
    return Response.json({ gate });
  } catch (error) {
    return apiError(error);
  }
}
