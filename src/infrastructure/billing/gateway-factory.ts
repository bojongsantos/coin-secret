import "server-only";

import type { BillingGateway } from "@/core/application/ports/billing-gateway";
import { DEFAULT_PAYMENT_PROVIDER } from "@/core/domain/billing/providers";
import { MidtransGateway } from "@/infrastructure/billing/midtrans/gateway";
import { NowPaymentsGateway } from "@/infrastructure/billing/nowpayments/gateway";
import { HttpError } from "@/shared/server/http";

/** The provider this deployment charges with. */
export function selectedPaymentProvider(): string {
  return process.env.PAYMENT_PROVIDER ?? DEFAULT_PAYMENT_PROVIDER;
}

function missing(variable: string): never {
  throw new HttpError(503, `${variable} belum dikonfigurasi.`, "PAYMENT_NOT_CONFIGURED");
}

/** Simulated settlements must never reach the production application/database. */
function requireIsolatedSandbox(): void {
  let isolated = false;
  try {
    const database = new URL(process.env.DATABASE_URL ?? "");
    isolated = ["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) &&
      /_(sandbox|test)$/.test(database.pathname);
  } catch { /* Invalid configuration fails closed. */ }
  if (process.env.NODE_ENV === "production" || !isolated) {
    throw new HttpError(503, "Sandbox pembayaran memerlukan aplikasi development dan database lokal terpisah berakhiran _sandbox atau _test.", "SANDBOX_NOT_ISOLATED");
  }
}

/**
 * Builds a payment gateway.
 *
 * Lives apart from any single adapter so adding a provider never requires
 * editing another provider's file. Called without an argument it returns the
 * provider this deployment charges with; a webhook route passes its own name
 * instead, because a callback must be verified by the adapter that signed it
 * and not by whichever provider happens to be selected today. Without that,
 * switching `PAYMENT_PROVIDER` would silently start rejecting the callbacks of
 * orders that are still open with the old provider.
 *
 * An unknown or unconfigured value refuses to charge rather than falling back
 * to something the operator did not ask for.
 */
export function getBillingGateway(provider: string = selectedPaymentProvider()): BillingGateway {
  switch (provider) {
    case "midtrans": {
      const serverKey = process.env.MIDTRANS_SERVER_KEY;
      if (!serverKey) missing("MIDTRANS_SERVER_KEY");
      const production = process.env.MIDTRANS_IS_PRODUCTION === "true";
      if (!production) requireIsolatedSandbox();
      return new MidtransGateway(serverKey, production);
    }
    case "nowpayments":
    case "nowpayments-sandbox": {
      const sandbox = provider === "nowpayments-sandbox";
      if (sandbox) requireIsolatedSandbox();
      const prefix = sandbox ? "NOWPAYMENTS_SANDBOX" : "NOWPAYMENTS";
      const apiKey = process.env[`${prefix}_API_KEY`];
      if (!apiKey) missing(`${prefix}_API_KEY`);
      const ipnSecret = process.env[`${prefix}_IPN_SECRET`];
      if (!ipnSecret) missing(`${prefix}_IPN_SECRET`);
      // The provider calls back to us and returns the buyer here afterwards,
      // so it needs an address reachable from outside this process.
      const publicUrl = process.env.BETTER_AUTH_URL;
      if (!publicUrl) missing("BETTER_AUTH_URL");
      return new NowPaymentsGateway({
        apiKey,
        ipnSecret,
        publicUrl: publicUrl.replace(/\/+$/, ""),
        sandbox,
      });
    }
    default:
      throw new HttpError(
        503,
        `PAYMENT_PROVIDER "${provider}" tidak didukung.`,
        "PAYMENT_NOT_CONFIGURED",
      );
  }
}
