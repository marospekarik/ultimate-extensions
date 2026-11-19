import { lstat, readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { defineExtension, section } from "@earendil-works/pi-durable";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import { parsed } from "./doc.ts";
import { DAY, limits, MAX_BYTES, REPORTS } from "./limits.ts";
import { DocCommentsEntry } from "./refs.ts";
import type { Doc, DocComment, DocComments } from "./refs.ts";
import { keep, readReport, reportFile, reports, sweep } from "./reports.ts";

type Host = {
  projectRoot: string;
  userHome: string;
  home: string;
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
    sections: [
      section(
        "docs_links",
        () =>
          "When you write a report or doc, link what it mentions so the reader can tap it in Docs: a repo file as [name](/path/to/file.md) with a leading slash, and only a git-tracked file (commit it first); a report as [name](/.reports/YYYY-MM-DD-slug.md); a section as [step 3B](#step-3b) or [name](/path.md#section), where the anchor is the heading in lowercase, punctuation removed, spaces as hyphens (GitHub style; a repeated heading gets -1, -2); a site as a real link or a bare domain such as skat.dk. A doc that uses short ids (02b, step 3B) starts with a reference table whose rows link each id to its file or section.",
      ),
    ],
  });
}

const showable = (path: string) =>
  path.toLowerCase().endsWith(".md") &&
  path.split("/").every((part) => part && !part.startsWith("."));

async function list(host: Pick<Host, "projectRoot">): Promise<string[]> {
  const { stdout } = await runGit(host.projectRoot, [
    "-c",
    "core.quotePath=false",
    "ls-files",
    "-z",
    "--",
    "*.md",
    "*.MD",
  ]).catch((error: unknown) => {
    if (error instanceof Error && /not a git repository/i.test(error.message))
      return { stdout: "", stderr: "" };
    throw error;
  });
  return [...new Set(stdout.split("\0").filter(showable))].toSorted();
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
  if (stat.size > MAX_BYTES)
    return { status: "tooLarge", path, size: stat.size };
  return parsed(path, await readFile(file, "utf8"), stat.size, stat.mtimeMs);
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

export const userActions = ["send", "keep"];

export const actions = {
  list: (_args: unknown, { host }: Ctx) => list(host),
  reports: (_args: unknown, { host }: Ctx) => reports(host),
  read: (args: unknown, { host }: Ctx) => {
    const path = pathOf(args);
    return path.startsWith(REPORTS) ? readReport(host, path) : read(host, path);
  },
  keep: (args: unknown, { host }: Ctx) => keep(host, pathOf(args)),
  sweep: (_args: unknown, { host }: Ctx) => sweep(host, Date.now()),
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
