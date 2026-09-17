import { getMarketContextPayload } from "@/infrastructure/market-data/market-context-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await getMarketContextPayload();
    return Response.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: "Market context unavailable" },
      { status: 503 },
    );
  }
}
