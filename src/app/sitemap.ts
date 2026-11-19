import type { MetadataRoute } from "next";
import { articleSitemap } from "@/infrastructure/news/articles";

export const dynamic = "force-dynamic";

/**
 * Only approved public pages are submitted. Application pages carry noindex;
 * legal drafts can join after their publication is approved.
 */
const PUBLIC_ROUTES: Array<{ path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" | "yearly" }> = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" },
  { path: "/news", priority: 0.8, changeFrequency: "daily" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const articles = await articleSitemap();
  return [...PUBLIC_ROUTES.map((route) => ({
    url: `https://coinsecret.io${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  })), ...articles.map((article) => ({ url: `https://coinsecret.io/news/${article.slug}`, lastModified: article.updatedAt, priority: 0.7 }))];
}
