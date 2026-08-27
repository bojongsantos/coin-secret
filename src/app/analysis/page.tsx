import { AnalysisClient } from "@/presentation/features/analysis/analysis-client";
import { isValidBinanceSymbol, normalizeUsdtSymbol } from "@/core/domain/market/symbol";
import { isTimeframe } from "@/core/domain/market/timeframe";

export const dynamic = "force-dynamic";

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[]; tf?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.symbol) ? params.symbol[0] : params.symbol;
  const candidate = raw ? normalizeUsdtSymbol(raw) : "BTCUSDT";
  const symbol = isValidBinanceSymbol(candidate) ? candidate : "BTCUSDT";

  // The interval the setup was found on travels with the link. Opening every
  // setup on the fastest chart showed an empty plan for a symbol the table had
  // just called a setup, which reads as a broken product rather than as a
  // different timeframe.
  const rawTf = Array.isArray(params.tf) ? params.tf[0] : params.tf;
  const timeframe = isTimeframe(rawTf) ? rawTf : "15m";

  return <AnalysisClient initialSymbol={symbol} initialTimeframe={timeframe} />;
}
