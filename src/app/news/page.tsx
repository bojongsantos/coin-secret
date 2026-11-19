import type { Metadata } from "next";
import { articleQuery } from "@/core/domain/news/article";
import { articleList, newsCategories } from "@/infrastructure/news/articles";
import { NewsList } from "@/presentation/features/news/news-list";
import { AppShell } from "@/presentation/layout/app-shell";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  return { title: "News & Articles | CoinSecret", description: "Crypto market news, research, and perspectives from CoinSecret.",
    alternates: { canonical: "https://coinsecret.io/news" }, robots: params.q || params.category || params.page ? { index: false, follow: true } : { index: true, follow: true },
    openGraph: { title: "News & Articles | CoinSecret", description: "Crypto market news and research.", url: "https://coinsecret.io/news" } };
}
export default async function NewsPage({ searchParams }: Props) {
  const parsed = articleQuery.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : articleQuery.parse({});
  const [list, categories] = await Promise.all([articleList(query), newsCategories()]);
  return <AppShell><NewsList {...list} query={query} categories={categories} /></AppShell>;
}
