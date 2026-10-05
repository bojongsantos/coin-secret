import "server-only";

import type {
  BillingGateway,
  CheckoutRequest,
  CheckoutResult,
  NotificationInput,
  PaymentEvent,
} from "@/core/application/ports/billing-gateway";
import {
  midtransSignature,
  notificationSchema,
  signatureMatches,
  toPaymentEvent,
} from "@/infrastructure/billing/midtrans/protocol";
import { HttpError } from "@/shared/server/http";
import { checkoutFailure, paymentJson, safeCheckoutUrl } from "@/infrastructure/billing/provider-http";

export class MidtransGateway implements BillingGateway {
  readonly id = "midtrans";

  constructor(
    private readonly serverKey: string,
    private readonly production: boolean,
  ) {}

  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    if (input.currency !== "IDR") {
      throw new HttpError(500, "Midtrans hanya dapat menagih dalam IDR.", "PAYMENT_CURRENCY_ERROR");
    }
    const base = this.production ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com";
    const response = await paymentJson(`${base}/snap/v1/transactions`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${this.serverKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transaction_details: { order_id: input.orderId, gross_amount: input.amount },
        item_details: [
          {
            id: "coinsecret-premium",
            price: input.amount,
            quantity: 1,
            name: input.description,
          },
        ],
        customer_details: { first_name: input.customer.name, email: input.customer.email },
        expiry: { unit: "hours", duration: 24 },
      }),
    });
    const data = response.data as {
      token?: string;
      redirect_url?: string;
      error_messages?: string[];
    };
    if (!response.ok) throw checkoutFailure(response.status);
    const redirectUrl = safeCheckoutUrl(data?.redirect_url, [new URL(base).hostname]);
    if (!redirectUrl || typeof data?.token !== "string" || !data.token) {
      throw new HttpError(502, "Jawaban gateway tidak lengkap. Pembayaran perlu diperiksa sebelum dicoba kembali.", "PAYMENT_GATEWAY_UNCERTAIN");
    }
    return { reference: data.token, redirectUrl };
  }

  /** Midtrans signs the body, so the headers carry nothing to verify here. */
  parseAndVerifyNotification(input: NotificationInput): PaymentEvent {
    const result = notificationSchema.safeParse(input.payload);
    if (!result.success) throw new HttpError(400, "Payload webhook tidak valid.", "INVALID_WEBHOOK");
    const data = result.data;

    const expected = midtransSignature({
      orderId: data.order_id,
      statusCode: data.status_code,
      grossAmount: data.gross_amount,
      serverKey: this.serverKey,
    });
    if (!signatureMatches(data.signature_key, expected)) {
      throw new HttpError(401, "Tanda tangan webhook tidak valid.", "INVALID_SIGNATURE");
    }

    return toPaymentEvent(data);
  }
}
