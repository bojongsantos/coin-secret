import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publishedArticle } from "@/infrastructure/news/articles";
import { ArticleView } from "@/presentation/features/news/article-view";
import { AppShell } from "@/presentation/layout/app-shell";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await publishedArticle((await params).slug);
  if (!article) return { title: "Article not found | CoinSecret", robots: { index: false } };
  const title = article.seoTitle || `${article.title} | CoinSecret`;
  const description = article.seoDescription || article.summary;
  const url = `https://coinsecret.io/news/${article.slug}`;
  const image = article.coverUrl ? new URL(article.coverUrl, "https://coinsecret.io").href : "https://coinsecret.io/og.png";
  return { title, description, alternates: { canonical: url },
    openGraph: { type: "article", title, description, url, publishedTime: article.publishedAt ?? undefined, modifiedTime: article.updatedAt,
      authors: [article.authorName], images: [{ url: image, alt: article.coverAlt || "CoinSecret" }] },
    twitter: { card: "summary_large_image", title, description, images: [image] } };
}
export default async function ArticlePage({ params }: Props) {
  const article = await publishedArticle((await params).slug);
  if (!article) notFound();
  const structured = { "@context": "https://schema.org", "@type": "Article", headline: article.title, description: article.summary,
    author: { "@type": "Person", name: article.authorName }, datePublished: article.publishedAt, dateModified: article.updatedAt,
    publisher: { "@type": "Organization", name: "CoinSecret", url: "https://coinsecret.io" },
    mainEntityOfPage: `https://coinsecret.io/news/${article.slug}`, ...(article.coverUrl ? { image: new URL(article.coverUrl, "https://coinsecret.io").href } : {}) };
  return <AppShell><div className="mx-auto max-w-3xl pt-8"><Link href="/news" className="text-sm text-accent-2 hover:underline">← All articles</Link></div><ArticleView article={article} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, "\\u003c") }} />
  </AppShell>;
}
