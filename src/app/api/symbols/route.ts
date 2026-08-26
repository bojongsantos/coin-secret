import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import { tradableSignalSymbols } from "@/config/symbol-filters";
import { fetchUsdtSymbolCatalog } from "@/infrastructure/market-data/market-data-provider";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // The exchange board carries every listing, stablecoin pairs included.
    // Search offers what the scanner can actually analyse, so the same filter
    // applies here — otherwise a pair could be searched for and then come back
    // with no setup, for a reason nothing on screen would explain.
    const symbols = tradableSignalSymbols(await fetchUsdtSymbolCatalog());
    return Response.json(
      { symbols },
      { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" } },
    );
  } catch {
    return Response.json(
      { symbols: DEFAULT_WATCHLIST, fallback: true },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  }
}
