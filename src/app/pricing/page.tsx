import type { Metadata } from "next";
import { getCurrentUser } from "@/infrastructure/auth/current-user";
import { prisma } from "@/infrastructure/database/prisma";
import { providerCopy } from "@/core/domain/billing/provider-copy";
import { selectedPaymentProvider } from "@/infrastructure/billing/gateway-factory";
import { PricingModule } from "@/presentation/features/pricing/pricing-module";
import { AppShell } from "@/presentation/layout/app-shell";
import { billingQuote } from "@/core/domain/billing/plans";

export const metadata: Metadata = {
  title: "Pricing · Coin Secret",
  description: "Perbandingan paket Free dan Pro Coin Secret.",
};

export default async function PricingPage() {
  const user = await getCurrentUser();
  const subscription = user
    ? await prisma.subscription.findUnique({
        where: { userId: user.id },
        select: { currentPeriodEnd: true },
      })
    : null;

  const paymentProvider = selectedPaymentProvider();
  const midtransMonthlyIdr = Number(process.env.PREMIUM_PRICE_IDR);
  const quotes = {
    monthly: billingQuote("monthly", paymentProvider, midtransMonthlyIdr),
    sixMonth: billingQuote("sixMonth", paymentProvider, midtransMonthlyIdr),
    annual: billingQuote("annual", paymentProvider, midtransMonthlyIdr),
  };

  return (
    <AppShell>
      <PricingModule
        authenticated={user !== null}
        plan={user?.plan ?? null}
        periodEnd={subscription?.currentPeriodEnd?.toISOString() ?? null}
        provider={providerCopy(paymentProvider)}
        quotes={quotes}
      />
    </AppShell>
  );
}
