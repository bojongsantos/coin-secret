"use client";

import { useEffect, useId, useState } from "react";

const SIZE = 220;
const R = 88;
const STROKE = 34;
const C = 2 * Math.PI * R;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

interface ConvictionRingProps {
  score: number;
}

export function ConvictionRing({ score }: ConvictionRingProps) {
  // A unique gradient id per instance. Pages here can render twice — React's
  // streaming SSR leaves a hidden copy — and `url(#id)` resolves to whichever
  // definition comes first in the document. With a shared id the visible ring
  // reached for the hidden copy's gradient and painted nothing at all.
  const gradientId = useId();
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const duration = 600;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setAnimated(score * easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  const progress = Math.max(0, Math.min(1, animated / 100));
  const dashOffset = C * (1 - progress);

  return (
    <div className="relative flex items-center justify-center" style={{ width: SIZE, height: SIZE }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE}>
        {/* A broad track keeps the score readable at a glance, like the supplied design. */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.045)"
          strokeWidth={STROKE}
        />
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-accent-blue)" />
            <stop offset="100%" stopColor="var(--color-accent)" />
          </linearGradient>
        </defs>
        {/* Flat ends make the filled and remaining portions meet cleanly. */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={STROKE}
          strokeLinecap="butt"
          strokeDasharray={C}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{
            opacity: progress > 0.001 ? 1 : 0,
            transition: "opacity 200ms",
            filter: "drop-shadow(0 5px 9px rgb(77 117 255 / 32%))",
          }}
        />
      </svg>

      {/* Center text — no container, transparent */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[50px] font-bold leading-none tracking-[-0.04em] text-foreground">
          {Math.round(animated)}
        </span>
        <span className="mt-2 text-[17px] font-semibold leading-none text-muted-2">/100</span>
      </div>
    </div>
  );
}
