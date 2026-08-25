import { composeResultImage, type SnapshotInput } from "@/core/domain/promo/result-image";
import { requireAdmin } from "@/infrastructure/auth/current-user";
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

    const entry = setup.snapshots.find((snapshot) => snapshot.kind === "ENTRY");
    const result = setup.snapshots.find((snapshot) => snapshot.kind === "RESULT");
    if (!entry || !result) {
      throw new HttpError(409, "Snapshot belum lengkap.", "INCOMPLETE");
    }

    const svg = composeResultImage({
      symbol: setup.symbol,
      entry: entry.payload as unknown as SnapshotInput,
      result: result.payload as unknown as SnapshotInput,
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
