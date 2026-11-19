export type Block = { text: string; gap: string };

export type Source = { lead: string; blocks: Block[] };

const fenceOpen = (text: string) =>
  (text.match(/^ {0,3}(?:`{3,}|~{3,})/gm)?.length ?? 0) % 2 === 1;

export function parseSource(text: string): Source {
  const lead = text.match(/^\s*\n/)?.[0] ?? "";
  const parts = text.slice(lead.length).split(/(\n[ \t]*\n(?:[ \t]*\n)*)/);
  const blocks: Block[] = [];
  for (let at = 0; at < parts.length; at += 2) {
    let current = parts[at];
    let gap = parts[at + 1] ?? "";
    while (fenceOpen(current) && at + 2 < parts.length) {
      current += gap + parts[at + 2];
      gap = parts[at + 3] ?? "";
      at += 2;
    }
    const tail = current.match(/\n+$/)?.[0] ?? "";
    blocks.push({ text: current.slice(0, current.length - tail.length), gap: tail + gap });
  }
  return { lead, blocks };
}

export const joinSource = ({ lead, blocks }: Source) =>
  lead + blocks.map((block) => block.text + block.gap).join("");

export function tidy(blocks: Block[]): Block[] {
  const kept = blocks.filter((block) => block.text.trim() !== "");
  if (kept.length === 0) return [];
  const last = kept[kept.length - 1];
  return kept.map((block, index) =>
    block.gap === "" && index < kept.length - 1
      ? { ...block, gap: "\n\n" }
      : index === kept.length - 1 && !last.gap
        ? { ...block, gap: "\n" }
        : block,
  );
}

export type Kind = "h1" | "h2" | "h3" | "quote" | "code" | "text";

export function kindOf(text: string): Kind {
  if (/^ {0,3}(?:`{3,}|~{3,})/.test(text)) return "code";
  const heading = /^(#{1,6}) /.exec(text);
  if (heading) return heading[1].length === 1 ? "h1" : heading[1].length === 2 ? "h2" : "h3";
  if (/^> ?/.test(text)) return "quote";
  return "text";
}

const bullet = /^(\s*)([-*+]|\d+\.)(\s+)/;

export function continueList(before: string) {
  const line = before.slice(before.lastIndexOf("\n") + 1);
  const match = bullet.exec(line);
  if (!match) return undefined;
  const marker = /^\d+\.$/.test(match[2])
    ? `${Number.parseInt(match[2], 10) + 1}.`
    : match[2];
  return {
    next: `${match[1]}${marker}${match[3]}`,
    empty: line.slice(match[0].length).trim() === "",
    lineStart: before.length - line.length,
  };
}

export type Span = { text: string; style?: "mark" | "bold" | "italic" | "code" };

const inline = /(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(`[^`\n]+`)/g;

export function spans(line: string): Span[] {
  const out: Span[] = [];
  const lead = /^(\s*(?:#{1,6} |> ?|(?:[-*+]|\d+\.)\s+))/.exec(line)?.[0] ?? "";
  if (lead) out.push({ text: lead, style: "mark" });
  const rest = line.slice(lead.length);
  let from = 0;
  for (const match of rest.matchAll(inline)) {
    if (match.index > from) out.push({ text: rest.slice(from, match.index) });
    const token = match[0];
    if (match[1] || match[2]) {
      out.push({ text: token.slice(0, 2), style: "mark" });
      out.push({ text: token.slice(2, -2), style: "bold" });
      out.push({ text: token.slice(-2), style: "mark" });
    } else if (match[3]) {
      out.push({ text: "*", style: "mark" });
      out.push({ text: token.slice(1, -1), style: "italic" });
      out.push({ text: "*", style: "mark" });
    } else {
      out.push({ text: "`", style: "mark" });
      out.push({ text: token.slice(1, -1), style: "code" });
      out.push({ text: "`", style: "mark" });
    }
    from = match.index + token.length;
  }
  if (from < rest.length) out.push({ text: rest.slice(from) });
  return out;
}

export const prefixOf = (text: string, body: string) =>
  text.endsWith(body) ? text.slice(0, text.length - body.length) : "";

export function normalize(text: string) {
  const source = parseSource(text);
  return joinSource({ lead: source.lead, blocks: tidy(source.blocks) });
}
