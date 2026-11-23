import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { imageType, MAX_PDF_BYTES, REPORTS } from "./limits.ts";
import { imagePath } from "./links.ts";
import { markPromoted, promotedOf, reportFile, reportImage } from "./reports.ts";
import type { Homes } from "./reports.ts";
import { folderOf, git, gitLocked } from "./upload.ts";

const run = promisify(execFile);

type Host = Homes & {
  projectRoot: string;
  want<S>(api: { name: string }): S | undefined;
};

type Classify = {
  ask(
    request: {
      state: unknown;
      questions: Record<
        string,
        { type: "choice"; instructions: string; criteria: Record<string, string> }
      >;
    },
    signal: AbortSignal,
  ): Promise<{ answers: Record<string, { choice?: string }> }>;
};

export type PromoteLinks = "rewrite" | "keep";

export type Plan = {
  dirs: string[];
  dir: string;
  name: string;
  by: "classify" | "default";
  remote: boolean;
  base: string;
  reportLinks: { text: string; target: string; promoted?: string }[];
  images: string[];
};

const REPORT_LINK = /\[([^\]\n]*)\]\((\/\.reports\/[^)\s#]+)((?:#[^)\s]*)?)\)/g;
const IMAGE_REF = /!\[([^\]\n]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g;

export const suggestedName = (report: string) =>
  report.replace(/^\d{4}-\d{2}-\d{2}-/, "");

async function trackedDocs(root: string) {
  const out = await git(root, [
    "-c",
    "core.quotePath=false",
    "ls-files",
    "-z",
    "--",
    "*.md",
    "*.MD",
  ]);
  return out
    .split("\0")
    .filter((path) => path && path.split("/").every((p) => !p.startsWith(".")));
}

const NOT_DOCS =
  /(^|\/)(tests?|__tests__|fixtures?|node_modules|vendor|dist|build|skills?|\.[^/]+)(\/|$)/i;

export function docFolders(paths: string[]) {
  const counts = new Map<string, string[]>();
  for (const path of paths) {
    const at = path.lastIndexOf("/");
    if (at < 0) continue;
    const dir = path.slice(0, at);
    if (NOT_DOCS.test(dir)) continue;
    counts.set(dir, [...(counts.get(dir) ?? []), path.slice(at + 1)]);
  }
  return counts;
}

async function remoteBase(root: string) {
  const remotes = (await git(root, ["remote"])).split("\n").filter(Boolean);
  if (remotes.length === 0) return undefined;
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  const head = await git(root, [
    "symbolic-ref",
    "--short",
    `refs/remotes/${remote}/HEAD`,
  ]).catch(() => "");
  const base = head.trim()
    ? head.trim().slice(remote.length + 1)
    : (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  return { remote, base };
}

async function choose(
  host: Host,
  folders: Map<string, string[]>,
  title: string,
  body: string,
) {
  const dirs = [...folders.keys()].toSorted();
  const fallback =
    dirs.find((dir) => /(^|\/)docs?$/i.test(dir)) ??
    dirs.toSorted((a, b) => folders.get(b)!.length - folders.get(a)!.length)[0] ??
    "docs";
  const service = host.want<Classify>({ name: "classify" });
  if (!service || dirs.length === 0)
    return { dir: fallback, by: "default" as const, dirs };
  try {
    const result = await service.ask(
      {
        state: { report: { title, excerpt: body.slice(0, 3000) } },
        questions: {
          folder: {
            type: "choice",
            instructions:
              "Pick the repository folder where this report belongs, given the files each folder already holds.",
            criteria: Object.fromEntries(
              dirs.map((dir) => [
                dir,
                `Holds: ${folders.get(dir)!.slice(0, 8).join(", ")}`,
              ]),
            ),
          },
        },
      },
      AbortSignal.timeout(15000),
    );
    const choice = result.answers.folder?.choice;
    if (choice && dirs.includes(choice))
      return { dir: choice, by: "classify" as const, dirs };
  } catch {
    return { dir: fallback, by: "default" as const, dirs };
  }
  return { dir: fallback, by: "default" as const, dirs };
}

export async function plan(host: Host, path: string): Promise<Plan> {
  const found = await reportFile(host, path);
  if (!found || !/\.md$/i.test(found.name)) throw new Error(`No report ${path}`);
  const text = await readFile(found.file, "utf8");
  const folders = docFolders(await trackedDocs(host.projectRoot));
  const picked = await choose(host, folders, found.name, text);
  const remote = await remoteBase(host.projectRoot);
  const reportLinks = [];
  for (const [, label, target] of text.matchAll(REPORT_LINK)) {
    const other = await promotedOf(host, target.slice(1)).catch(() => null);
    reportLinks.push({ text: label, target, promoted: other?.path });
  }
  const images = [
    ...new Set(
      [...text.matchAll(IMAGE_REF)].flatMap(([, , target]) => {
        const resolved = imagePath(target, found.name && `${REPORTS}${found.name}`);
        return resolved?.startsWith(REPORTS) ? [resolved] : [];
      }),
    ),
  ];
  return {
    dirs: picked.dirs,
    dir: picked.dir,
    name: suggestedName(found.name),
    by: picked.by,
    remote: remote !== undefined,
    base: remote?.base ?? "",
    reportLinks,
    images,
  };
}

export function rewriteText(
  text: string,
  links: PromoteLinks,
  promotedPaths: Map<string, string>,
  imageDirs: (resolved: string) => string | undefined,
  from: string,
) {
  const withLinks =
    links === "keep"
      ? text
      : text.replace(REPORT_LINK, (_m, label: string, target: string, hash: string) => {
          const promoted = promotedPaths.get(target.slice(1));
          return promoted ? `[${label}](/${promoted}${hash})` : label;
        });
  return withLinks.replace(
    IMAGE_REF,
    (match, alt: string, target: string, title: string) => {
      const resolved = imagePath(target, from);
      const inside = resolved?.startsWith(REPORTS) ? imageDirs(resolved) : undefined;
      return inside ? `![${alt}](${inside}${title})` : match;
    },
  );
}

const safeName = (name: unknown) => {
  if (
    typeof name !== "string" ||
    !/^[^/\\\0]+\.md$/i.test(name) ||
    name.startsWith(".")
  )
    throw new Error("The file name must be a .md name without folders");
  return name;
};

const slug = (name: string) =>
  name
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

export type Promotion = {
  path: string;
  commit?: string;
  url?: string;
  branch?: string;
  command?: string[];
  dry?: boolean;
};

export async function promote(
  host: Host,
  args: { path: string; dir: unknown; name: unknown; links: unknown; dry?: unknown },
): Promise<Promotion> {
  const found = await reportFile(host, args.path);
  if (!found || !/\.md$/i.test(found.name))
    throw new Error(`No report ${args.path}`);
  const dir = folderOf(args.dir);
  const name = safeName(args.name);
  const target = dir ? `${dir}/${name}` : name;
  const links: PromoteLinks = args.links === "keep" ? "keep" : "rewrite";
  const from = `${REPORTS}${found.name}`;
  const source = await readFile(found.file, "utf8");
  const promotedPaths = new Map<string, string>();
  for (const [, , link] of source.matchAll(REPORT_LINK)) {
    const other = await promotedOf(host, link.slice(1)).catch(() => null);
    if (other) promotedPaths.set(link.slice(1), other.path);
  }
  const copies = new Map<string, string>();
  const text = rewriteText(
    source,
    links,
    promotedPaths,
    (resolved) => {
      const rel = resolved.slice(REPORTS.length);
      copies.set(resolved, dir ? `${dir}/${rel}` : rel);
      return rel;
    },
    from,
  );
  const writes: { rel: string; text?: string; from?: string }[] = [
    { rel: target, text },
  ];
  for (const [resolved, rel] of copies) {
    if (!imageType(resolved)) continue;
    const image = await reportImage(host, resolved);
    if (!image) throw new Error(`Image not found in the reports folder: ${resolved}`);
    if (image.stat.size > MAX_PDF_BYTES)
      throw new Error(`${resolved} is over ${MAX_PDF_BYTES / 1024 / 1024} MB`);
    writes.push({ rel, from: image.file });
  }
  const remote = await remoteBase(host.projectRoot);
  const result = remote
    ? await viaPullRequest(host.projectRoot, remote, writes, target, name, args.dry === true)
    : await direct(host.projectRoot, writes, target);
  if (!result.dry)
    await markPromoted(host, args.path, {
      path: target,
      url: result.url,
      commit: result.commit,
      at: Date.now(),
    });
  return { path: target, ...result };
}

async function place(root: string, writes: { rel: string; text?: string; from?: string }[]) {
  for (const item of writes) {
    const abs = join(root, item.rel);
    if (await lstat(abs).catch(() => undefined))
      throw new Error(`${item.rel} already exists in the repo`);
    await mkdir(dirname(abs), { recursive: true });
    if (item.from) await copyFile(item.from, abs);
    else await writeFile(abs, item.text!);
  }
}

async function direct(
  root: string,
  writes: { rel: string; text?: string; from?: string }[],
  target: string,
) {
  const placed: string[] = [];
  try {
    for (const item of writes) {
      await place(root, [item]);
      placed.push(item.rel);
    }
    const paths = writes.map((item) => item.rel);
    await gitLocked(root, ["add", "--", ...paths]);
    await gitLocked(root, [
      "commit",
      "--only",
      "--quiet",
      "-m",
      `Docs: add ${target} from a report`,
      "--",
      ...paths,
    ]);
  } catch (error) {
    await git(root, ["reset", "--quiet", "--", ...placed]).catch(() => undefined);
    for (const rel of placed) await rm(join(root, rel), { force: true });
    throw error;
  }
  return {
    commit: (await git(root, ["rev-parse", "--short", "HEAD"])).trim(),
  };
}

async function viaPullRequest(
  root: string,
  remote: { remote: string; base: string },
  writes: { rel: string; text?: string; from?: string }[],
  target: string,
  name: string,
  dry: boolean,
) {
  await git(root, ["fetch", "--quiet", remote.remote, remote.base]);
  const gitDir = (await git(root, ["rev-parse", "--absolute-git-dir"])).trim();
  const tree = join(gitDir, "docs-promote", randomUUID().slice(0, 8));
  const branch = `docs/${slug(name) || "report"}-${randomUUID().slice(0, 4)}`;
  await mkdir(dirname(tree), { recursive: true });
  await git(root, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    branch,
    tree,
    `${remote.remote}/${remote.base}`,
  ]);
  try {
    await place(tree, writes);
    const paths = writes.map((item) => item.rel);
    await git(tree, ["add", "--", ...paths]);
    await git(tree, ["commit", "--quiet", "-m", `Docs: add ${target}`, "--", ...paths]);
    const commit = (await git(tree, ["rev-parse", "--short", "HEAD"])).trim();
    const command = [
      "gh",
      "pr",
      "create",
      "--base",
      remote.base,
      "--head",
      branch,
      "--title",
      `Docs: add ${target}`,
      "--body",
      `Adds \`${target}\`, promoted from an Ultimate report.`,
    ];
    if (dry) return { dry: true, commit, branch, command };
    await git(tree, ["push", "--quiet", "-u", remote.remote, branch]);
    const { stdout } = await run(command[0], command.slice(1), {
      cwd: tree,
      timeout: 60000,
    });
    return { commit, branch, command, url: stdout.trim().split("\n").at(-1) };
  } finally {
    await git(root, ["worktree", "remove", "--force", tree]).catch(() => undefined);
    if (dry) await git(root, ["branch", "-D", branch]).catch(() => undefined);
  }
}
