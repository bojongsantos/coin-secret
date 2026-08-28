import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import { createFixedWindowLimiter } from "@/core/application/rate-limit/fixed-window";
import { parseScanSymbols } from "@/core/application/scanner/scan-request";
import { runScannerCached } from "@/core/application/scanner/scanner-service";
import { activeSetupStore } from "@/infrastructure/persistence/active-setup-store";
import { marketData } from "@/infrastructure/market-data/market-data-provider";
import { getCurrentUser } from "@/infrastructure/auth/current-user";
import { canUserAccessFeature } from "@/infrastructure/auth/entitlements";
import { getRequestIp, tooManyRequests } from "@/shared/server/http";

export const runtime = "nodejs";

/**
 * A scan fans one inbound request out into many exchange requests, so it is
 * rate limited per client. Without this, varying the symbol list defeats the
 * result cache and turns this endpoint into an amplifier against our own
 * exchange quota.
 */
const limiter = createFixedWindowLimiter({ limit: 20, windowMs: 60_000 });

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const decision = limiter.check(user?.id ?? getRequestIp(request) ?? "anonymous");
    if (!decision.allowed) return tooManyRequests(decision.retryAfterSeconds);

    const body = (await request.json()) as { symbols?: unknown; force?: unknown };
    const extended = await canUserAccessFeature(user, "scannerExtended");
    // Anonymous callers always scan the default list. That keeps every such
    // request on one cache key, so the fan-out cannot be multiplied by simply
    // shuffling symbols.
    const requested = user ? parseScanSymbols(body.symbols) : undefined;
    const symbols = (requested ?? DEFAULT_WATCHLIST).slice(0, extended ? 200 : 20);

    // Same store the signals table reads, so this page cannot advertise a
    // different trade for a symbol than the board is publishing for it.
    const result = await runScannerCached(
      marketData,
      symbols,
      user !== null && body.force === true,
      { activeSetups: activeSetupStore },
    );
    const payload = extended ? result : { ...result, opportunities: result.opportunities.slice(0, 2) };
    return Response.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scanner unavailable";
    const badRequest = message.startsWith("symbols");
    return Response.json({ error: message }, { status: badRequest ? 400 : 503 });
  }
}
