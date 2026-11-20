import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { MAX_PDF_BYTES } from "./limits.ts";

export const MAX_UPLOAD = MAX_PDF_BYTES;
export const CHUNK = 2 * 1024 * 1024;
const LOCK_WAIT = 200;
const STALE = 24 * 60 * 60 * 1000;

export type Begin =
  | { status: "ok"; id: string; path: string; chunkBytes: number }
  | { status: "conflict"; path: string };

const git = (root: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(
      "git",
      args,
      { cwd: root, timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) =>
        error
          ? reject(new Error(stderr.trim() || error.message))
          : resolve(stdout),
    ),
  );

const pause = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function gitLocked(root: string, args: string[]) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await git(root, args);
    } catch (error) {
      if (
        attempt >= 8 ||
        !/index\.lock|Unable to create .*\.lock/.test((error as Error).message)
      )
        throw error;
      await pause(LOCK_WAIT * (attempt + 1));
    }
  }
}

const parts = (rel: string) =>
  rel.split(/[\\/]+/).filter((part) => part && part !== ".");

export function folderOf(dir: unknown) {
  if (typeof dir !== "string" || dir.includes("\0") || dir.length > 500)
    throw new Error("Invalid folder");
  if (/^([\\/]|[a-zA-Z]:)/.test(dir))
    throw new Error("Absolute paths are not allowed");
  const segments = parts(dir);
  if (segments.includes("..")) throw new Error("Paths may not contain ..");
  if (segments.some((part) => part.startsWith(".")))
    throw new Error("Folders starting with . are not shown in Docs");
  return segments.join("/");
}

export function nameOf(name: unknown) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    /[\\/\0]/.test(name) ||
    name.startsWith(".") ||
    name.length > 200
  )
    throw new Error("Invalid file name");
  if (!/\.(md|pdf)$/i.test(name))
    throw new Error("Only Markdown (.md) and PDF files can be added");
  return name.normalize("NFC");
}

export async function confine(root: string, rel: string) {
  let current = root;
  for (const part of parts(rel)) {
    current = join(current, part);
    const info = await lstat(current).catch(() => undefined);
    if (info?.isSymbolicLink())
      throw new Error(`Symlinks are not followed: ${part}`);
  }
  return join(root, ...parts(rel));
}

async function unique(dir: string, name: string) {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!(await lstat(join(dir, candidate)).catch(() => undefined)))
      return candidate;
  }
}

type Upload = {
  temp: string;
  path: string;
  size: number;
  received: number;
  next: number;
  replace: boolean;
};

export function uploads(root: string) {
  const open_ = new Map<string, Upload>();
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  };
  const temps = async () => {
    const dir = join(
      (await git(root, ["rev-parse", "--absolute-git-dir"])).trim(),
      "docs-uploads",
    );
    await mkdir(dir, { recursive: true });
    for (const old of await readdir(dir)) {
      const info = await lstat(join(dir, old)).catch(() => undefined);
      if (info && info.mtimeMs < Date.now() - STALE)
        await rm(join(dir, old), { force: true });
    }
    return dir;
  };
  const head = async () =>
    (await git(root, ["rev-parse", "--short", "HEAD"])).trim();

  return {
    async begin(args: {
      dir: unknown;
      name: unknown;
      size: unknown;
      onConflict?: unknown;
    }): Promise<Begin> {
      const dir = folderOf(args.dir);
      let name = nameOf(args.name);
      const size = args.size;
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)
        throw new Error("Invalid size");
      if (size > MAX_UPLOAD)
        throw new Error(
          `${name} is over ${MAX_UPLOAD / 1024 / 1024} MB, the most Docs takes`,
        );
      const absDir = await confine(root, dir);
      const existing = await lstat(join(absDir, name)).catch(() => undefined);
      const at = (file: string) => (dir ? `${dir}/${file}` : file);
      if (existing) {
        if (args.onConflict === "keep") name = await unique(absDir, name);
        else if (args.onConflict !== "replace")
          return { status: "conflict", path: at(name) };
        else if (!existing.isFile()) throw new Error("Cannot replace a folder");
      }
      const id = randomUUID();
      const temp = join(await temps(), id);
      await (await open(temp, "w")).close();
      open_.set(id, {
        temp,
        path: at(name),
        size,
        received: 0,
        next: 0,
        replace: Boolean(existing) && args.onConflict === "replace",
      });
      return { status: "ok", id, path: at(name), chunkBytes: CHUNK };
    },

    async chunk(id: unknown, index: unknown, data: unknown) {
      const upload = open_.get(String(id));
      if (!upload) throw new Error("Unknown upload");
      if (index !== upload.next)
        throw new Error(`Expected chunk ${upload.next}, got ${String(index)}`);
      if (typeof data !== "string") throw new Error("Expected base64 data");
      const bytes = Buffer.from(data, "base64");
      if (bytes.length > CHUNK) throw new Error("Chunk too large");
      if (upload.received + bytes.length > upload.size)
        throw new Error("More data than announced");
      const handle = await open(upload.temp, "a");
      try {
        await handle.write(bytes);
      } finally {
        await handle.close();
      }
      upload.received += bytes.length;
      upload.next++;
      return { received: upload.received };
    },

    async abort(id: unknown) {
      const upload = open_.get(String(id));
      open_.delete(String(id));
      if (upload) await rm(upload.temp, { force: true });
      return {};
    },

    finish(id: unknown): Promise<{ path: string; commit: string }> {
      return serial(async () => {
        const upload = open_.get(String(id));
        if (!upload) throw new Error("Unknown upload");
        try {
          if (upload.received !== upload.size)
            throw new Error(
              `Incomplete upload: ${upload.received} of ${upload.size} bytes`,
            );
          const abs = await confine(root, upload.path);
          const exists = await lstat(abs).catch(() => undefined);
          if (exists && !upload.replace)
            throw new Error(`${upload.path} appeared meanwhile; add it again`);
          await mkdir(dirname(abs), { recursive: true });
          const previous = exists ? `${upload.temp}.previous` : undefined;
          if (previous) await rename(abs, previous);
          await rename(upload.temp, abs);
          try {
            await gitLocked(root, ["add", "--", upload.path]);
            await gitLocked(root, [
              "commit",
              "--only",
              "--quiet",
              "--allow-empty",
              "-m",
              `Docs: ${previous ? "replace" : "add"} ${upload.path}`,
              "--",
              upload.path,
            ]);
          } catch (error) {
            await git(root, ["reset", "--quiet", "--", upload.path]).catch(
              () => undefined,
            );
            await rm(abs, { force: true });
            if (previous) await rename(previous, abs);
            throw error;
          }
          if (previous) await rm(previous, { force: true });
          return { path: upload.path, commit: await head() };
        } finally {
          await rm(upload.temp, { force: true });
          open_.delete(String(id));
        }
      });
    },

    remove(path: string): Promise<{ path: string; commit: string }> {
      return serial(async () => {
        await gitLocked(root, ["rm", "--quiet", "--", path]);
        await gitLocked(root, [
          "commit",
          "--only",
          "--quiet",
          "-m",
          `Docs: remove ${path}`,
          "--",
          path,
        ]);
        return { path, commit: await head() };
      });
    },
  };
}
