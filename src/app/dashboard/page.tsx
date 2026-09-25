import { DashboardClient } from "@/presentation/features/dashboard/dashboard-client";
import { getCurrentUser } from "@/infrastructure/auth/current-user";
import { canUserAccessFeature } from "@/infrastructure/auth/entitlements";
import { getDashboardSignals } from "@/infrastructure/market-data/dashboard-signals";
import { getMarketContextPayload } from "@/infrastructure/market-data/market-context-service";

export const dynamic = "force-dynamic";

/**
 * The app itself.
 *
 * Given its own address so the landing page has somewhere stable to send a
 * visitor, and so a reader who is not signed in can still reach the board —
 * the product has always been usable without an account.
 */
export default async function DashboardPage() {
  const initial = await Promise.allSettled([
    (async () => {
      const user = await getCurrentUser();
      return getDashboardSignals(await canUserAccessFeature(user, "signals"));
    })(),
    getMarketContextPayload(),
  ]);
  return (
    <DashboardClient
      initialSignals={initial[0].status === "fulfilled" ? initial[0].value : null}
      initialMarket={initial[1].status === "fulfilled" ? initial[1].value : null}
    />
  );
}
