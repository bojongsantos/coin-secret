"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ImageIcon, Loader2, X } from "lucide-react";
import { useT } from "@/presentation/hooks/use-translate";
import { AdminFeedback, AdminPagination, isList, useAdminData } from "./admin-data";

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
const validResults = (value: unknown): value is { results: ResultRow[]; page: number; hasMore: boolean } => isList(value, "results");

/**
 * The captured proof archive.
 *
 * Read-only on purpose: the images are produced by the scheduled sweep, not by
 * anyone pressing a button here. Nothing on this page can create or alter a
 * result, only look at what the market actually did.
 */
export function SetupResultsModule() {
  const { t } = useT();
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAdminData(`/api/admin/setup-results?page=${page}`, validResults);
  const rows = loading ? null : (data?.results ?? []);
  const [preview, setPreview] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (preview) dialog.current?.showModal();
    else dialog.current?.close();
  }, [preview]);


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

      <AdminFeedback loading={false} error={error} retry={() => void reload()} />
      <AdminPagination page={page} hasMore={data?.hasMore ?? false} disabled={loading || !!error} change={setPage} />

      {rows === null && (
        <div className="flex h-40 items-center justify-center text-muted-2">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}

      {rows !== null && rows.length === 0 && error === null && (
        <div className="card p-6 text-center text-[12px] text-muted-2">
          Belum ada hasil. Gambar terbentuk sendiri ketika sebuah setup terisi lalu mencapai
          Target 2 — tidak ada yang perlu dijalankan manual.
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-border bg-surface-2/40 text-[10px] uppercase text-muted-2">
                <th className="px-3 py-2 font-semibold">{t("zones.pair")}</th>
                <th className="px-3 py-2 font-semibold">{t("admin.direction")}</th>
                <th className="px-3 py-2 font-semibold">{t("zones.confidence")}</th>
                <th className="px-3 py-2 font-semibold">{t("admin.finished")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("admin.image")}</th>
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

      <dialog ref={dialog} aria-label="Setup result preview" onCancel={() => setPreview(null)} onClose={() => setPreview(null)} onClick={(event) => { if (event.target === event.currentTarget) setPreview(null); }} className="m-auto max-h-[95dvh] max-w-[95vw] overflow-auto rounded-lg bg-surface p-4 text-foreground backdrop:bg-black/80">
        <button type="button" autoFocus aria-label="Close preview" onClick={() => setPreview(null)} className="mb-3 flex items-center gap-2"><X className="size-4" />Close</button>
        {preview && <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Hasil setup" className="max-h-[80dvh] max-w-full rounded-lg" />
        </>}
      </dialog>
    </div>
  );
}
