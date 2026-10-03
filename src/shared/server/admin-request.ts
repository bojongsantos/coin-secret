import "server-only";
import type { ZodType } from "zod";
import { HttpError, readBoundedJson } from "@/shared/server/http";
import { resolveTrustedOrigins } from "@/shared/lib/trusted-origins";

export async function readAdminMutation<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const origin = request.headers.get("origin");
  const trusted = resolveTrustedOrigins({ appUrl: process.env.BETTER_AUTH_URL ?? new URL(request.url).origin, extra: process.env.TRUSTED_ORIGINS, development: process.env.NODE_ENV !== "production" });
  if (!origin || !trusted.includes(origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Trusted-origin request required.", "INVALID_ORIGIN");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new HttpError(415, "JSON required.", "INVALID_CONTENT_TYPE");
  const parsed = schema.safeParse(await readBoundedJson(request, 4096));
  if (!parsed.success) throw new HttpError(400, "Invalid request data.", "VALIDATION_ERROR");
  return parsed.data;
}

export function adminPage(request: Request) {
  const raw = new URL(request.url).searchParams.get("page") ?? "1";
  if (!/^[1-9]\d{0,5}$/.test(raw)) throw new HttpError(400, "Invalid page.", "INVALID_PAGE");
  const page = Number(raw);
  return { page, skip: (page - 1) * 50, take: 50 };
}
