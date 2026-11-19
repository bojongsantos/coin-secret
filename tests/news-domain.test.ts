import test from "node:test";
import assert from "node:assert/strict";
import { articleFields, articlePublication, articleQuery, articleSlug } from "@/core/domain/news/article";
import { articleBlocks, safeArticleLink } from "@/core/domain/news/content";
const draft = { title: "Market notes", slug: "market-notes", summary: "", body: "", category: "Research", coverUrl: "", coverAlt: "", seoTitle: "", seoDescription: "", status: "DRAFT" as const };

test("a draft may be incomplete while publishing requires a summary and body", () => {
  assert.equal(articleFields.safeParse(draft).success, true);
  assert.equal(articleFields.safeParse({ ...draft, status: "PUBLISHED" }).success, false);
  assert.equal(articleFields.safeParse({ ...draft, status: "PUBLISHED", summary: "A market summary", body: "Some research" }).success, true);
});
test("published URLs and first publication dates remain stable through edits and republication", () => {
  const date = new Date("2026-11-19T00:00:00Z");
  assert.deepEqual(articlePublication(null, { ...draft, status: "PUBLISHED" }, date), { slug: draft.slug, publishedAt: date });
  assert.deepEqual(articlePublication({ slug: "original", publishedAt: date }, { ...draft, status: "DRAFT" }, new Date()), { slug: "original", publishedAt: date });
});
test("article URLs, lengths and input filters reject unsafe or excessive values", () => {
  assert.equal(articleFields.safeParse({ ...draft, slug: "../admin" }).success, false);
  assert.equal(articleFields.safeParse({ ...draft, coverUrl: "javascript:alert(1)" }).success, false);
  assert.equal(articleFields.safeParse({ ...draft, body: "x".repeat(100001) }).success, false);
  assert.equal(articleQuery.safeParse({ page: 0 }).success, false);
  assert.equal(articleQuery.safeParse({ q: "x".repeat(81) }).success, false);
  assert.equal(articleSlug("  Crypto & DéFi — Update  "), "crypto-defi-update");
});
test("text formatting keeps raw HTML literal and permits only safe HTTPS links", () => {
  const blocks = articleBlocks("## Research\n\n- First\n- Second\n\n<script>alert(1)</script>\n\n> Quote");
  assert.deepEqual(blocks.map((block) => block.kind), ["heading", "list", "paragraph", "quote"]);
  assert.equal(safeArticleLink("javascript:alert(1)"), false);
  assert.equal(safeArticleLink("https://user:password@example.org"), false);
  assert.equal(safeArticleLink("https://example.org/article"), true);
});
