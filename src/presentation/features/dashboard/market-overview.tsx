"use client";

import { Activity } from "lucide-react";
import type { AnalysisResult, MarketContext, SentimentData } from "@/core/domain/models";
import { buildConviction, type ConvictionScore } from "@/core/domain/analysis/conviction";
import { useT } from "@/presentation/hooks/use-translate";
import { Panel } from "@/presentation/features/dashboard/panel";
import { ConvictionScoreCard } from "@/presentation/widgets/right-rail/conviction-score-card";
import { MarketContextCard } from "@/presentation/widgets/right-rail/market-context-card";
import { MarketSentimentCard } from "@/presentation/widgets/right-rail/market-sentiment-card";
import { marketFallback, sentimentFallback } from "@/config/market-fallbacks";

const WAITING: ConvictionScore = { score: 0, grade: "F", interpretation: "", components: [] };

/**
 * The confidence ring for the setup currently on the chart.
 *
 * Built from the setup's own zone rather than from its headline confidence
 * alone, so the four contributions the card breaks out are the ones that
 * actually produced the number.
 */
function convictionFor(analysis: AnalysisResult | null | undefined): ConvictionScore {
  if (!analysis) return WAITING;
  const shape = analysis.pattern.shape;
  const setup = shape?.setup;
  const zone = shape?.zones?.find((z) => z.id === setup?.zoneId) ?? shape?.zones?.[0];
  if (!zone) return buildConviction({ confidence: analysis.pattern.confidence });
  return buildConviction({
    confidence: setup?.confidence ?? zone.confidence,
    narrowness: zone.narrowness,
    strength: zone.strength,
    touches: zone.touches,
  });
}

/**
 * Sentiment, context and confidence, side by side.
 *
 * These used to live in a right rail that the redesign removed. They are the
 * state of the market rather than of one chart, which is why they now open the
 * page instead of sitting beside it.
 */
export function MarketOverview({
  context,
  sentiment,
  analysis,
  onRefresh,
  refreshing,
}: {
  context: MarketContext | null;
  sentiment: SentimentData | null;
  analysis?: AnalysisResult | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { t } = useT();
  return (
    <Panel
      title={t("dashboard.marketOverview")}
      icon={<Activity className="size-5 text-accent-blue" />}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <MarketSentimentCard data={sentiment ?? sentimentFallback} />
        <MarketContextCard data={context ?? marketFallback} />
        <ConvictionScoreCard data={convictionFor(analysis)} />
      </div>
    </Panel>
  );
}
