import { toNextJsHandler } from "better-auth/next-js";
import { createHash } from "node:crypto";
import { createFixedWindowLimiter } from "@/core/application/rate-limit/fixed-window";
import { auth } from "@/infrastructure/auth/auth";

const handler = toNextJsHandler(auth);
const signInLimiter = createFixedWindowLimiter({ limit: 8, windowMs: 10 * 60_000 });

export const GET = handler.GET;
export async function POST(request: Request) {
  if (new URL(request.url).pathname.endsWith("/sign-in/email")) {
    const body = await request.clone().json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email && email.length <= 254) {
      const key = createHash("sha256").update(email).digest("hex");
      const decision = signInLimiter.check(key);
      if (!decision.allowed) {
        return Response.json(
          { code: "TOO_MANY_REQUESTS", message: "Terlalu banyak percobaan login. Coba lagi nanti." },
          { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
        );
      }
    }
  }
  return handler.POST(request);
}
