import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const row = {
  id: "art_1", version: 3, title: "Title", slug: "title", summary: "S", body: "B", category: "Research",
  coverUrl: "", coverAlt: "", seoTitle: "", seoDescription: "", status: "PUBLISHED",
  authorName: "Editor", authorId: "usr_admin_secret", publishedAt: new Date("2026-11-19T00:00:00Z"),
  createdAt: new Date("2026-11-18T00:00:00Z"), updatedAt: new Date("2026-11-19T00:00:00Z"),
};

function loadArticles() {
  const exports: { publishedArticle?: (slug: string) => Promise<Record<string, unknown> | null> } = {};
  runInNewContext(ts.transpileModule(readFileSync("src/infrastructure/news/articles.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    require: (specifier: string) => {
      if (specifier === "react") return { cache: (fn: unknown) => fn };
      if (specifier === "@/infrastructure/database/prisma") return { prisma: { newsArticle: { findFirst: async () => row } } };
      return {};
    },
  });
  if (!exports.publishedArticle) throw new Error("publishedArticle not exported");
  return exports.publishedArticle;
}

test("a public article payload never exposes the admin author id", async () => {
  const article = await loadArticles()("title");
  assert.ok(article, "the published article must be returned");
  assert.equal(article.authorId, undefined, "the raw author row id must not reach public readers");
  assert.equal(article.authorName, "Editor", "the publishing credit stays available");
  assert.equal(article.body, "B", "public fields survive the explicit projection");
});
