import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArticleView } from "@/presentation/features/news/article-view";

Object.assign(globalThis, { React });
test("public article renders semantic headings and uncropped responsive images", () => {
  const html = renderToStaticMarkup(React.createElement(ArticleView, { article: {
    title: "Market research", category: "Research", summary: "Summary", authorName: "Editorial", publishedAt: null,
    coverUrl: "https://example.org/cover.webp", coverAlt: "Cover chart",
    body: "Text\n## Market overview\nParagraph\n#### Detail\n![Price chart](https://example.org/chart.webp){medium}\n<script>alert(1)</script>",
  } }));
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.match(html, /<h2[^>]*>Market overview<\/h2>/);
  assert.match(html, /<h4[^>]*>Detail<\/h4>/);
  assert.ok(!html.includes("## Market overview"));
  assert.match(html, /<figure[^>]*max-w-xl/);
  assert.match(html, /alt="Price chart"[^>]*loading="lazy"/);
  assert.ok(html.includes("object-contain"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!html.includes("<script>"));
});
