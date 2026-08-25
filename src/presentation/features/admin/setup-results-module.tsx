"use client";

import { useEffect, useState } from "react";
import { Download, ImageIcon, Loader2 } from "lucide-react";

interface ResultRow {
  id: string;
  symbol: string;
  timeframe: string;
  direction: string;
  confidence: number;
  entry: number;
  target2: number;
  resultAt: string;
  firstSeenAt: string;
}

/**
 * The captured proof archive.
 *
 * Read-only on purpose: the images are produced by the scheduled sweep, not by
 * anyone pressing a button here. Nothing on this page can create or alter a
 * result, only look at what the market actually did.
 */
export function SetupResultsModule() {
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/admin/setup-results", { cache: "no-store" });
        const payload = (await response.json()) as { results?: ResultRow[]; error?: { message: string } };
        if (!response.ok) throw new Error(payload.error?.message ?? "Gagal memuat hasil.");
        setRows(payload.results ?? []);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setRows([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">Setup Results</h1>
        <p className="mt-1 text-sm text-muted">
          Bukti hasil setup yang ditangkap otomatis oleh sweep terjadwal: satu gambar sebelum
          entry terisi, satu lagi setelah target kedua tercapai. Siap dipakai sebagai materi
          promosi.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-negative/30 bg-negative/10 px-4 py-3 text-[12px] text-negative">
          {error}
        </p>
      )}

      {rows === null && (
        <div className="flex h-40 items-center justify-center text-muted-2">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}

      {rows !== null && rows.length === 0 && !error && (
        <div className="card p-6 text-center text-[12px] text-muted-2">
          Belum ada hasil. Gambar terbentuk sendiri ketika sebuah setup terisi lalu mencapai
          Target 2 — tidak ada yang perlu dijalankan manual.
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-border bg-surface-2/40 text-[10px] uppercase text-muted-2">
                <th className="px-3 py-2 font-semibold">Pair</th>
                <th className="px-3 py-2 font-semibold">Arah</th>
                <th className="px-3 py-2 font-semibold">Confidence</th>
                <th className="px-3 py-2 font-semibold">Selesai</th>
                <th className="px-3 py-2 text-right font-semibold">Gambar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 last:border-b-0">
                  <td className="px-3 py-2 font-semibold">
                    {row.symbol}
                    <span className="ml-1 text-[10px] font-medium text-muted-2">{row.timeframe}</span>
                  </td>
                  <td className="px-3 py-2 uppercase text-muted">{row.direction}</td>
                  <td className="px-3 py-2 tabular-nums">{row.confidence}%</td>
                  <td className="px-3 py-2 text-muted-2">
                    {new Date(row.resultAt).toLocaleString("id-ID")}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setPreview(`/api/admin/setup-results/${row.id}`)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-3 px-2.5 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:text-foreground"
                      >
                        <ImageIcon className="size-3.5" />
                        Lihat
                      </button>
                      <a
                        href={`/api/admin/setup-results/${row.id}`}
                        download={`${row.symbol}-result.svg`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-3 px-2.5 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:text-foreground"
                      >
                        <Download className="size-3.5" />
                        Unduh
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreview(null)}
          role="presentation"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Hasil setup" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
