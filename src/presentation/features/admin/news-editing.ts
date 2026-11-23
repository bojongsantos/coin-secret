export interface BodySelection {
  readonly body: string;
  readonly start: number;
  readonly end: number;
}

export function formatArticleHeading(selection: BodySelection, level: "2" | "3" | "4" | "paragraph") {
  const start = selection.start === 0 ? 0 : selection.body.lastIndexOf("\n", selection.start - 1) + 1;
  const selectedEnd = selection.end > selection.start && selection.body[selection.end - 1] === "\n" ? selection.end - 1 : selection.end;
  const nextLine = selection.body.indexOf("\n", selectedEnd);
  const end = nextLine < 0 ? selection.body.length : nextLine;
  const prefix = level === "paragraph" ? "" : `${"#".repeat(Number(level))} `;
  const text = selection.body.slice(start, end).split("\n").map(line => prefix + (line.replace(/^#{1,6}\s+/, "") || "Heading")).join("\n");
  return { body: selection.body.slice(0, start) + text + selection.body.slice(end), start, end: start + text.length };
}

export function insertArticleImage(selection: BodySelection, image: { readonly url: string; readonly alt: string; readonly size: "small" | "medium" | "full" }) {
  const alt = image.alt.trim().replace(/[\[\]\r\n]/g, " ").replace(/\s+/g, " ");
  const url = image.url.startsWith("/") ? image.url : new URL(image.url).href.replace(/\(/g, "%28").replace(/\)/g, "%29");
  const before = selection.body.slice(0, selection.start);
  const after = selection.body.slice(selection.end);
  const text = `${before && !before.endsWith("\n\n") ? "\n\n" : ""}![${alt}](${url}){${image.size}}\n\n`;
  const body = before + text + after;
  return { body, start: before.length + text.length, end: before.length + text.length };
}
