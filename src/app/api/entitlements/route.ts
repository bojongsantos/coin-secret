import { getCurrentUser } from "@/infrastructure/auth/current-user";
import { featureLabel, hasFeature, type FeatureKey } from "@/core/domain/access/gating";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError } from "@/shared/server/http";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const features = Object.keys(featureLabel) as FeatureKey[];
    const [gates, grants] = user ? await Promise.all([
      prisma.featureGate.findMany({ where: { feature: { in: features } } }),
      prisma.userFeatureGrant.findMany({ where: { userId: user.id, feature: { in: features } } }),
    ]) : [[], []];
    const plan = user?.plan === "PREMIUM" ? "premium" : "free";
    const access = Object.fromEntries(features.map((feature) => {
      const grant = grants.find((item) => item.feature === feature);
      const gate = gates.find((item) => item.feature === feature);
      const allowed = grant?.enabled ?? (gate ? (plan === "premium" ? gate.premium : gate.free) : hasFeature(plan, feature));
      return [feature, allowed];
    }));
    return Response.json({ authenticated: Boolean(user), plan, access, accessExpiresAt: user?.accessExpiresAt ?? null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
