"use client";
/* eslint-disable @next/next/no-img-element -- Admin previews share the editorial image URL without a server-side proxy. */
import { useId, useState } from "react";
import { LoaderCircle, Upload } from "lucide-react";
import { z } from "zod";
import { safeArticleImageUrl } from "@/core/domain/news/content";
import { adminJson } from "./admin-data";

const uploadedImage = z.object({ image: z.object({ url: z.string().max(2000).refine(safeArticleImageUrl), width: z.number().int().positive(), height: z.number().int().positive() }) });
const acceptedTypes = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const inputClass = "mt-2 w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm text-foreground";

export function NewsImageInput({ label, url, alt, disabled, changeUrl, changeAlt, onBusy }: {
  readonly label: string;
  readonly url: string;
  readonly alt: string;
  readonly disabled: boolean;
  readonly changeUrl: (url: string) => void;
  readonly changeAlt: (alt: string) => void;
  readonly onBusy: (busy: boolean) => void;
}) {
  const id = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  async function upload(file: File) {
    setError(null); setNotice("");
    if (!acceptedTypes.includes(file.type) || file.size === 0 || file.size > 8 * 1024 * 1024) {
      setError("Choose a JPG, PNG, WebP or AVIF image up to 8 MB."); return;
    }
    setUploading(true); onBusy(true);
    try {
      const payload = await adminJson<unknown>("/api/admin/news/images", { method: "POST", headers: { "Content-Type": file.type }, body: file, signal: AbortSignal.timeout(30_000) });
      const result = uploadedImage.safeParse(payload);
      if (!result.success) throw new Error("The image upload returned an invalid response.");
      changeUrl(result.data.image.url);
      setNotice(`Uploaded and optimized · ${result.data.image.width} × ${result.data.image.height}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to upload the image."); }
    finally { setUploading(false); onBusy(false); }
  }
  return <div className="space-y-4 rounded-xl border border-border p-4">
    <p className="text-sm font-semibold">{label}</p>
    <label htmlFor={`${id}-file`} className="flex items-center gap-2 text-sm font-medium">{uploading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Upload aria-hidden="true" className="size-4" />}Upload from device</label>
    <input id={`${id}-file`} type="file" accept={acceptedTypes.join(",")} disabled={disabled || uploading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} className="block w-full min-w-0 text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface-3 file:px-3 file:py-2 file:text-foreground" />
    <p className="text-xs text-muted">JPG, PNG, WebP or AVIF, up to 8 MB. Images are resized automatically without stretching.</p>
    <label className="block text-sm font-medium">{label} URL <span className="text-muted">(or paste a link)</span><input type="text" inputMode="url" className={inputClass} disabled={disabled || uploading} value={url} maxLength={2000} placeholder="https://…" onChange={(event) => { changeUrl(event.target.value); setNotice(""); }} /></label>
    <label className="block text-sm font-medium">{label} description<input className={inputClass} disabled={disabled || uploading} value={alt} maxLength={180} placeholder="Describe what the image shows" onChange={(event) => changeAlt(event.target.value)} /><span className="mt-2 block text-xs text-muted">A short description helps readers using assistive technology.</span></label>
    {url && safeArticleImageUrl(url) && <div className="overflow-hidden rounded-lg border border-border bg-surface-3"><img src={url} alt={alt || "Image preview"} referrerPolicy="no-referrer" className="mx-auto max-h-72 w-full object-contain" /></div>}
    <div aria-live="polite">{uploading && <p role="status" className="text-sm text-muted">Uploading and optimizing image…</p>}{notice && <p className="text-sm text-positive">{notice}</p>}{error && <p role="alert" className="text-sm text-negative">{error}</p>}</div>
  </div>;
}
