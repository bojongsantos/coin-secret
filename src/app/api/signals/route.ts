import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import { createFixedWindowLimiter } from "@/core/application/rate-limit/fixed-window";
import { parseScanSymbols } from "@/core/application/scanner/scan-request";
import { rankTopSetups, runSdScanCached } from "@/core/application/scanner/supply-demand-scan-service";
import { visibleSignalsFor } from "@/core/domain/analysis/signal-display";
import { activeSetupStore } from "@/infrastructure/persistence/active-setup-store";
import { marketData } from "@/infrastructure/market-data/market-data-provider";
import { getCurrentUser } from "@/infrastructure/auth/current-user";
import { canUserAccessFeature } from "@/infrastructure/auth/entitlements";
import { getRequestIp, tooManyRequests } from "@/shared/server/http";

export const runtime = "nodejs";

/** Same fan-out exposure as the scanner, so the same guard applies. */
const limiter = createFixedWindowLimiter({ limit: 20, windowMs: 60_000 });

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const decision = limiter.check(user?.id ?? getRequestIp(request) ?? "anonymous");
    if (!decision.allowed) return tooManyRequests(decision.retryAfterSeconds);

    const body = (await request.json()) as { symbols?: unknown; force?: unknown; limit?: unknown };
    const fullAccess = await canUserAccessFeature(user, "signals");
    // Anonymous callers stay on the default list; see the scanner route.
    const requested = user ? parseScanSymbols(body.symbols) : undefined;
    // Every plan scans the same default universe. Capping the default list by
    // plan meant free and premium were looking at two different scans, and once
    // a confidence floor was added the shorter one routinely came back empty —
    // the plan looked broken rather than limited. Sharing one symbol key also
    // shares the scan cache. A caller-supplied list is still capped by plan,
    // which is where the fan-out guard actually matters.
    const symbols = requested ? requested.slice(0, fullAccess ? 200 : 20) : DEFAULT_WATCHLIST;
    const limit = typeof body.limit === "number" ? Math.min(10, Math.max(1, Math.trunc(body.limit))) : 5;

    // The store is what keeps a published setup on screen until price finishes
    // it. Without it a refresh would pick the best zone visible right now and
    // quietly swap out the plan somebody was already trading.
    const scanned = await runSdScanCached(
      marketData,
      symbols,
      user !== null && body.force === true,
      { activeSetups: activeSetupStore },
    );

    // Filtering happens here, before the free-plan truncation, and not in the
    // browser. Ranking reads the filtered set so the top-5 strip and the
    // tables cannot disagree on the same screen.
    const visible = visibleSignalsFor(scanned, fullAccess);
    const full = { ...scanned, ...visibleSignalsFor(scanned, true) };
    const top = rankTopSetups(full, limit);
    const result = { ...scanned, ...visible };
    return Response.json({ result, top }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signals unavailable";
    const badRequest = message.startsWith("symbols");
    return Response.json({ error: message }, { status: badRequest ? 400 : 503 });
  }
}
