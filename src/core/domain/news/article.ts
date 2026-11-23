import { z } from "zod";
import { safeArticleImageUrl } from "./content";

export const articleStatus = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);
export const articleFields = z.object({
  title: z.string().trim().min(1).max(180),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens."),
  summary: z.string().trim().max(500),
  body: z.string().trim().max(100_000),
  category: z.string().trim().min(1).max(60),
  coverUrl: z.union([z.literal(""), z.string().max(2000).refine(safeArticleImageUrl, "Upload an image or use an HTTPS image URL without credentials.")]),
  coverAlt: z.string().trim().max(180),
  seoTitle: z.string().trim().max(70),
  seoDescription: z.string().trim().max(180),
  status: articleStatus,
}).strict().superRefine((value, ctx) => {
  if (value.status !== "PUBLISHED") return;
  for (const key of ["summary", "body"] as const) {
    if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: "Required before publishing." });
  }
  if (value.coverUrl && !value.coverAlt) ctx.addIssue({ code: "custom", path: ["coverAlt"], message: "Describe the cover image before publishing." });
});
export const articleChange = z.object({ fields: articleFields, version: z.number().int().positive() }).strict();
export type ArticleFields = z.infer<typeof articleFields>;
export type ArticleStatus = z.infer<typeof articleStatus>;
export interface Article extends ArticleFields {
  readonly id: string;
  readonly version: number;
  readonly authorName: string;
  readonly publishedAt: string | null;
  readonly updatedAt: string;
  readonly createdAt: string;
}
export const articleQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  q: z.string().trim().max(80).default(""),
  category: z.string().trim().max(60).default(""),
});
export type ArticleQuery = z.infer<typeof articleQuery>;
export function articleSlug(title: string): string {
  return title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120).replace(/-$/, "");
}

export function articlePublication(previous: { slug: string; publishedAt: Date | null } | null, input: ArticleFields, now: Date) {
  return {
    slug: previous?.publishedAt ? previous.slug : input.slug,
    publishedAt: previous?.publishedAt ?? (input.status === "PUBLISHED" ? now : null),
  };
}
