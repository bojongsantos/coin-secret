"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import type { Article } from "@/core/domain/news/article";
import { AdminFeedback, AdminPagination, useAdminData } from "@/presentation/features/admin/admin-data";

interface NewsRows { rows: Article[]; page: number; hasMore: boolean }
function validNews(value: unknown): value is NewsRows {
  return !!value && typeof value === "object" && "rows" in value && Array.isArray(value.rows) && "page" in value && typeof value.page === "number" && "hasMore" in value && typeof value.hasMore === "boolean";
}
export function NewsModule() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const { data, loading, error, reload } = useAdminData(`/api/admin/news?${new URLSearchParams({ page: String(page), q: search, status })}`, validNews);
  return <section className="mx-auto max-w-6xl p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-2xl font-bold tracking-tight">News & Articles</h2><p className="mt-2 text-sm text-muted">Write, preview, and publish the CoinSecret journal.</p></div><Link href="/admin/news/new" className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white"><Plus className="size-4" />New article</Link></div>
    <form onSubmit={(event) => { event.preventDefault(); setSearch(q); setPage(1); }} className="mt-7 flex flex-wrap gap-3">
      <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface-3 px-3"><Search className="size-4 text-muted" /><span className="sr-only">Search articles</span><input value={q} onChange={(event) => setQ(event.target.value)} maxLength={80} placeholder="Search articles" className="min-w-0 w-full bg-transparent py-3 text-sm outline-none" /></label>
      <label className="sr-only" htmlFor="news-status">Article status</label><select id="news-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="rounded-xl border border-border bg-surface px-3 py-2 text-sm"><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option></select><button className="rounded-xl border border-border px-4 py-2 text-sm">Search</button>
    </form>
    <AdminFeedback loading={loading} error={error} retry={() => void reload()} />
    {data && <><div className="mt-5 divide-y divide-border overflow-hidden rounded-2xl border border-border">{data.rows.length ? data.rows.map((article) => <div key={article.id} className="flex flex-col justify-between gap-4 bg-surface p-5 sm:flex-row sm:items-center"><div className="min-w-0"><Link href={`/admin/news/${article.id}`} className="break-words text-base font-semibold hover:text-accent-2">{article.title}</Link><p className="mt-2 text-xs text-muted">{article.category} · {article.authorName} · Updated {new Date(article.updatedAt).toLocaleDateString("en-GB")}</p></div><div className="flex shrink-0 items-center gap-4 text-sm"><span className={article.status === "PUBLISHED" ? "text-positive" : "text-muted"}>{article.status.toLowerCase()}</span><Link href={`/admin/news/${article.id}`} className="rounded-lg border border-border px-3 py-2">Edit</Link>{article.status === "PUBLISHED" && <Link href={`/news/${article.slug}`} className="text-accent-2">View</Link>}</div></div>) : <p className="bg-surface p-10 text-center text-sm text-muted">{search || status ? "No matching articles." : "Create your first article to get started."}</p>}</div><AdminPagination page={page} hasMore={data.hasMore} disabled={loading} change={setPage} /></>}
  </section>;
}
