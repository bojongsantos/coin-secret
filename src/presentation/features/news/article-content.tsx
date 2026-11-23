/* eslint-disable @next/next/no-img-element -- Editorial images load directly without arbitrary server-side URL fetching. */
import { articleBlocks, safeArticleLink } from "@/core/domain/news/content";

const headingStyles = {
  h2: "pt-5 text-2xl font-bold tracking-tight text-foreground",
  h3: "pt-3 text-xl font-semibold text-foreground",
  h4: "pt-3 text-lg font-semibold text-foreground",
  h5: "pt-3 text-base font-semibold text-foreground",
  h6: "pt-3 text-base font-semibold text-muted",
};
const imageSizes = { small: "max-w-sm", medium: "max-w-xl", full: "max-w-full" };

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https:\/\/[^\s)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\((.+)\)$/.exec(part);
    if (link && safeArticleLink(link[2])) return <a key={index} href={link[2]} rel="noopener noreferrer" className="text-accent-2 underline underline-offset-4">{link[1]}</a>;
    return part;
  });
}

export function ArticleContent({ body }: { body: string }) {
  return <div className="space-y-6 text-base leading-8 text-muted break-words">{articleBlocks(body).map((block, index) => {
    switch (block.kind) {
      case "heading": {
        const Heading = block.level === 6 ? "h6" : block.level === 5 ? "h5" : block.level === 4 ? "h4" : block.level === 3 ? "h3" : "h2";
        return <Heading key={index} className={headingStyles[Heading]}><Inline text={block.text} /></Heading>;
      }
      case "image": return <figure key={index} className={`mx-auto w-full ${imageSizes[block.size]}`}>
        <img src={block.url} alt={block.alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="mx-auto block h-auto max-w-full rounded-xl border border-border" />
      </figure>;
      case "list": return <ul key={index} className="list-disc space-y-2 pl-6">{block.items.map((item, row) => <li key={row}><Inline text={item} /></li>)}</ul>;
      case "quote": return <blockquote key={index} className="border-l-2 border-accent pl-5 italic"><Inline text={block.text} /></blockquote>;
      case "paragraph": return <p key={index} className="whitespace-pre-line"><Inline text={block.text} /></p>;
    }
  })}</div>;
}
