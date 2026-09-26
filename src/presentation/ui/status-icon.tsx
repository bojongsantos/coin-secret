import Image from "next/image";

const STATUS_MARK: Record<string, string> = {
  "Limit Order": "limit-order",
  Filled: "filled",
  Running: "running",
  "Target 1 reached": "target-1-reached",
  "Target 2 reached": "target-1-reached",
  "Invalidated (SL hit)": "bearish",
  Missed: "bearish",
  Bullish: "bullish",
  Bearish: "bearish",
};

export function StatusIcon({ status, size = 18 }: { status: string; size?: number }) {
  const mark = STATUS_MARK[status];
  if (!mark) return null;
  return <Image src={`/icons/status/${mark}.png`} alt="" width={size} height={size} unoptimized className="shrink-0 object-contain" />;
}
