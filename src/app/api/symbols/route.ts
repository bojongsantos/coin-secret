import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import { tradableSignalSymbols } from "@/config/symbol-filters";
import { fetchUsdtSymbolCatalog } from "@/infrastructure/market-data/market-data-provider";
import { getCurrentUser } from "@/infrastructure/auth/current-user";
import { canUserAccessFeature } from "@/infrastructure/auth/entitlements";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const fullAccess = await canUserAccessFeature(user, "symbolSearch");
    if (!fullAccess) {
      return Response.json(
        { symbols: DEFAULT_WATCHLIST.slice(0, 20), restricted: true },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    // The exchange board carries every listing, stablecoin pairs included.
    // Search offers what the scanner can actually analyse, so the same filter
    // applies here — otherwise a pair could be searched for and then come back
    // with no setup, for a reason nothing on screen would explain.
    const symbols = tradableSignalSymbols(await fetchUsdtSymbolCatalog());
    return Response.json(
      { symbols },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json(
      { symbols: DEFAULT_WATCHLIST.slice(0, 20), restricted: true, fallback: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
