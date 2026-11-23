import { readNewsImage } from "@/infrastructure/news/images";
import { apiError } from "@/shared/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const image = await readNewsImage((await params).id);
    if (!image) return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    return new Response(new Uint8Array(image.data), { headers: {
      "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": "inline",
    } });
  } catch (error) { return apiError(error); }
}
