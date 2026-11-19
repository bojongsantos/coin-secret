"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Eye, Pencil, Save } from "lucide-react";
import { articleFields, articleSlug, type Article, type ArticleFields, type ArticleStatus } from "@/core/domain/news/article";
import { adminJson } from "@/presentation/features/admin/admin-data";
import { ArticleView } from "@/presentation/features/news/article-view";

const emptyFields: ArticleFields = { title: "", slug: "", summary: "", body: "", category: "News", coverUrl: "", coverAlt: "", seoTitle: "", seoDescription: "", status: "DRAFT" };
const fieldClass = "mt-2 w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm text-foreground outline-none";
export function NewsEditor({ id }: { id?: string }) {
  const router = useRouter();
  const [article, setArticle] = useState<Article | null>(null);
  const [fields, setFields] = useState<ArticleFields>(emptyFields);
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const loadedId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!id || (loadedId.current === id && article?.id === id)) return;
    const controller = new AbortController();
    adminJson<{ article: Article }>(`/api/admin/news/${id}`, { signal: controller.signal }).then(({ article: loaded }) => {
      setArticle(loaded);
      loadedId.current = loaded.id;
      const { title, slug, summary, body, category, coverUrl, coverAlt, seoTitle, seoDescription, status } = loaded;
      setFields({ title, slug, summary, body, category, coverUrl, coverAlt, seoTitle, seoDescription, status });
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load article."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, article?.id]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function change<K extends keyof ArticleFields>(key: K, value: ArticleFields[K]) {
    setFields((previous) => ({ ...previous, [key]: value })); setDirty(true); setNotice("");
  }
  function insertFormat(prefix: string, suffix = "") {
    const textarea = bodyRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    change("body", fields.body.slice(0, start) + prefix + (fields.body.slice(start, end) || "Text") + suffix + fields.body.slice(end));
    textarea.focus();
  }
  async function save(status: ArticleStatus) {
    setError(null); setNotice("");
    const candidate = { ...fields, status, slug: fields.slug || articleSlug(fields.title) };
    const parsed = articleFields.safeParse(candidate);
    if (!parsed.success) { setError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" ")); return; }
    setBusy(true);
    try {
      const currentId = article?.id ?? id;
      const payload = currentId ? { fields: parsed.data, version: article?.version } : parsed.data;
      const result = await adminJson<{ article: Article }>(currentId ? `/api/admin/news/${currentId}` : "/api/admin/news", {
        method: currentId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000),
      });
      setArticle(result.article); setFields(parsed.data); setDirty(false);
      loadedId.current = result.article.id;
      setNotice(status === "PUBLISHED" ? "Article published." : status === "ARCHIVED" ? "Article archived." : "Draft saved.");
      if (!currentId) router.replace(`/admin/news/${result.article.id}`);
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save article."); }
    finally { setBusy(false); }
  }
  function leave(event: React.MouseEvent<HTMLAnchorElement>) {
    if (dirty && !window.confirm("Leave without saving your changes?")) event.preventDefault();
  }
  if (loading) return <div className="flex items-center gap-3 p-8 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />Loading article…</div>;
  if (id && !article) return <div className="p-8"><p role="alert" className="text-negative">{error || "Article unavailable."}</p><Link href="/admin/news" className="mt-4 inline-block text-accent-2">Back to articles</Link></div>;
  const previewArticle = { ...fields, authorName: article?.authorName || "CoinSecret editorial", publishedAt: article?.publishedAt ?? null };
  return <section className="mx-auto max-w-5xl p-4 sm:p-6">
    <Link href="/admin/news" onClick={leave} className="text-sm text-muted hover:text-foreground">← Articles</Link>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-2xl font-bold tracking-tight">{id ? "Edit article" : "New article"}</h2><p className="mt-2 text-sm text-muted">{dirty ? "Unsaved changes" : article ? `${article.status.toLowerCase()} · Version ${article.version}` : "Draft"}</p></div><div className="flex rounded-xl border border-border p-1"><button type="button" aria-pressed={!preview} onClick={() => setPreview(false)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${!preview ? "bg-surface-3" : "text-muted"}`}><Pencil className="size-4" />Write</button><button type="button" aria-pressed={preview} onClick={() => setPreview(true)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${preview ? "bg-surface-3" : "text-muted"}`}><Eye className="size-4" />Preview</button></div></div>
    <div aria-live="polite">{error && <p role="alert" className="mt-5 rounded-xl border border-negative/30 p-4 text-sm text-negative">{error}</p>}{notice && <p className="mt-5 text-sm text-positive">{notice}</p>}</div>
    {preview ? <ArticleView article={previewArticle} /> : <form id="news-editor" onSubmit={(event) => { event.preventDefault(); void save(fields.status); }} className="mt-7 space-y-6"><fieldset disabled={busy} className="space-y-6 disabled:opacity-70">
      <label className="block text-sm font-medium">Title<input className={fieldClass} value={fields.title} maxLength={180} required onChange={(event) => change("title", event.target.value)} /></label>
      <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-medium">URL slug<input className={fieldClass} value={fields.slug} placeholder={articleSlug(fields.title) || "your-article-title"} readOnly={!!article?.publishedAt} maxLength={120} onChange={(event) => change("slug", event.target.value)} /><span className="mt-2 block text-xs text-muted">{article?.publishedAt ? "The published URL is permanent." : "Generated from the title when left empty."}</span></label><label className="block text-sm font-medium">Category<input className={fieldClass} value={fields.category} maxLength={60} required onChange={(event) => change("category", event.target.value)} /></label></div>
      <label className="block text-sm font-medium">Summary<textarea className={fieldClass} value={fields.summary} maxLength={500} rows={3} onChange={(event) => change("summary", event.target.value)} /></label>
      <div><label htmlFor="article-body" className="text-sm font-medium">Article body</label><div role="toolbar" aria-label="Article formatting" className="mt-2 flex flex-wrap gap-2 rounded-t-xl border border-border bg-surface-3 p-2">{[{ label: "Heading", before: "\n\n## " }, { label: "Bold", before: "**", after: "**" }, { label: "List", before: "\n\n- " }, { label: "Quote", before: "\n\n> " }, { label: "Link", before: "[", after: "](https://example.org)" }].map((item) => <button key={item.label} type="button" onClick={() => insertFormat(item.before, item.after)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface">{item.label}</button>)}</div><textarea id="article-body" ref={bodyRef} value={fields.body} maxLength={100000} onChange={(event) => change("body", event.target.value)} rows={18} className="w-full rounded-b-xl border border-t-0 border-border bg-surface px-4 py-4 font-mono text-sm leading-7 outline-none" /><p className="mt-2 text-xs text-muted">Separate paragraphs with a blank line. Use ## headings, **bold**, - lists, &gt; quotes, and [text](https://…) links.</p></div>
      <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-medium">Cover image URL <span className="text-muted">(optional)</span><input type="url" className={fieldClass} value={fields.coverUrl} maxLength={2000} placeholder="https://…" onChange={(event) => change("coverUrl", event.target.value)} /></label><label className="block text-sm font-medium">Cover image description<input className={fieldClass} value={fields.coverAlt} maxLength={180} onChange={(event) => change("coverAlt", event.target.value)} /></label></div>
      <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-semibold">Search appearance</summary><label className="mt-5 block text-sm">SEO title<input className={fieldClass} value={fields.seoTitle} maxLength={70} placeholder={fields.title} onChange={(event) => change("seoTitle", event.target.value)} /></label><label className="mt-5 block text-sm">SEO description<textarea className={fieldClass} value={fields.seoDescription} maxLength={180} rows={3} placeholder={fields.summary} onChange={(event) => change("seoDescription", event.target.value)} /></label></details>
    </fieldset></form>}
    <div className="sticky bottom-0 mt-8 flex flex-wrap items-center gap-3 border-t border-border bg-background py-4"><button type="button" disabled={busy} onClick={() => void save(fields.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT")} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-semibold disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{fields.status === "PUBLISHED" ? "Save changes" : "Save draft"}</button>{fields.status !== "PUBLISHED" && <button type="button" disabled={busy} onClick={() => { if (window.confirm("Publish this article on CoinSecret?")) void save("PUBLISHED"); }} className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">Publish article</button>}{article?.status === "PUBLISHED" && <><Link href={`/news/${article.slug}`} onClick={leave} className="px-3 py-2 text-sm text-accent-2">View article</Link><button type="button" disabled={busy} onClick={() => { if (window.confirm("Unpublish this article? It will be hidden from readers.")) void save("DRAFT"); }} className="px-3 py-2 text-sm text-warning disabled:opacity-50">Unpublish</button></>}{article && fields.status !== "ARCHIVED" && <button type="button" disabled={busy} onClick={() => { if (window.confirm("Archive this article? It will be hidden from readers.")) void save("ARCHIVED"); }} className="ml-auto px-3 py-2 text-sm text-muted disabled:opacity-50">Archive</button>}</div>
  </section>;
}
