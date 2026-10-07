import { toNextJsHandler } from "better-auth/next-js";
import { createHash } from "node:crypto";
import { createFixedWindowLimiter } from "@/core/application/rate-limit/fixed-window";
import { auth } from "@/infrastructure/auth/auth";
import { HttpError, readBoundedJson } from "@/shared/server/http";

const handler = toNextJsHandler(auth);
const signInLimiter = createFixedWindowLimiter({ limit: 8, windowMs: 10 * 60_000 });

export const GET = handler.GET;
export async function POST(request: Request) {
  let body: unknown;
  try {
    if (request.body) {
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        throw new HttpError(415, "JSON required.", "INVALID_CONTENT_TYPE");
      }
      body = await readBoundedJson(request, 64 * 1024);
      // Read once instead of teeing an unbounded stream into a clone. The
      // delegated handler receives the same JSON values and request context.
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      // Framework request wrappers may not carry the native constructor's
      // private state. Rebuild from public properties after the bounded read.
      request = new Request(request.url, {
        method: request.method,
        headers,
        body: JSON.stringify(body),
        signal: request.signal,
        credentials: request.credentials,
        cache: request.cache,
        redirect: request.redirect,
        mode: request.mode,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
        integrity: request.integrity,
        keepalive: request.keepalive,
      });
    }
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return Response.json({ code: error.code, message: error.message }, { status: error.status });
  }
  const email = body && typeof body === "object" && "email" in body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (process.env.NODE_ENV === "production" && email.endsWith(".local")) {
    return Response.json({ code: "INVALID_CREDENTIALS", message: "Unable to use this account." }, { status: 400 });
  }
  if (new URL(request.url).pathname.endsWith("/sign-in/email")) {
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
