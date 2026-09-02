import { composeProofImage, type ProofInput } from "@/core/domain/promo/proof-image";
import { requireAdmin } from "@/infrastructure/auth/current-user";
import { wordmarkDataUri } from "@/infrastructure/promo/brand-asset";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError, HttpError } from "@/shared/server/http";

/**
 * Renders the proof image on demand from the stored snapshot data.
 *
 * Composed here rather than saved as markup so a change to the layout applies
 * to the whole archive at once, and so the same candles are not stored three
 * times over.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const setup = await prisma.trackedSetup.findUnique({
      where: { id },
      select: { symbol: true, snapshots: { select: { kind: true, payload: true } } },
    });
    if (!setup) throw new HttpError(404, "Hasil setup tidak ditemukan.", "NOT_FOUND");

    const result = setup.snapshots.find((snapshot) => snapshot.kind === "RESULT");
    const proof = result?.payload as unknown as ProofInput | undefined;
    // The result snapshot carries the whole picture. A row written before that
    // shape existed is not rendered from the wrong data; the next sweep
    // rewrites it.
    if (!proof?.entryFilledTime || !proof.candles?.length) {
      throw new HttpError(409, "Bukti belum tersedia dalam bentuk terbaru.", "INCOMPLETE");
    }

    const svg = composeProofImage({
      ...proof,
      logoHref: (await wordmarkDataUri()) ?? undefined,
    });

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Disposition": `inline; filename="${setup.symbol}-result.svg"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
