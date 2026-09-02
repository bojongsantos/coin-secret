import { normalizeUsdtSymbol } from "@/core/domain/market/symbol";
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

    // Returned whatever timeframe the caller happens to be showing. A setup
    // belongs to one chart and cannot be drawn on another, but withholding it
    // when the timeframes differ left a hundred and eight of the hundred and
    // ninety published setups invisible: the chart opened on 15m, the plan
    // lived on 1H, and the page said "No Zone Setup" about a symbol the board
    // was listing. The client reads `timeframe` and moves the chart to it.
    const [published] = await activeSetupStore.loadActive([symbol]);
    if (!published) return Response.json({ setup: null });

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
