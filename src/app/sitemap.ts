import type { MetadataRoute } from "next";

/**
 * The pages worth crawling. Anything behind a session — dashboard, scanner,
 * signals, account, admin — is intentionally absent: those render per user and
 * have nothing useful to index. Only the two anonymous marketing pages are
 * submitted; the auth pages exist but carry no content a crawler should rank.
 */
const PUBLIC_ROUTES: Array<{ path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" | "yearly" }> = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_ROUTES.map((route) => ({
    url: `https://coinsecret.io${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
