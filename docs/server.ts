import { lstat, open, readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { defineExtension, section } from "@earendil-works/pi-durable";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import { hashOf, parsed } from "./doc.ts";
import { renderPdf } from "./pdf.ts";
import {
  DAY,
  imageType,
  isPdf,
  limits,
  MAX_BYTES,
  MAX_PDF_BYTES,
  REPORTS,
} from "./limits.ts";
import { DocCommentsEntry } from "./refs.ts";
import type { Doc, DocComment, DocComments } from "./refs.ts";
import {
  checkSave,
  deleteReport,
  history,
  keep,
  promotedOf,
  readReport,
  reportFile,
  reportImage,
  reports,
  sweep,
  version,
  writeAtomically,
  writeReport,
} from "./reports.ts";
import { plan, promote } from "./promote.ts";
import { titleOf } from "./tree.ts";
import { uploads } from "./upload.ts";

type Project = {
  root?: string;
  name: string;
  home: string;
  current: boolean;
  running?: { url: string };
};

type Host = {
  projectRoot: string;
  userHome: string;
  home: string;
  projects(): Promise<Project[]>;
  want<S>(api: { name: string }): S | undefined;
  harness(): Harness;
  conversations(): { id: number }[];
  notice(message: string): void;
  onOpen(run: () => Promise<void>): void;
  onClose(run: () => Promise<void>): void;
};

type Ctx = { host: Host };

const execFileAsync = promisify(execFile);
const runGit = (cwd: string, args: string[]) =>
  execFileAsync("git", args, { cwd, timeout: 30000, maxBuffer: 1024 * 1024 });
const code = (error: unknown) => (error as { code?: string } | null)?.code;
const missing = (error: unknown): undefined => {
  if (code(error) === "ENOENT" || code(error) === "ENOTDIR") return undefined;
  throw error;
};

async function tailnetPorts(userHome: string): Promise<Record<string, number>> {
  const text = await readFile(
    join(userHome, ".ultimate/tailscale.json"),
    "utf8",
  ).catch(missing);
  if (!text) return {};
  const registry = JSON.parse(text) as {
    ports?: Record<string, { port: number }>;
  };
  return Object.fromEntries(
    Object.entries(registry.ports ?? {}).map(([root, { port }]) => [
      root,
      port,
    ]),
  );
}

export async function otherProjects(host: Host) {
  const own = host
    .want<{ status(): { url?: string } }>({ name: "tailscale" })
    ?.status().url;
  const [projects, ports] = await Promise.all([
    host.projects(),
    tailnetPorts(host.userHome),
  ]);
  return projects.flatMap((project) => {
    if (project.current || !project.running) return [];
    const port = project.root ? ports[project.root] : undefined;
    const tailnet = own && port ? new URL(own) : undefined;
    if (tailnet) tailnet.port = String(port);
    const url = tailnet ? tailnet.origin : project.running.url;
    const reports = join(
      host.userHome,
      ".ultimate/reports",
      project.home.split(sep).at(-1)!,
    );
    return [{ name: project.name, url, reports }];
  });
}

const LINKS =
  "When you write a report or doc, link what it mentions so the reader can tap it in Docs: a repo file as [name](/path/to/file.md) with a leading slash, and only a git-tracked file (commit it first); a report as [name](/.reports/YYYY-MM-DD-slug.md); a section as [step 3B](#step-3b) or [name](/path.md#section), where the anchor is the heading in lowercase, punctuation removed, spaces as hyphens (GitHub style; a repeated heading gets -1, -2); a site as a real link or a bare domain such as skat.dk. A doc that uses short ids (02b, step 3B) starts with a reference table whose rows link each id to its file or section.";

export async function linksSection(host: Host) {
  const others = await otherProjects(host);
  if (others.length === 0) return LINKS;
  return [
    LINKS,
    "Those links open in this project only. A report or doc that belongs to another project (one you wrote into its reports folder, or a file in its repo) is linked with the full URL of that project's own instance: [name](<url>/?doc=.reports/YYYY-MM-DD-slug.md) for a report, [name](<url>/?doc=path/to/file.md) for a repo file, #section appended for a section. The other running projects, with the URL the user opens each at and its reports folder:",
    ...others.map(
      (project) =>
        `- ${project.name}: ${project.url} (reports: ${project.reports}/)`,
    ),
  ].join("\n");
}

export default function docs(host: Host) {
  const run = () =>
    sweep(host, Date.now()).catch((error: unknown) =>
      host.notice(`Docs: report sweep failed: ${String(error)}`),
    );
  let stopSweeping: (() => void) | undefined;
  host.onOpen(async () => {
    await run();
    stopSweeping?.();
    const timer = setInterval(run, DAY);
    stopSweeping = () => clearInterval(timer);
  });
  host.onClose(() => Promise.resolve(stopSweeping?.()));
  return defineExtension({
    name: "docs",
    sections: [section("docs_links", () => linksSection(host))],
  });
}

const showable = (path: string) =>
  /\.(md|pdf)$/i.test(path) &&
  path.split("/").every((part) => part && !part.startsWith("."));

async function list(host: Pick<Host, "projectRoot">): Promise<string[]> {
  const files = (args: string[]) =>
    runGit(host.projectRoot, [
      "-c",
      "core.quotePath=false",
      "ls-files",
      "-z",
      ...args,
    ]).then(({ stdout }) => stdout.split("\0"));
  try {
    const tracked = await files(["--", "*.md", "*.MD", "*.pdf", "*.PDF"]);
    return [...new Set(tracked.filter(showable))].toSorted();
  } catch (error) {
    if (error instanceof Error && /not a git repository/i.test(error.message))
      return [];
    throw error;
  }
}

const TITLE_HEAD = 4096;
const titleCache = new Map<string, { modified: number; title?: string }>();

async function headTitle(file: string) {
  const stat = await lstat(file).catch(missing);
  if (!stat?.isFile() || (await realpath(file)) !== file) return undefined;
  const cached = titleCache.get(file);
  if (cached?.modified === stat.mtimeMs) return cached.title;
  const handle = await open(file, "r");
  try {
    const { buffer, bytesRead } = await handle.read(
      Buffer.alloc(TITLE_HEAD),
      0,
      TITLE_HEAD,
      0,
    );
    const title = titleOf(buffer.subarray(0, bytesRead).toString("utf8"));
    titleCache.set(file, { modified: stat.mtimeMs, title });
    return title;
  } finally {
    await handle.close();
  }
}

async function titles(host: Host): Promise<Record<string, string>> {
  const root = await realpath(host.projectRoot);
  const repo = (await list(host))
    .filter((path) => !isPdf(path))
    .map((path) => ({ path, file: join(root, path) }));
  const found = await Promise.all(
    (await reports(host)).reports
      .filter((report) => !isPdf(report.path))
      .map(async (report) => ({
        path: report.path,
        file: (await reportFile(host, report.path))?.file,
      })),
  );
  const result: Record<string, string> = {};
  for (const { path, file } of [...repo, ...found]) {
    if (!file) continue;
    const title = await headTitle(file);
    if (title) result[path] = title;
  }
  return result;
}

async function read(
  host: Pick<Host, "projectRoot">,
  path: string,
): Promise<Doc> {
  if (!(await list(host)).includes(path)) return { status: "missing", path };
  const root = await realpath(host.projectRoot);
  const file = join(root, path);
  const stat = await lstat(file).catch(missing);
  if (!stat?.isFile()) return { status: "missing", path };
  if ((await realpath(file)) !== file || !file.startsWith(root + sep))
    return { status: "missing", path };
  if (isPdf(path))
    return { status: "pdf", path, size: stat.size, modified: stat.mtimeMs };
  if (stat.size > MAX_BYTES)
    return { status: "tooLarge", path, size: stat.size };
  const doc = parsed(
    path,
    await readFile(file, "utf8"),
    stat.size,
    stat.mtimeMs,
  );
  const { stdout } = await runGit(host.projectRoot, [
    "status",
    "--porcelain",
    "--",
    path,
  ]);
  return doc.status === "ok" && stdout.trim() ? { ...doc, dirty: true } : doc;
}

async function repoFile(host: Pick<Host, "projectRoot">, path: string) {
  if (!(await list(host)).includes(path))
    throw new Error(`Not a doc the viewer shows: ${path}`);
  const root = await realpath(host.projectRoot);
  const file = join(root, path);
  const stat = await lstat(file).catch(missing);
  if (
    !stat?.isFile() ||
    (await realpath(file)) !== file ||
    !file.startsWith(root + sep)
  )
    throw new Error(`No doc ${path}`);
  return { file, stat };
}

async function trackedImage(host: Pick<Host, "projectRoot">, path: string) {
  if (path.split("/").some((part) => !part || part.startsWith(".")))
    throw new Error(`Not an image the viewer shows: ${path}`);
  const { stdout } = await runGit(host.projectRoot, [
    "ls-files",
    "-z",
    "--",
    `:(literal)${path}`,
  ]);
  if (stdout.split("\0").every((name) => name !== path))
    throw new Error(`Not an image the viewer shows: ${path}`);
  const root = await realpath(host.projectRoot);
  const file = join(root, path);
  const stat = await lstat(file).catch(missing);
  if (
    !stat?.isFile() ||
    (await realpath(file)) !== file ||
    !file.startsWith(root + sep)
  )
    throw new Error(`No image ${path}`);
  return { file, stat };
}

async function fileBytes(host: Host, path: string) {
  const image = imageType(path) !== undefined;
  if (!image && !isPdf(path)) throw new Error(`Not a PDF or image: ${path}`);
  const found = path.startsWith(REPORTS)
    ? image
      ? await reportImage(host, path)
      : await reportFile(host, path)
    : image
      ? await trackedImage(host, path)
      : await repoFile(host, path);
  if (!found) throw new Error(`No file ${path}`);
  if (found.stat.size > MAX_PDF_BYTES)
    throw new Error(`${path} is over ${MAX_PDF_BYTES / 1024 / 1024} MB`);
  return { data: (await readFile(found.file)).toString("base64") };
}

async function imageBytes(host: Host, path: string, modified: unknown) {
  if (imageType(path) === undefined) throw new Error(`Not an image: ${path}`);
  const found = path.startsWith(REPORTS)
    ? await reportImage(host, path)
    : await trackedImage(host, path);
  if (!found) throw new Error(`No image ${path}`);
  if (found.stat.size > MAX_PDF_BYTES)
    throw new Error(`${path} is over ${MAX_PDF_BYTES / 1024 / 1024} MB`);
  const stamp = found.stat.mtimeMs;
  if (modified === stamp) return { modified: stamp };
  return {
    modified: stamp,
    data: (await readFile(found.file)).toString("base64"),
  };
}

async function writeDoc(
  host: Pick<Host, "projectRoot">,
  path: string,
  text: unknown,
  base: unknown,
) {
  const { file, stat } = await repoFile(host, path);
  const next = checkSave(text, base, await readFile(file, "utf8"));
  await writeAtomically(file, next, stat.mode);
  return { hash: hashOf(next) };
}

async function commitDoc(
  host: Pick<Host, "projectRoot">,
  path: string,
  message: unknown,
) {
  await repoFile(host, path);
  const subject =
    typeof message === "string" && message.trim()
      ? message.trim().slice(0, 200)
      : `Docs: edit ${path}`;
  await runGit(host.projectRoot, [
    "commit",
    "-m",
    subject,
    "--only",
    "--",
    path,
  ]);
  const { stdout } = await runGit(host.projectRoot, [
    "rev-parse",
    "--short",
    "HEAD",
  ]);
  return { commit: stdout.trim() };
}

const clip = (text: unknown, max: number, what: string) => {
  if (typeof text !== "string") throw new Error(`${what} must be text`);
  if (text.length > max) throw new Error(`${what} is over ${max} characters`);
  return text;
};

export function checkComments(
  args: unknown,
): DocComments & { conversation: number } {
  const input = (args ?? {}) as Record<string, unknown>;
  const conversation = input.conversation;
  if (
    typeof conversation !== "number" ||
    !Number.isSafeInteger(conversation) ||
    conversation < 1
  )
    throw new Error("conversation must be a conversation id");
  const path = clip(input.path, 1000, "path");
  if (!Array.isArray(input.comments) || input.comments.length === 0)
    throw new Error("Expected at least one comment");
  if (input.comments.length > limits.comments)
    throw new Error(`At most ${limits.comments} comments`);
  const comments = input.comments.map((raw): DocComment => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const text = clip(item.text, limits.text, "A comment").trim();
    if (!text) throw new Error("A comment is empty");
    const quote =
      item.quote === undefined
        ? undefined
        : clip(item.quote, limits.quote, "A quote").trim();
    const heading =
      item.heading === undefined
        ? undefined
        : clip(item.heading, 300, "A heading").trim();
    return { text, ...(quote && { quote }), ...(heading && { heading }) };
  });
  const note =
    input.note === undefined
      ? undefined
      : clip(input.note, limits.note, "The note").trim();
  return { conversation, path, comments, ...(note && { note }) };
}

const fence = (text: string) =>
  "`".repeat(
    Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)),
  );

export function commentsText(
  { path, comments, note }: DocComments,
  file = path,
) {
  const parts = [
    `Comments on ${path.startsWith(REPORTS) ? "the report " : ""}\`${file}\` (${comments.length} ${comments.length === 1 ? "comment" : "comments"}). Read the doc before answering.`,
  ];
  if (note) parts.push(note);
  comments.forEach((comment, index) => {
    const lines = [
      `${index + 1}. ${comment.heading ? `Under "${comment.heading}"` : "On the doc"}`,
    ];
    if (comment.quote)
      lines.push(
        `${fence(comment.quote)}markdown`,
        comment.quote,
        fence(comment.quote),
      );
    lines.push(comment.text);
    parts.push(lines.join("\n"));
  });
  return parts.join("\n\n");
}

const pathOf = (args: unknown) => {
  const path = (args as { path?: unknown } | null)?.path;
  if (typeof path !== "string") throw new Error("Expected { path }");
  return path;
};

const uploaders = new Map<string, ReturnType<typeof uploads>>();
const uploader = (host: Pick<Host, "projectRoot">) => {
  let found = uploaders.get(host.projectRoot);
  if (!found) {
    found = uploads(host.projectRoot);
    uploaders.set(host.projectRoot, found);
  }
  return found;
};

export const userActions = [
  "send",
  "keep",
  "write",
  "commit",
  "pdf",
  "begin",
  "chunk",
  "finish",
  "abort",
  "remove",
  "promote",
];

export const actions = {
  list: (_args: unknown, { host }: Ctx) => list(host),
  titles: (_args: unknown, { host }: Ctx) => titles(host),
  reports: (_args: unknown, { host }: Ctx) => reports(host),
  read: (args: unknown, { host }: Ctx) => {
    const path = pathOf(args);
    return path.startsWith(REPORTS) ? readReport(host, path) : read(host, path);
  },
  pdf: async (args: unknown) => {
    const path = pathOf(args);
    const { html } = args as { html?: unknown };
    const name = path.split("/").pop() ?? "doc";
    return { data: (await renderPdf(name, html)).toString("base64") };
  },
  file: (args: unknown, { host }: Ctx) => fileBytes(host, pathOf(args)),
  image: (args: unknown, { host }: Ctx) =>
    imageBytes(host, pathOf(args), (args as { modified?: unknown }).modified),
  keep: (args: unknown, { host }: Ctx) => keep(host, pathOf(args)),
  write: (args: unknown, { host }: Ctx) => {
    const { text, base } = args as { text?: unknown; base?: unknown };
    const path = pathOf(args);
    if (isPdf(path)) throw new Error("PDFs are not editable");
    return path.startsWith(REPORTS)
      ? writeReport(host, path, text, base)
      : writeDoc(host, path, text, base);
  },
  history: (args: unknown, { host }: Ctx) => history(host, pathOf(args)),
  version: (args: unknown, { host }: Ctx) =>
    version(host, pathOf(args), (args as { id?: unknown }).id),
  commit: (args: unknown, { host }: Ctx) => {
    const path = pathOf(args);
    if (path.startsWith(REPORTS)) throw new Error("Reports are not in git");
    if (isPdf(path)) throw new Error("PDFs are not editable");
    return commitDoc(host, path, (args as { message?: unknown }).message);
  },
  promoted: (args: unknown, { host }: Ctx) => {
    const path = pathOf(args);
    return path.startsWith(REPORTS) ? promotedOf(host, path) : null;
  },
  promotePlan: (args: unknown, { host }: Ctx) => plan(host, pathOf(args)),
  promote: (args: unknown, { host }: Ctx) =>
    promote(host, { ...(args as object), path: pathOf(args) } as Parameters<
      typeof promote
    >[1]),
  sweep: (_args: unknown, { host }: Ctx) => sweep(host, Date.now()),
  begin: (args: unknown, { host }: Ctx) => {
    const { dir, name, size, onConflict } = (args ?? {}) as Record<
      string,
      unknown
    >;
    return uploader(host).begin({ dir, name, size, onConflict });
  },
  chunk: (args: unknown, { host }: Ctx) => {
    const { id, index, data } = (args ?? {}) as Record<string, unknown>;
    return uploader(host).chunk(id, index, data);
  },
  finish: (args: unknown, { host }: Ctx) =>
    uploader(host).finish((args as { id?: unknown } | null)?.id),
  abort: (args: unknown, { host }: Ctx) =>
    uploader(host).abort((args as { id?: unknown } | null)?.id),
  remove: async (args: unknown, { host }: Ctx) => {
    const path = pathOf(args);
    if (path.startsWith(REPORTS)) return deleteReport(host, path);
    await repoFile(host, path);
    return uploader(host).remove(path);
  },
  send: async (args: unknown, { host }: Ctx) => {
    const { conversation: id, ...review } = checkComments(args);
    let file = review.path;
    if (review.path.startsWith(REPORTS)) {
      const found = await reportFile(host, review.path);
      if (!found) throw new Error(`No report ${review.path}`);
      file = found.file;
    } else if (!(await list(host)).includes(review.path))
      throw new Error(`Not a doc the viewer shows: ${review.path}`);
    if (!host.conversations().some((item) => item.id === id))
      throw new Error(`No conversation #${id}`);
    const conversation = await host
      .harness()
      .conversation(id as ConversationId, context);
    if (!conversation) throw new Error(`No conversation #${id}`);
    await conversation.submit(
      {
        type: "input",
        content: commentsText(review, file),
        entry: { kind: "docs.comments", data: review },
        whenBusy: "steer",
      },
      context,
    );
    return { conversation: id };
  },
};
