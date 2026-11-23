/* eslint-disable @next/next/no-img-element -- Editorial HTTPS images are loaded directly without server-side fetching. */
import type { Article } from "@/core/domain/news/article";
import { ArticleContent } from "@/presentation/features/news/article-content";

export function ArticleView({ article }: { article: Pick<Article, "title" | "summary" | "body" | "category" | "coverUrl" | "coverAlt" | "authorName" | "publishedAt"> }) {
  return <article className="mx-auto max-w-3xl py-8 sm:py-12">
    <p className="text-sm font-semibold text-accent-2">{article.category}</p>
    <h1 className="mt-4 text-3xl leading-tight font-bold tracking-tight sm:text-5xl">{article.title || "Untitled article"}</h1>
    {article.summary && <p className="mt-5 text-lg leading-8 text-muted">{article.summary}</p>}
    <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-muted">
      <span>{article.authorName}</span>
      {article.publishedAt && <time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" })}</time>}
    </div>
    {article.coverUrl && <div className="mt-8 aspect-video w-full overflow-hidden rounded-2xl border border-border bg-surface"><img src={article.coverUrl} alt={article.coverAlt} width={1200} height={675} decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-contain" /></div>}
    <div className="mt-9 border-t border-border pt-9"><ArticleContent body={article.body} /></div>
  </article>;
}
