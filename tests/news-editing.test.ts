import test from "node:test";
import assert from "node:assert/strict";
import { formatArticleHeading, insertArticleImage } from "@/presentation/features/admin/news-editing";

test("heading formatting replaces the current line marker and preserves neighboring paragraphs", () => {
  const source = "Before\n## Existing heading\nAfter";
  const formatted = formatArticleHeading({ body: source, start: 12, end: 12 }, "3");
  assert.equal(formatted.body, "Before\n### Existing heading\nAfter");
  assert.equal(formatArticleHeading(formatted, "paragraph").body, "Before\nExisting heading\nAfter");
});

test("heading selection formats every selected line without duplicating markers", () => {
  const source = "## First\n### Second";
  assert.equal(formatArticleHeading({ body: source, start: 0, end: source.length }, "2").body, "## First\n## Second");
});

test("heading formatting does not consume the next line when selection ends after a newline", () => {
  assert.equal(formatArticleHeading({ body: "First\nSecond", start: 0, end: 6 }, "2").body, "## First\nSecond");
  assert.equal(formatArticleHeading({ body: "\nSecond", start: 0, end: 0 }, "2").body, "## Heading\nSecond");
});

test("body image insertion uses the remembered cursor and creates a standalone responsive block", () => {
  const inserted = insertArticleImage({ body: "BeforeAfter", start: 6, end: 6 }, { url: "https://example.org/image.webp", alt: "A [market] chart\nwith levels", size: "medium" });
  assert.equal(inserted.body, "Before\n\n![A market chart with levels](https://example.org/image.webp){medium}\n\nAfter");
  assert.equal(inserted.body.slice(inserted.start), "After");
});

test("image insertion encodes URL characters that would break the Markdown image block", () => {
  const inserted = insertArticleImage({ body: "", start: 0, end: 0 }, { url: "https://example.org/market chart(1).png", alt: "Chart", size: "full" });
  assert.equal(inserted.body, "![Chart](https://example.org/market%20chart%281%29.png){full}\n\n");
});
