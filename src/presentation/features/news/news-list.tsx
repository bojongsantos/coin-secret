import Link from "next/link";
import { ArrowUpRight, Newspaper, Search } from "lucide-react";
import type { Article, ArticleQuery } from "@/core/domain/news/article";

export function NewsList({ rows, hasMore, query, categories }: { rows: Article[]; hasMore: boolean; query: ArticleQuery; categories: string[] }) {
  const pageUrl = (page: number) => `/news?${new URLSearchParams({ page: String(page), q: query.q, category: query.category })}`;
  return <section className="mx-auto max-w-6xl py-8 sm:py-12">
    <header className="border-b border-border pb-8"><p className="flex items-center gap-2 text-sm font-semibold text-accent-2"><Newspaper className="size-4" />CoinSecret Journal</p>
      <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">News & Articles</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-muted">Market news, research, and perspectives from the CoinSecret team.</p>
    </header>
    <form action="/news" className="my-7 flex flex-col gap-3 sm:flex-row">
      <label className="flex flex-1 items-center gap-3 rounded-xl border border-border bg-surface px-4"><Search className="size-4 text-muted" /><span className="sr-only">Search articles</span><input name="q" defaultValue={query.q} maxLength={80} placeholder="Search articles" className="w-full bg-transparent py-3 text-sm outline-none" /></label>
      <label className="sr-only" htmlFor="news-category">Category</label><select id="news-category" name="category" defaultValue={query.category} className="rounded-xl border border-border bg-surface px-4 py-3 text-sm"><option value="">All categories</option>{categories.map((category) => <option key={category}>{category}</option>)}</select>
      <button className="rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white">Search</button>
    </form>
    {rows.length === 0 ? <div className="rounded-2xl border border-border bg-surface px-6 py-16 text-center"><Newspaper className="mx-auto mb-4 size-8 text-muted" /><h2 className="text-xl font-semibold">{query.q || query.category ? "No matching articles" : "The journal is coming to life"}</h2><p className="mt-3 text-sm text-muted">{query.q || query.category ? "Try another search or category." : "Published news and articles will appear here."}</p></div>
      : <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{rows.map((article) => <article key={article.id} className="flex flex-col rounded-2xl border border-border bg-surface p-6 transition-colors hover:border-border-strong"><p className="text-xs font-semibold text-accent-2">{article.category}</p><h2 className="mt-4 text-xl font-semibold leading-7"><Link href={`/news/${article.slug}`} className="hover:text-accent-2">{article.title}</Link></h2><p className="mt-3 line-clamp-3 text-sm leading-6 text-muted">{article.summary}</p><div className="mt-auto flex items-center justify-between gap-3 pt-8 text-xs text-muted"><span>{article.authorName}</span><Link href={`/news/${article.slug}`} aria-label={`Read ${article.title}`} className="rounded-lg p-2 text-accent-2"><ArrowUpRight className="size-5" /></Link></div></article>)}</div>}
    <nav aria-label="Article pagination" className="mt-8 flex items-center justify-between text-sm">{query.page > 1 ? <Link href={pageUrl(query.page - 1)} className="rounded-lg border border-border px-4 py-2">Previous</Link> : <span />}<span className="text-muted">Page {query.page}</span>{hasMore ? <Link href={pageUrl(query.page + 1)} className="rounded-lg border border-border px-4 py-2">Next</Link> : <span />}</nav>
  </section>;
}
