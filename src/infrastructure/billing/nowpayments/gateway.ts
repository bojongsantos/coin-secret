import "server-only";

import type {
  BillingGateway,
  CheckoutRequest,
  CheckoutResult,
  NotificationInput,
  PaymentEvent,
} from "@/core/application/ports/billing-gateway";
import {
  ipnSchema,
  ipnSignature,
  SIGNATURE_HEADER,
  signatureMatches,
  toPaymentEvent,
} from "@/infrastructure/billing/nowpayments/protocol";
import { HttpError } from "@/shared/server/http";

const API_BASE = "https://api.nowpayments.io/v1";

export interface NowPaymentsConfig {
  apiKey: string;
  ipnSecret: string;
  /** Public origin of this deployment, used to build callback and return URLs. */
  publicUrl: string;
}

export class NowPaymentsGateway implements BillingGateway {
  readonly id = "nowpayments";

  constructor(private readonly config: NowPaymentsConfig) {}

  /**
   * Creates a hosted invoice and hands back its page.
   *
   * The invoice endpoint is used rather than the raw payment endpoint because
   * it lets NOWPayments host the coin picker and the address/QR screen. Doing
   * it in-app would mean rebuilding an expiring quote, a live exchange rate,
   * and a confirmation counter for every supported coin.
   */
  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    const response = await fetch(`${API_BASE}/invoice`, {
      method: "POST",
      headers: {
        "x-api-key": this.config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        price_amount: input.amount,
        price_currency: input.currency.toLowerCase(),
        order_id: input.orderId,
        order_description: input.description,
        ipn_callback_url: `${this.config.publicUrl}/api/billing/webhook/nowpayments`,
        success_url: `${this.config.publicUrl}/account?payment=success`,
        cancel_url: `${this.config.publicUrl}/pricing?payment=canceled`,
      }),
    });

    const data = (await response.json().catch(() => null)) as {
      id?: string | number;
      invoice_url?: string;
      message?: string;
    } | null;

    if (!response.ok || !data?.invoice_url || data.id === undefined) {
      // NOWPayments explains a rejected price currency in `message`, and that
      // is the failure an operator is most likely to meet first, so it is
      // surfaced rather than flattened into a generic gateway error.
      throw new HttpError(
        502,
        data?.message ?? "Gateway pembayaran tidak tersedia.",
        "PAYMENT_GATEWAY_ERROR",
      );
    }

    return { reference: String(data.id), redirectUrl: data.invoice_url };
  }

  /** NOWPayments signs the body but delivers the digest in a header. */
  parseAndVerifyNotification(input: NotificationInput): PaymentEvent {
    const supplied = input.headers.get(SIGNATURE_HEADER);
    if (!supplied) {
      throw new HttpError(401, "Tanda tangan webhook tidak ada.", "INVALID_SIGNATURE");
    }

    const result = ipnSchema.safeParse(input.payload);
    if (!result.success) throw new HttpError(400, "Payload webhook tidak valid.", "INVALID_WEBHOOK");

    // Signed over the payload as received, so the raw object is hashed rather
    // than the parsed one: Zod strips nothing here, but re-serialising a
    // rebuilt object would still risk changing what gets hashed.
    const expected = ipnSignature(
      input.payload as Record<string, unknown>,
      this.config.ipnSecret,
    );
    if (!signatureMatches(supplied, expected)) {
      throw new HttpError(401, "Tanda tangan webhook tidak valid.", "INVALID_SIGNATURE");
    }

    return toPaymentEvent(result.data);
  }
}
