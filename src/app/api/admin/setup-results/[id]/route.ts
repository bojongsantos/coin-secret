import { composePnlCard } from "@/core/domain/promo/pnl-card";
import type { ProofInput } from "@/core/domain/promo/proof-image";
import { requireAdmin } from "@/infrastructure/auth/current-user";
import { wordmarkDataUri } from "@/infrastructure/promo/brand-asset";
import { coinIconDataUri } from "@/infrastructure/promo/coin-asset";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError, HttpError } from "@/shared/server/http";

/**
 * Renders the result card on demand from the stored snapshot data.
 *
 * Composed here rather than saved as markup so a change to the layout applies
 * to the whole archive at once, and so the same candles are not stored three
 * times over. The stored payload is unchanged from the two-panel image this
 * replaced — it already carried every figure the card states, so the archive
 * did not have to be rewritten to change what it looks like.
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

    const svg = composePnlCard({
      symbol: proof.symbol,
      // Only setups that reached the second target are archived, so a stored
      // result is a win by construction. The losing branch exists for the
      // share button, which can be handed any finished setup.
      outcome: "target",
      direction: proof.direction,
      entryPrice: proof.entryFilledPrice,
      exitPrice: proof.targetReachedPrice,
      confidence: proof.confidence,
      riskReward: proof.riskReward,
      entryTime: proof.entryFilledTime,
      exitTime: proof.targetReachedTime,
      logoHref: (await wordmarkDataUri()) ?? undefined,
      coinIconHref: (await coinIconDataUri(proof.symbol)) ?? undefined,
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
