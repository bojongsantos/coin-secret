import type { NextRequest } from "next/server";

export function proxy(request: NextRequest): Response | undefined {
  if (process.env.COINSECRET_MIGRATION_PAUSED !== "1") return;
  if (request.method === "GET" && request.nextUrl.pathname === "/api/health") return;
  return new Response("CoinSecret sedang melakukan pemeliharaan database. Silakan coba kembali beberapa menit lagi.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "60" },
  });
}

export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico).*)" };
