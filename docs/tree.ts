export type TreeNode =
  | { kind: "file"; path: string; fallback: string }
  | {
      kind: "folder";
      path: string;
      name: string;
      count: number;
      children: TreeNode[];
    };

type Dir = { dirs: Map<string, Dir>; files: string[] };

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export const fileFallback = (path: string) =>
  baseName(path).replace(/\.md$/i, "");

/** A name for the doc on its own, outside the tree: a folder's README is named after the folder. */
export const docName = (path: string) => {
  const parts = path.split("/");
  return parts.length > 1 && /^readme\.md$/i.test(parts.at(-1) ?? "")
    ? (parts.at(-2) ?? path)
    : fileFallback(path);
};

function nodes(dir: Dir, prefix: string): TreeNode[] {
  const files: TreeNode[] = dir.files.map((path) => ({
    kind: "file",
    path,
    fallback: fileFallback(path),
  }));
  const folders = [...dir.dirs]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, child]) => folder(child, `${prefix}${name}`, name));
  return [...files, ...folders];
}

function folder(dir: Dir, path: string, name: string): TreeNode {
  for (
    let only = [...dir.dirs][0];
    dir.files.length === 0 && dir.dirs.size === 1 && only;
    only = [...dir.dirs][0]
  ) {
    path = `${path}/${only[0]}`;
    name = `${name}/${only[0]}`;
    dir = only[1];
  }
  const only = dir.files[0];
  if (
    dir.dirs.size === 0 &&
    dir.files.length === 1 &&
    only &&
    /^readme\.md$/i.test(baseName(only))
  )
    return { kind: "file", path: only, fallback: name };
  const children = nodes(dir, `${path}/`);
  return { kind: "folder", path, name, count: countOf(children), children };
}

const countOf = (children: TreeNode[]): number =>
  children.reduce(
    (sum, node) => sum + (node.kind === "file" ? 1 : node.count),
    0,
  );

/** The paths as a folder tree: a folder holding one folder and no files merges into one row (`a/b`), and a folder holding only a README becomes that README, named after the folder. Files come before folders. */
export function buildTree(paths: readonly string[]): TreeNode[] {
  const root: Dir = { dirs: new Map(), files: [] };
  for (const path of paths) {
    let dir = root;
    for (const part of path.split("/").slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        dir.dirs.set(part, next);
      }
      dir = next;
    }
    dir.files.push(path);
  }
  return nodes(root, "");
}

/** Every folder path above `path`: `a/b/c.md` → `a`, `a/b`. */
export const ancestors = (path: string) =>
  path
    .split("/")
    .slice(0, -1)
    .map((_, index, parts) => parts.slice(0, index + 1).join("/"));

/** A Markdown head's title: a frontmatter `title:`, or the heading the doc opens with, as plain text. A doc that opens with prose has none: its later headings name sections, not the doc. */
export function titleOf(head: string): string | undefined {
  let text = head.replace(/^\uFEFF/, "");
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (front) {
    const title = /^title:\s*(.+?)\s*$/m.exec(front[1] ?? "")?.[1];
    if (title) return plain(title.replace(/^(["'])(.*)\1$/, "$2"));
    text = text.slice(front[0].length);
  }
  const first = text.split(/\r?\n/).find((line) => line.trim() !== "");
  const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(first ?? "")?.[1];
  return heading ? plain(heading) : undefined;
}

const plain = (text: string) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]+/g, "")
    .trim() || undefined;
