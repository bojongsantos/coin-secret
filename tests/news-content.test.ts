import test from "node:test";
import assert from "node:assert/strict";
import { articleBlocks } from "@/core/domain/news/content";
import { articleFields } from "@/core/domain/news/article";

const image = "/api/news/images/123e4567-e89b-42d3-a456-426614174000";
test("article headings parse next to paragraphs without requiring blank lines", () => {
  const blocks = articleBlocks("Intro\n## Market overview\nAnalysis\n### Detail\nMore detail\n# Section\n#### Technical notes");
  assert.deepEqual(blocks.map(block => block.kind), ["paragraph", "heading", "paragraph", "heading", "paragraph", "heading", "heading"]);
  assert.deepEqual(blocks.filter(block => block.kind === "heading").map(block => block.level), [2, 3, 2, 4]);
});
test("article images parse between text with responsive size presets", () => {
  const blocks = articleBlocks(`Before\n![BTC chart](${image}){medium}\nAfter\n\n![Cover](https://example.org/image.webp)`);
  assert.deepEqual(blocks, [
    { kind: "paragraph", text: "Before" },
    { kind: "image", alt: "BTC chart", url: image, size: "medium" },
    { kind: "paragraph", text: "After" },
    { kind: "image", alt: "Cover", url: "https://example.org/image.webp", size: "full" },
  ]);
});
test("unsafe image URLs and markup remain literal text", () => {
  for (const url of ["javascript:alert", "data:image/svg+xml;base64,xyz", "//evil.test/image.png", "/api/news/images/../admin", "https://name:secret@example.org/image.png"]) {
    assert.equal(articleBlocks(`![Image](${url})`)[0].kind, "paragraph");
  }
  assert.equal(articleBlocks('<img src=x onerror="alert(1)">')[0].kind, "paragraph");
});
test("uploaded images can be used as covers without admitting arbitrary relative paths", () => {
  const fields = { title: "Research", slug: "research", summary: "Summary", body: "Research", category: "News", coverUrl: image, coverAlt: "Market chart", seoTitle: "", seoDescription: "", status: "PUBLISHED" };
  assert.equal(articleFields.safeParse(fields).success, true);
  assert.equal(articleFields.safeParse({ ...fields, coverUrl: "/admin" }).success, false);
  assert.equal(articleFields.safeParse({ ...fields, coverAlt: "" }).success, false);
});
