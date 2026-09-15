import type { Metadata } from "next";
import { SignalsClient } from "@/presentation/features/signals/signals-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Signals — Coin Secret",
  description: "Live supply and demand setups across the whole board.",
};

export default function SignalsPage() {
  return <SignalsClient />;
}
