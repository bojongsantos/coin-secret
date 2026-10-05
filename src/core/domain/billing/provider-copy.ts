/**
 * How each payment provider is described to a buyer.
 *
 * The checkout button and the reassurance line under it both name the
 * processor. Hardcoding "Midtrans" meant switching `PAYMENT_PROVIDER` would
 * leave the page promising a card checkout while sending the buyer to a crypto
 * invoice — the one moment a wrong label costs a sale.
 */
export interface ProviderCopy {
  /** Display name, used mid-sentence and on the button. */
  name: string;
  /** What the buyer should know about how the money is handled. */
  assurance: string;
}

const COPY: Record<string, ProviderCopy> = {
  "nowpayments-sandbox": {
    name: "NOWPayments Sandbox",
    assurance: "Simulasi pembayaran kripto pada database testing terpisah. Jangan mengirim dana sungguhan.",
  },
  midtrans: {
    name: "Midtrans",
    assurance: "Pembayaran diproses Midtrans. CoinSecret tidak menyimpan nomor kartu Anda.",
  },
  nowpayments: {
    name: "NOWPayments",
    assurance:
      "Pembayaran kripto diproses NOWPayments. CoinSecret tidak pernah memegang dana maupun kunci dompet Anda.",
  },
};

/**
 * Copy for a provider, falling back to neutral wording.
 *
 * An unrecognised value names no processor rather than guessing one: checkout
 * will refuse to charge anyway, and a wrong name on the page would be a
 * promise the deployment cannot keep.
 */
export function providerCopy(provider: string): ProviderCopy {
  return (
    COPY[provider] ?? {
      name: "penyedia pembayaran",
      assurance: "Pembayaran diproses oleh penyedia eksternal.",
    }
  );
}
