"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { rangeForTimeframe } from "@/core/application/market-data/history-plan";
import type { Timeframe } from "@/core/domain/models";
import { AnalysisView } from "@/presentation/features/analysis/analysis-view";
import { useLiveAnalysis } from "@/presentation/hooks/use-live-analysis";
import { useT } from "@/presentation/hooks/use-translate";
import { AppShell } from "@/presentation/layout/app-shell";
import { Reveal } from "@/presentation/ui/reveal";

/**
 * One coin, opened on its own.
 *
 * Signals rows open this in a new tab, so the page is just the three blocks the
 * design shows: chart, plan, reasoning. It used to carry a second symbol picker
 * of its own above them, which duplicated the one in the bar and left two
 * search boxes on the same screen disagreeing about what was selected.
 */
export function AnalysisClient({
  initialSymbol,
  initialTimeframe,
}: {
  initialSymbol: string;
  initialTimeframe: Timeframe;
}) {
  const { t } = useT();
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);
  const range = rangeForTimeframe(timeframe);
  const { analysis, error, history, loadMoreHistory, publishedTimeframe } = useLiveAnalysis(
    initialSymbol,
    timeframe,
    range,
  );

  // Move the chart to the interval the published plan was measured on, unless
  // the reader has picked one themselves. Adjusting during render is React's
  // own pattern for state derived from a changing input; an effect would paint
  // the wrong chart first and then correct it.
  const [chosen, setChosen] = useState(false);
  if (publishedTimeframe && publishedTimeframe !== timeframe && !chosen) {
    setTimeframe(publishedTimeframe);
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-4 sm:gap-5">
        {error && (
          <div className="rounded-2xl border border-negative/30 bg-negative/10 px-4 py-3 text-[12.5px] text-negative">
            {error}
          </div>
        )}

        {!analysis && !error && (
          <div className="flex h-72 items-center justify-center text-muted-2">
            <Loader2 className="size-6 animate-spin" />
            <span className="sr-only">{t("common.loadingLive")}</span>
          </div>
        )}

        {analysis && (
          <Reveal className="cs-panel p-4 sm:p-5">
            <AnalysisView
              data={analysis}
              timeframe={timeframe}
              onTimeframeChange={(next) => {
                setChosen(true);
                setTimeframe(next);
              }}
              range={range}
              history={history}
              onLoadMoreHistory={loadMoreHistory}
            />
          </Reveal>
        )}
      </div>
    </AppShell>
  );
}
