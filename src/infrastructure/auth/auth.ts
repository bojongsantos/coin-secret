import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/infrastructure/database/prisma";
import { sendTransactionalEmail } from "@/infrastructure/email/email-service";
import { localIPv4Addresses } from "@/infrastructure/auth/local-addresses";
import { resolveTrustedOrigins } from "@/shared/lib/trusted-origins";

const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const development = process.env.NODE_ENV !== "production";

export const auth = betterAuth({
  appName: "CoinSecret",
  baseURL: appUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  // A deployment can answer on more than one origin — the current domain and
  // the one it was renamed from. Naming only `appUrl` here made every sign-in
  // from the other domain fail as "Invalid origin".
  trustedOrigins: resolveTrustedOrigins({
    appUrl,
    extra: process.env.TRUSTED_ORIGINS,
    development,
    lanAddresses: development ? localIPv4Addresses() : [],
  }),
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      const code = new URL(url).pathname.split("/").at(-1) ?? "";
      await sendTransactionalEmail({
        to: user.email,
        subject: "Reset password CoinSecret",
        html: `<p>Buka coinsecret.io/reset-password di browser, lalu masukkan kode reset berikut:</p><p><code>${code}</code></p><p>Kode ini hanya untuk mengatur ulang password akun Anda. Jika Anda tidak meminta reset, abaikan email ini.</p>`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const code = new URL(url).searchParams.get("token") ?? "";
      await sendTransactionalEmail({
        to: user.email,
        subject: "Verifikasi email CoinSecret",
        html: `<p>Buka coinsecret.io/verify-email di browser, lalu masukkan kode verifikasi berikut:</p><p><code>${code}</code></p><p>Jika Anda tidak mendaftar CoinSecret, abaikan email ini.</p>`,
      });
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        defaultValue: "USER",
        input: false,
      },
      plan: {
        type: "string",
        required: true,
        defaultValue: "FREE",
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 60 },
      "/sign-up/email": { window: 60 * 10, max: 5 },
      "/request-password-reset": { window: 60 * 10, max: 3 },
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    cookiePrefix: "coinsecret",
    ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
  },
});

export type AuthSession = typeof auth.$Infer.Session;
