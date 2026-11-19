import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { hashOf, parsed } from "./doc.ts";
import {
  ARCHIVE,
  DAY,
  HISTORY,
  KEEP_DAYS,
  MAX_BYTES,
  REPORTS,
} from "./limits.ts";
import type { Doc, Report, Version } from "./refs.ts";

export type Homes = { userHome: string; home: string };

const absent = (error: unknown): undefined => {
  const code = (error as { code?: string } | null)?.code;
  if (code === "ENOENT" || code === "ENOTDIR") return undefined;
  throw error;
};

export const reportsDir = (host: Homes) =>
  join(host.userHome, ".ultimate", "reports", basename(host.home));

const reportName = (name: string) =>
  name.toLowerCase().endsWith(".md") &&
  !name.startsWith(".") &&
  !/[/\\]/.test(name);

const realDir = (host: Homes) => realpath(reportsDir(host)).catch(absent);

async function reportFiles(dir: string) {
  const items = await readdir(dir, { withFileTypes: true }).catch(
    (error: unknown) => {
      absent(error);
      return [];
    },
  );
  const files = [];
  for (const item of items) {
    if (!item.isFile() || !reportName(item.name)) continue;
    const stat = await lstat(join(dir, item.name)).catch(absent);
    if (stat?.isFile())
      files.push({ name: item.name, size: stat.size, modified: stat.mtimeMs });
  }
  return files;
}

export async function reports(
  host: Homes,
): Promise<{ folder: string; reports: Report[] }> {
  const folder = `~${reportsDir(host).slice(host.userHome.length)}/`;
  const dir = await realDir(host);
  if (!dir) return { folder, reports: [] };
  const fresh = (await reportFiles(dir)).map((file) => ({
    path: `${REPORTS}${file.name}`,
    size: file.size,
    modified: file.modified,
    archived: false,
    expires: file.modified + KEEP_DAYS * DAY,
  }));
  const kept = (await reportFiles(join(dir, "archive"))).map((file) => ({
    path: `${ARCHIVE}${file.name}`,
    size: file.size,
    modified: file.modified,
    archived: true,
  }));
  const newest = (a: Report, b: Report) => b.modified - a.modified;
  return {
    folder,
    reports: [...fresh.toSorted(newest), ...kept.toSorted(newest)],
  };
}

export async function reportFile(host: Homes, path: string) {
  const match = /^\.reports\/(archive\/)?([^/]+)$/.exec(path);
  if (!match || !reportName(match[2])) throw new Error(`Not a report: ${path}`);
  const dir = await realDir(host);
  if (!dir) return undefined;
  const file = join(dir, match[1] ? "archive" : "", match[2]);
  const stat = await lstat(file).catch(absent);
  if (!stat?.isFile() || !file.startsWith(dir + sep)) return undefined;
  if ((await realpath(file).catch(absent)) !== file) return undefined;
  return { file, name: match[2], archived: Boolean(match[1]), stat };
}

export async function readReport(host: Homes, requested: string): Promise<Doc> {
  const archived = `${ARCHIVE}${requested.slice(REPORTS.length)}`;
  const moved = requested.startsWith(ARCHIVE) ? undefined : archived;
  const found =
    (await reportFile(host, requested)) ??
    (moved ? await reportFile(host, moved) : undefined);
  const path = found?.archived ? `${ARCHIVE}${found.name}` : requested;
  if (!found) return { status: "missing", path };
  if (found.stat.size > MAX_BYTES)
    return { status: "tooLarge", path, size: found.stat.size };
  return parsed(
    path,
    await readFile(found.file, "utf8"),
    found.stat.size,
    found.stat.mtimeMs,
  );
}

export async function keep(host: Homes, path: string) {
  const found = await reportFile(host, path);
  if (!found) throw new Error(`No report ${path}`);
  if (found.archived) return { path };
  const archive = join(reportsDir(host), "archive");
  await mkdir(archive, { recursive: true });
  const real = await realpath(archive);
  if (real !== join((await realDir(host))!, "archive"))
    throw new Error("archive/ is not a folder inside the reports folder");
  const target = join(real, found.name);
  if (await lstat(target).catch(absent))
    throw new Error(`archive/${found.name} already exists`);
  await rename(found.file, target);
  return { path: `${ARCHIVE}${found.name}` };
}

export async function sweep(host: Homes, now: number) {
  const dir = await realDir(host);
  const deleted: string[] = [];
  if (!dir) return { deleted };
  for (const file of await reportFiles(dir)) {
    if (file.modified >= now - KEEP_DAYS * DAY) continue;
    await unlink(join(dir, file.name)).then(
      async () => {
        deleted.push(file.name);
        await rm(historyDir(dir, file.name), { recursive: true, force: true });
      },
      (error: unknown) => {
        if ((error as { code?: string } | null)?.code !== "ENOENT") throw error;
      },
    );
  }
  return { deleted };
}

const historyDir = (dir: string, name: string) =>
  join(dir, ".history", name.replace(/\.md$/i, ""));

const versionId = /^[0-9TZ]+(?:-[0-9TZ]+)*-[0-9a-f]{4}\.md$/;

export async function writeAtomically(file: string, text: string, mode: number) {
  const temp = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, text, { flag: "wx", mode });
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(absent);
    throw error;
  }
}

export function checkSave(text: unknown, base: unknown, current: string) {
  if (typeof text !== "string" || typeof base !== "string")
    throw new Error("Expected { path, text, base }");
  if (Buffer.byteLength(text) > MAX_BYTES)
    throw new Error("The doc is over 1 MB");
  if (hashOf(current) !== base)
    throw new Error("The doc changed since you opened it. Discard your draft and open it again.");
  return text;
}

async function confinedHistory(dir: string, name: string) {
  const target = historyDir(dir, name);
  const real = await realpath(target).catch(absent);
  if (real !== undefined && real !== target)
    throw new Error("history folder is not inside the reports folder");
  return target;
}

async function snapshotDir(host: Homes, name: string) {
  const dir = (await realDir(host))!;
  const history = join(dir, ".history");
  await mkdir(history, { recursive: true });
  const stat = await lstat(history);
  if (!stat.isDirectory() || (await realpath(history)) !== history)
    throw new Error(".history is not a folder inside the reports folder");
  const target = historyDir(dir, name);
  await mkdir(target, { recursive: true });
  if ((await realpath(target)) !== target)
    throw new Error("history folder is not inside the reports folder");
  return target;
}

export async function writeReport(
  host: Homes,
  path: string,
  text: unknown,
  base: unknown,
) {
  const found = await reportFile(host, path);
  if (!found) throw new Error(`No report ${path}`);
  if (found.archived) throw new Error("Kept reports are read-only");
  const current = await readFile(found.file, "utf8");
  const next = checkSave(text, base, current);
  if (next === current) return { hash: hashOf(current) };
  const target = await snapshotDir(host, found.name);
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 4)}.md`;
  await writeAtomically(join(target, id), current, 0o644);
  const old = (await readdir(target)).filter((n) => versionId.test(n)).toSorted();
  for (const name of old.slice(0, Math.max(0, old.length - HISTORY)))
    await unlink(join(target, name));
  await writeAtomically(found.file, next, found.stat.mode);
  return { hash: hashOf(next) };
}

export async function history(host: Homes, path: string): Promise<Version[]> {
  const found = await reportFile(host, path);
  const dir = await realDir(host);
  if (!found || !dir) return [];
  const target = await confinedHistory(dir, found.name);
  const names = await readdir(target).catch((error: unknown) => {
    absent(error);
    return [] as string[];
  });
  const versions: Version[] = [];
  for (const name of names.filter((n) => versionId.test(n)).toSorted().reverse()) {
    const stat = await lstat(join(target, name));
    if (stat.isFile())
      versions.push({ id: name, at: stat.mtimeMs, size: stat.size });
  }
  return versions;
}

export async function version(host: Homes, path: string, id: unknown) {
  if (typeof id !== "string" || !versionId.test(id))
    throw new Error("Not a version");
  const found = await reportFile(host, path);
  const dir = await realDir(host);
  if (!found || !dir) throw new Error(`No report ${path}`);
  const file = join(await confinedHistory(dir, found.name), id);
  const stat = await lstat(file).catch(absent);
  if (!stat?.isFile()) throw new Error("No such version");
  return { text: await readFile(file, "utf8") };
}
