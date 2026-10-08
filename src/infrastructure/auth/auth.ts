import "server-only";

import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP } from "better-auth/plugins";
import { prisma } from "@/infrastructure/database/prisma";
import { sendTransactionalEmail } from "@/infrastructure/email/email-service";
import { localIPv4Addresses } from "@/infrastructure/auth/local-addresses";
import { resolveTrustedOrigins } from "@/shared/lib/trusted-origins";
import { passwordResetThrottle } from "@/infrastructure/auth/password-reset-throttle";
import { z } from "zod";

const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const development = process.env.NODE_ENV !== "production";

export const auth = betterAuth({
  appName: "CoinSecret",
  baseURL: appUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  // Recovery and registration use separate OTP namespaces. Disable the old
  // token flow and passwordless sign-in so recovery never creates a session.
  disabledPaths: [
    "/email-otp/check-verification-otp",
    "/sign-in/email-otp",
    "/forget-password/email-otp",
    "/request-password-reset",
    "/reset-password",
    "/email-otp/request-email-change",
    "/email-otp/change-email",
  ],
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
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path.startsWith("/reset-password/")) throw new APIError("NOT_FOUND", { message: "Not found." });
      const action = ctx.path === "/email-otp/request-password-reset" ||
        (ctx.path === "/email-otp/send-verification-otp" && ctx.body?.type === "forget-password")
        ? "send" : ctx.path === "/email-otp/reset-password" ? "verify" : null;
      if (!action) return;
      const email = typeof ctx.body?.email === "string" ? ctx.body.email.trim().toLowerCase() : "";
      if (email.length > 254 || !z.email().safeParse(email).success) {
        throw new APIError("BAD_REQUEST", { message: "Invalid email address." });
      }
      ctx.body.email = email;
      if (action === "verify" && (typeof ctx.body?.otp !== "string" || !/^\d{6}$/.test(ctx.body.otp))) {
        throw new APIError("BAD_REQUEST", { message: "Enter the 6-digit reset code." });
      }
      const retryAfter = await passwordResetThrottle(email, action);
      if (retryAfter) {
        throw new APIError("TOO_MANY_REQUESTS", { message: "Too many reset requests. Please wait before trying again." }, { "Retry-After": String(retryAfter) });
      }
    }),
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    autoSignIn: false,
    revokeSessionsOnPasswordReset: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: false,
    autoSignInAfterVerification: false,
  },
  plugins: [emailOTP({
    overrideDefaultEmailVerification: true,
    disableSignUp: true,
    otpLength: 6,
    expiresIn: 300,
    allowedAttempts: 5,
    storeOTP: "encrypted",
    async sendVerificationOTP({ email, otp, type }) {
      if (type === "forget-password") {
        await sendTransactionalEmail({
          to: email,
          subject: "Reset password CoinSecret",
          html: `<p>Masukkan kode reset 6 angka berikut pada halaman CoinSecret yang sedang Anda buka:</p><p style="font-size:28px;letter-spacing:6px"><strong>${otp}</strong></p><p>Kode berlaku 5 menit dan hanya dapat dipakai sekali. Jika Anda tidak meminta reset password, abaikan email ini.</p>`,
        });
        return;
      }
      if (type !== "email-verification") return;
      await sendTransactionalEmail({
        to: email,
        subject: "Verifikasi email CoinSecret",
        html: `<p>Buka coinsecret.io/verify-email di browser, lalu masukkan kode verifikasi 6 angka berikut:</p><p style="font-size:28px;letter-spacing:6px"><strong>${otp}</strong></p><p>Kode berlaku 5 menit. Jika Anda tidak mendaftar CoinSecret, abaikan email ini.</p>`,
      });
    },
  })],
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
    expiresIn: 60 * 60 * 24,
    // updatedAt is advanced only by our explicit interaction endpoint.
    // Passive reads must not keep an unattended account signed in.
    disableSessionRefresh: true,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 60 },
      "/sign-up/email": { window: 60 * 10, max: 5 },
      "/email-otp/request-password-reset": { window: 60 * 10, max: 3 },
      "/email-otp/send-verification-otp": { window: 60 * 10, max: 3 },
      "/email-otp/reset-password": { window: 60 * 5, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    cookiePrefix: "coinsecret",
    ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
  },
});

export type AuthSession = typeof auth.$Infer.Session;
