export type ArticleBlock =
  | { readonly kind: "heading"; readonly level: number; readonly text: string }
  | { readonly kind: "paragraph" | "quote"; readonly text: string }
  | { readonly kind: "image"; readonly alt: string; readonly url: string; readonly size: "small" | "medium" | "full" }
  | { readonly kind: "list"; readonly items: readonly string[] };

/** A small text format with no raw HTML or embedded scripts. */
export function articleBlocks(body: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const text = line.trim();
    if (!text) { flush(); continue; }
    const heading = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(text);
    const image = /^!\[([^\]\n]{1,180})\]\(([^\s)]{1,2000})\)(?:\{(small|medium|full)\})?$/.exec(text);
    if (heading) {
      flush();
      // The article title owns H1; pasted H1 sections become H2.
      blocks.push({ kind: "heading", level: Math.max(2, heading[1].length), text: heading[2] });
    } else if (image && safeArticleImageUrl(image[2])) {
      flush();
      const size = image[3] === "small" ? "small" : image[3] === "medium" ? "medium" : "full";
      blocks.push({ kind: "image", alt: image[1], url: image[2], size });
    } else if (text.startsWith("- ")) {
      flush();
      const last = blocks.at(-1);
      const item = text.slice(2);
      if (last?.kind === "list") blocks[blocks.length - 1] = { kind: "list", items: [...last.items, item] };
      else blocks.push({ kind: "list", items: [item] });
    } else if (text.startsWith("> ")) {
      flush();
      const last = blocks.at(-1);
      const quote = text.slice(2);
      if (last?.kind === "quote") blocks[blocks.length - 1] = { kind: "quote", text: `${last.text}\n${quote}` };
      else blocks.push({ kind: "quote", text: quote });
    } else paragraph.push(line);
  }
  flush();
  return blocks;
}

export function safeArticleImageUrl(value: string): boolean {
  return value.length <= 2000 && (/^\/api\/news\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) || safeArticleLink(value));
}

export function safeArticleLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}
