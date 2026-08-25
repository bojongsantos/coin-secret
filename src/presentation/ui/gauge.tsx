import { arcPath, GAUGE_CX, GAUGE_CY, GAUGE_R, pointAt } from "@/shared/lib/gauge-geometry";

function scoreColor(score: number): string {
  if (score >= 75) return "var(--color-positive)";
  if (score >= 55) return "#84cc16";
  if (score >= 35) return "var(--color-warning)";
  return "var(--color-negative)";
}

interface GaugeProps {
  score: number;
  label?: string;
  width?: number;
}

export function Gauge({ score, label, width = 210 }: GaugeProps) {
  const height = width * 0.58 + 46;
  const color = scoreColor(score);
  const needleTip = pointAt(score, GAUGE_R - 34);
  const needleBase = pointAt(score, 5);

  return (
    <div className="relative inline-flex flex-col items-center justify-center" style={{ width, height }}>
      {/* No transform on the group: the viewBox already maps these 200 units
          onto `width`, and scaling again pushed the arc past the right and
          bottom edges where it was clipped. */}
      <svg viewBox="0 0 200 116" width={width} height={width * 0.58}>
        <g>
          <path d={arcPath(0, 100, GAUGE_R)} fill="none" stroke="var(--color-surface-3)" strokeWidth={11} strokeLinecap="round" />
          <path
            d={arcPath(0, score, GAUGE_R)}
            fill="none"
            stroke={color}
            strokeWidth={11}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 400ms ease" }}
          />
          {[0, 25, 50, 75, 100].map((t) => {
            const inner = pointAt(t, GAUGE_R - 7);
            const outer = pointAt(t, GAUGE_R + 7);
            return (
              <line
                key={t}
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke="var(--color-border-strong)"
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })}
          <line
            x1={needleBase.x}
            y1={needleBase.y}
            x2={needleTip.x}
            y2={needleTip.y}
            stroke="var(--color-foreground)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <circle cx={GAUGE_CX} cy={GAUGE_CY} r={5} fill="var(--color-foreground)" />
          <circle cx={GAUGE_CX} cy={GAUGE_CY} r={2.5} fill="var(--color-background)" />
        </g>
      </svg>
      <div className="z-10 flex flex-col items-center leading-none">
        <span className="mt-2 text-2xl font-bold">{score}</span>
        <span className="mt-1 text-[11px] font-medium uppercase text-muted">{label ?? "Neutral"}</span>
      </div>
    </div>
  );
}
