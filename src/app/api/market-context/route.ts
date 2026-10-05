import { getMarketContextPayload } from "@/infrastructure/market-data/market-context-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await getMarketContextPayload();
    return Response.json(payload, {
      // The service owns its bounded snapshot cache. A CDN must not keep an
      // expired successful response after the live service becomes unavailable.
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: "Market context unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
