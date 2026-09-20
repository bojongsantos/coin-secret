"use client";

import Image from "next/image";
import { useState } from "react";
import { coinIconSources } from "@/core/domain/market/coin-icon";

/**
 * A coin's logo, with the two letters of its ticker as the last resort.
 *
 * Walks the sources in order rather than giving up on the first failure: one
 * CDN missing a coin is common, both missing it is not, and a row of grey
 * initials among real logos reads as a broken board.
 */
export function CoinIcon({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const base = symbol.replace(/USDT$/i, "") || symbol;
  const sources = coinIconSources(base);
  const [failure, setFailure] = useState({ base, index: 0 });
  const index = failure.base === base ? failure.index : 0;
  const src = sources[index];

  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-3 text-[9px] font-extrabold uppercase text-muted"
      style={{ width: size, height: size }}
    >
      {src ? (
        <Image
          key={src}
          src={src}
          alt={`${base} logo`}
          width={size}
          height={size}
          className="size-full object-cover"
          onError={() => setFailure({ base, index: index + 1 })}
        />
      ) : (
        base.slice(0, 2)
      )}
    </span>
  );
}
