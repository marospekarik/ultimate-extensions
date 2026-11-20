/** Docs: the repository's Markdown files, read-only, the project's reports, and comments on them. Browser-safe. */
import { defineEntry } from "@earendil-works/pi-durable";
import { actionRef } from "@/sdk";

/** One comment on a doc: the text it is about (empty for the doc as a whole), the heading above it, and what to say. */
export type DocComment = { quote?: string; heading?: string; text: string };

/** What a sent review of one doc holds; the `docs.comments` entry's data. */
export type DocComments = {
  path: string;
  comments: DocComment[];
  note?: string;
};

/** A comment review the user sent: the recipient reads it as text and the transcript shows it as a card. */
export const DocCommentsEntry = defineEntry<DocComments>("docs.comments");

export type Doc =
  | {
      status: "ok";
      path: string;
      /** The YAML frontmatter, parsed; empty without one. */
      frontmatter: Record<string, unknown>;
      /** The Markdown after the frontmatter. */
      body: string;
      /** The file as stored, frontmatter included. */
      text: string;
      size: number;
      modified: number;
      /** SHA-256 of `text`; a save sends it back as its base. */
      hash: string;
      /** Repo docs only: the file has uncommitted changes. */
      dirty?: boolean;
    }
  /** Not found (not tracked, gone from the work tree, a report deleted or never written), or over the size cap. */
  | { status: "missing" | "tooLarge"; path: string; size?: number }
  /** A PDF: the viewer fetches its bytes with `file`. `path` is where it is now. */
  | { status: "pdf"; path: string; size: number; modified: number };

export type Report = {
  path: string;
  size: number;
  modified: number;
  /** Kept: in `archive/`, never deleted. */
  archived: boolean;
  /** When the daily sweep deletes it (not for kept reports). */
  expires?: number;
};

/** No arguments → every git-tracked Markdown file the viewer may show, as repo-relative paths, sorted. */
export const ListAction = actionRef<null, string[]>("docs", "list");
/**
 * No arguments → the project's reports folder (`~/.ultimate/reports/<name>-<hash>/`) and its reports, newest first,
 * then the kept ones in `archive/`, newest first.
 */
export const ReportsAction = actionRef<
  null,
  { folder: string; reports: Report[] }
>("docs", "reports");
/**
 * `{ path }`, one of `list`'s or `reports`' paths → the doc, or why it cannot be shown. A report moved by Keep still
 * opens from its old path; `path` in the result is where it is now.
 */
export const ReadAction = actionRef<{ path: string }, Doc>("docs", "read");
/** User only: `{ path }` of a report → moves it into `archive/`; returns its new path. */
export const KeepAction = actionRef<{ path: string }, { path: string }>(
  "docs",
  "keep",
);
/** No arguments → deletes the reports (not `archive/`) last written over 30 days ago; the daily sweep runs the same. */
export const SweepAction = actionRef<null, { deleted: string[] }>(
  "docs",
  "sweep",
);
/** User only: `{ conversation, path, comments, note? }` → one `docs.comments` input into `conversation`. */
export const SendAction = actionRef<
  DocComments & { conversation: number },
  { conversation: number }
>("docs", "send");

/** One earlier version of a report: `id` names it, `at` is when it was replaced. */
export type Version = { id: string; at: number; size: number };

/** User only: `{ path, text, base }` → replaces a doc's text when its current hash is still `base`; returns the new hash. */
export const WriteAction = actionRef<
  { path: string; text: string; base: string },
  { hash: string }
>("docs", "write");
/** `{ path }` of a report → its earlier versions, newest first (the last 20 saves). */
export const HistoryAction = actionRef<{ path: string }, Version[]>(
  "docs",
  "history",
);
/** `{ path, id }` → the text of one of `history`'s versions. */
export const VersionAction = actionRef<
  { path: string; id: string },
  { text: string }
>("docs", "version");
/** User only: `{ path, message? }` of a repo doc → commits that file alone on the checked-out branch. */
export const CommitAction = actionRef<
  { path: string; message?: string },
  { commit: string }
>("docs", "commit");

/** `{ path }` of a PDF that `list` or `reports` returned → its bytes, base64, at most 20 MB. */
export const FileAction = actionRef<{ path: string }, { data: string }>(
  "docs",
  "file",
);

/** What `begin` answers: an upload id to send chunks to, or that the name is taken (ask, then begin again with `onConflict`). */
export type UploadBegin =
  | { status: "ok"; id: string; path: string; chunkBytes: number }
  | { status: "conflict"; path: string };

/**
 * User only: `{ dir, name, size, onConflict? }` → starts adding a `.md` or `.pdf` (at most 20 MB) to repo folder `dir`
 * (`""` is the root). `onConflict` is `"replace"` or `"keep"` (keep both: `name (2).pdf`).
 */
export const BeginAction = actionRef<
  { dir: string; name: string; size: number; onConflict?: "replace" | "keep" },
  UploadBegin
>("docs", "begin");
/** User only: `{ id, index, data }` → appends one base64 chunk (at most `chunkBytes`), in order. */
export const ChunkAction = actionRef<
  { id: string; index: number; data: string },
  { received: number }
>("docs", "chunk");
/** User only: `{ id }` → moves the upload into place and commits that path alone. */
export const FinishAction = actionRef<
  { id: string },
  { path: string; commit: string }
>("docs", "finish");
/** User only: `{ id }` → drops an unfinished upload. */
export const AbortAction = actionRef<{ id: string }, Record<string, never>>(
  "docs",
  "abort",
);
/** User only: `{ path }` of a repo doc → `git rm` and a commit of that path alone. */
export const RemoveAction = actionRef<
  { path: string },
  { path: string; commit: string }
>("docs", "remove");

/** User only: `{ path, html }`, the rendered HTML of a doc → a PDF of it made on demand by headless Chromium, base64; nothing is stored. */
export const PdfAction = actionRef<
  { path: string; html: string },
  { data: string }
>("docs", "pdf");
