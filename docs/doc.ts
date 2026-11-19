import { createHash } from "node:crypto";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { Doc } from "./refs.ts";

export const hashOf = (text: string) =>
  createHash("sha256").update(text).digest("hex");

function split(text: string) {
  try {
    return parseFrontmatter(text);
  } catch {
    return { frontmatter: {}, body: text };
  }
}

export function parsed(
  path: string,
  text: string,
  size: number,
  modified: number,
): Doc {
  const { frontmatter, body } = split(text);
  return {
    status: "ok",
    path,
    frontmatter,
    body,
    text,
    size,
    modified,
    hash: hashOf(text),
  };
}
