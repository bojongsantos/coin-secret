export type ArticleBlock =
  | { readonly kind: "heading"; readonly level: number; readonly text: string }
  | { readonly kind: "paragraph" | "quote"; readonly text: string }
  | { readonly kind: "list"; readonly items: readonly string[] };

/** A small text format with no raw HTML or embedded scripts. */
export function articleBlocks(body: string): ArticleBlock[] {
  return body.replace(/\r\n/g, "\n").split(/\n\s*\n/).filter(Boolean).map((section) => {
    const heading = /^(#{2,3}) (.+)$/.exec(section);
    if (heading) return { kind: "heading", level: heading[1].length, text: heading[2] };
    if (section.split("\n").every((line) => line.startsWith("- "))) return { kind: "list", items: section.split("\n").map((line) => line.slice(2)) };
    if (section.startsWith("> ")) return { kind: "quote", text: section.replace(/^> /gm, "") };
    return { kind: "paragraph", text: section };
  });
}

export function safeArticleLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}
