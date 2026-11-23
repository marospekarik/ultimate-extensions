import { ARCHIVE, imageType, REPORTS } from "./limits.ts";
const TLDS =
  "dk|com|org|net|io|dev|app|eu|se|no|de|uk|co|fi|nl|fr|es|it|ch|at|info|biz|gov|edu|ai";

export function docPath(href: string, from?: string) {
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(href) ||
    href.startsWith("#") ||
    href.startsWith("//")
  )
    return undefined;
  const target = href.split("#")[0].split("?")[0];
  if (!/\.(md|pdf)$/i.test(target)) return undefined;
  const base =
    target.startsWith("/") || !from ? [] : from.split("/").slice(0, -1);
  const parts: string[] = [];
  for (const part of [...base, ...target.split("/")]) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.pop()) return undefined;
    } else parts.push(part);
  }
  return parts.join("/");
}

export function imagePath(href: string, from: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return undefined;
  const target = href.split("#")[0].split("?")[0];
  if (!imageType(target)) return undefined;
  const folder = from.startsWith(ARCHIVE)
    ? REPORTS.slice(0, -1).split("/")
    : from.split("/").slice(0, -1);
  const parts: string[] = [];
  for (const part of [...(target.startsWith("/") ? [] : folder), ...target.split("/")]) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.pop()) return undefined;
    } else parts.push(part);
  }
  return parts.join("/");
}

export function slug(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, "")
    .replace(/ /g, "-");
}

export function headingIds(texts: string[]) {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const base = slug(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  });
}

const token = new RegExp(
  [
    "(`{3,}|~{3,})[^\\n]*\\n[\\s\\S]*?(?:\\n\\1[`~]*|$)",
    "(`+)([^`]|[^`][\\s\\S]*?[^`])\\2(?!`)",
    "!?\\[[^\\]\\n]*\\]\\((?:[^()\\n]|\\([^)\\n]*\\))*\\)",
    "<[^>\\s]+>",
    "https?://[^\\s)<>]+",
    `(?<![\\w@/.:-])(?:[a-z0-9][a-z0-9-]*\\.)+(?:${TLDS})(?![\\w@-]|\\.[a-z0-9])(?:/[^\\s)<>\\]\`]*)?`,
  ].join("|"),
  "gi",
);

const trailing = /[.,;:!?]+$/;

export function linkify(body: string, from: string, known: Set<string>) {
  return body.replace(
    token,
    (
      match: string,
      fence?: string,
      ticks?: string,
      inline?: string,
    ): string => {
      if (fence) return match;
      if (ticks) {
        const text = inline!.trim();
        const path =
          /^[^\s]+\.md$/i.test(text) && !text.includes("://")
            ? [docPath(text, from), docPath(`/${text}`)].find(
                (candidate) => candidate && known.has(candidate),
              )
            : undefined;
        return path ? `[${match}](/${path})` : match;
      }
      if (!/^[a-z0-9]/i.test(match) || match.includes("://")) return match;
      const tail = match.match(trailing)?.[0] ?? "";
      const bare = match.slice(0, match.length - tail.length);
      return `[${bare}](https://${bare})${tail}`;
    },
  );
}

const fold = (text: string) =>
  text
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

export function findHeading(ids: string[], hash: string) {
  const exact = ids.indexOf(hash);
  return exact >= 0 ? exact : ids.map(fold).indexOf(fold(hash));
}
