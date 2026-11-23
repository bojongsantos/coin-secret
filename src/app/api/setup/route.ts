import { normalizeUsdtSymbol } from "@/core/domain/market/symbol";
import { isSetupSignatureForSymbol } from "@/core/domain/analysis/setup-signature";
import { activeSetupStore } from "@/infrastructure/persistence/active-setup-store";
import { apiError, HttpError } from "@/shared/server/http";

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
    if (!rawSymbol) return Response.json({ setup: null }, { headers: { "Cache-Control": "no-store" } });
    const symbol = normalizeUsdtSymbol(rawSymbol);
    const signature = url.searchParams.get("signature");
    if (signature !== null && !isSetupSignatureForSymbol(signature, symbol)) {
      throw new HttpError(400, "Invalid selected setup.", "INVALID_SETUP_SIGNATURE");
    }
    if (signature !== null && !activeSetupStore.loadPublished) {
      throw new HttpError(503, "Selected setup unavailable.", "SETUP_STORE_UNAVAILABLE");
    }

    // Returned whatever timeframe the caller happens to be showing. A setup
    // belongs to one chart and cannot be drawn on another, but withholding it
    // when the timeframes differ left a hundred and eight of the hundred and
    // ninety published setups invisible: the chart opened on 15m, the plan
    // lived on 1H, and the page said "No Zone Setup" about a symbol the board
    // was listing. The client reads `timeframe` and moves the chart to it.
    const signal = AbortSignal.timeout(25_000);
    const published = signature === null
      ? (await activeSetupStore.loadActive([symbol], signal))[0]
      : await activeSetupStore.loadPublished?.(symbol, signature, signal);
    if (!published) return Response.json({ setup: null }, { headers: { "Cache-Control": "no-store" } });

    return Response.json(
      { setup: published },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "no-store");
    if (error instanceof HttpError && error.code === "SETUP_STORE_UNAVAILABLE") {
      response.headers.set("Retry-After", "5");
    }
    return response;
  }
}
