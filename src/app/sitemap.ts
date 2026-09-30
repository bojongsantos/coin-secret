import type { MetadataRoute } from "next";

/**
 * Only approved public pages are submitted. Application pages carry noindex;
 * legal drafts can join after their publication is approved.
 */
const PUBLIC_ROUTES: Array<{ path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" | "yearly" }> = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: `https://coinsecret.io${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
