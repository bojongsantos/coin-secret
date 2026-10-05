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
import { checkoutFailure, paymentJson, safeCheckoutUrl } from "@/infrastructure/billing/provider-http";

const API_BASE = "https://api.nowpayments.io/v1";
const SANDBOX_API_BASE = "https://api-sandbox.nowpayments.io/v1";

export interface NowPaymentsConfig {
  apiKey: string;
  ipnSecret: string;
  /** Public origin of this deployment, used to build callback and return URLs. */
  publicUrl: string;
  sandbox?: boolean;
}

export class NowPaymentsGateway implements BillingGateway {
  readonly id: string;

  constructor(private readonly config: NowPaymentsConfig) {
    this.id = config.sandbox ? "nowpayments-sandbox" : "nowpayments";
  }

  /**
   * Creates a hosted invoice and hands back its page.
   *
   * The invoice endpoint is used rather than the raw payment endpoint because
   * it lets NOWPayments host the coin picker and the address/QR screen. Doing
   * it in-app would mean rebuilding an expiring quote, a live exchange rate,
   * and a confirmation counter for every supported coin.
   */
  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    const response = await paymentJson(`${this.config.sandbox ? SANDBOX_API_BASE : API_BASE}/invoice`, {
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
        ipn_callback_url: `${this.config.publicUrl}/api/billing/webhook/${this.id}`,
        success_url: `${this.config.publicUrl}/account?payment=success`,
        cancel_url: `${this.config.publicUrl}/pricing?payment=canceled`,
      }),
    });

    const data = response.data as {
      id?: string | number;
      invoice_url?: string;
      message?: string;
    } | null;

    if (!response.ok) throw checkoutFailure(response.status);
    const redirectUrl = safeCheckoutUrl(data?.invoice_url, this.config.sandbox
      ? ["sandbox.nowpayments.io", "nowpayments.io"] : ["nowpayments.io", "www.nowpayments.io"]);
    if (!redirectUrl || (typeof data?.id !== "string" && typeof data?.id !== "number") || !String(data.id)) {
      throw new HttpError(502, "Jawaban gateway tidak lengkap. Pembayaran perlu diperiksa sebelum dicoba kembali.", "PAYMENT_GATEWAY_UNCERTAIN");
    }
    return { reference: String(data.id), redirectUrl };
  }

  async readPaymentStatus(paymentId: string): Promise<PaymentEvent> {
    if (!/^\d{1,30}$/.test(paymentId)) throw new HttpError(400, "Payment ID tidak valid.", "INVALID_PAYMENT_ID");
    const response = await paymentJson(`${this.config.sandbox ? SANDBOX_API_BASE : API_BASE}/payment/${paymentId}`, {
      headers: { "x-api-key": this.config.apiKey, Accept: "application/json" },
    });
    if (!response.ok) throw new HttpError(502, "Status provider belum dapat diverifikasi dengan akun API ini.", "PAYMENT_STATUS_UNAVAILABLE");
    const result = ipnSchema.safeParse(response.data);
    if (!result.success || String(result.data.payment_id) !== paymentId || !result.data.price_currency) {
      throw new HttpError(502, "Jawaban status provider tidak valid.", "INVALID_PAYMENT_STATUS");
    }
    return toPaymentEvent(result.data);
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
