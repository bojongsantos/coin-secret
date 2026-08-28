import { normalizeUsdtSymbol } from "@/core/domain/market/symbol";
import { isTimeframe } from "@/core/domain/market/timeframe";
import { activeSetupStore } from "@/infrastructure/persistence/active-setup-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The setup the product has published for a symbol, if any.
 *
 * The chart needs this for the same reason the signals table does: a setup
 * that has been shown to readers keeps its levels until price finishes it. Ask
 * the detector again and it will happily answer with a different zone, or with
 * none at all once the ones it can still see have all resolved, which is how a
 * symbol came to be listed with a live setup and then open on "No Zone Setup".
 *
 * Read-only and unauthenticated: it returns exactly what the signals table
 * already shows, and the chart is useless without it.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawSymbol = url.searchParams.get("symbol");
    if (!rawSymbol) return Response.json({ setup: null });
    const symbol = normalizeUsdtSymbol(rawSymbol);
    const timeframe = url.searchParams.get("tf");

    const [published] = await activeSetupStore.loadActive([symbol]);
    // A published setup belongs to one chart. Handing it to another timeframe
    // would draw a zone whose bars do not exist there.
    if (!published) return Response.json({ setup: null });
    if (isTimeframe(timeframe) && published.timeframe !== timeframe) {
      return Response.json({ setup: null });
    }

    return Response.json(
      { setup: published },
      { headers: { "Cache-Control": "private, max-age=15" } },
    );
  } catch {
    // The chart falls back to detecting for itself, which is worse but is
    // still a chart.
    return Response.json({ setup: null });
  }
}
