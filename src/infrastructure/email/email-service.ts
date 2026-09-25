import "server-only";

import {
  BREVO_ENDPOINT,
  brevoErrorMessage,
  brevoPayload,
  type EmailMessage,
} from "@/infrastructure/email/brevo";

export type { EmailMessage };

/**
 * Sends one transactional email through Brevo.
 *
 * Brevo sends from the verified CoinSecret domain configured in EMAIL_FROM.
 *
 * Outside production a missing key logs instead of sending, so local sign-up
 * and password-reset flows stay usable without any mail account at all. In
 * production it raises, because a reset code that is silently never sent looks
 * exactly like a working reset to the person waiting for it.
 */
export async function sendTransactionalEmail(message: EmailMessage): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("BREVO_API_KEY dan EMAIL_FROM wajib untuk email production.");
    }
    console.info(`[Coin Secret email] ${message.subject} -> ${message.to}`);
    return;
  }

  const response = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(brevoPayload(message, { email: from, name: "CoinSecret" })),
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(brevoErrorMessage(response.status, body));
  }
}
