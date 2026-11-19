import { articleBlocks, safeArticleLink } from "@/core/domain/news/content";

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
      case "heading": return block.level === 2
        ? <h2 key={index} className="pt-5 text-2xl font-bold tracking-tight text-foreground"><Inline text={block.text} /></h2>
        : <h3 key={index} className="pt-3 text-xl font-semibold text-foreground"><Inline text={block.text} /></h3>;
      case "list": return <ul key={index} className="list-disc space-y-2 pl-6">{block.items.map((item, row) => <li key={row}><Inline text={item} /></li>)}</ul>;
      case "quote": return <blockquote key={index} className="border-l-2 border-accent pl-5 italic"><Inline text={block.text} /></blockquote>;
      case "paragraph": return <p key={index} className="whitespace-pre-line"><Inline text={block.text} /></p>;
    }
  })}</div>;
}
