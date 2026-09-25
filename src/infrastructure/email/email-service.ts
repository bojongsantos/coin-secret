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
 * Brevo is used rather than a domain-only provider because this deployment has
 * no domain of its own yet: Brevo will send from a single address the operator
 * verified by clicking a link in that inbox, which is the only route available
 * without DNS records to publish.
 *
 * Outside production a missing key logs instead of sending, so local sign-up
 * and password-reset flows stay usable without any mail account at all. In
 * production it raises, because a reset link that is silently never sent looks
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
