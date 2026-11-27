import { api } from "@/sdk/solid";
import { imageType } from "./limits.ts";
import { ImageAction } from "./refs.ts";

type Cached = { modified: number; url: string };

const KEEP = 64;
const KEEP_STORED = 300;
const STORE = "docs-images";
const FRESH_MS = 15_000;
const memory = new Map<string, Cached>();
const checks = new Map<string, Promise<string>>();
const checked = new Map<string, number>();

const remember = (path: string, entry: Cached) => {
  const old = memory.get(path);
  memory.delete(path);
  memory.set(path, entry);
  if (old && old.url !== entry.url) URL.revokeObjectURL(old.url);
  for (const [key, value] of memory) {
    if (memory.size <= KEEP) break;
    memory.delete(key);
    URL.revokeObjectURL(value.url);
  }
  return entry.url;
};

const storeKey = (path: string) =>
  `${location.origin}/docs-image/${encodeURIComponent(path)}`;

async function stored(path: string): Promise<Cached | undefined> {
  if (!("caches" in window)) return undefined;
  const response = await (await caches.open(STORE)).match(storeKey(path));
  if (!response) return undefined;
  const modified = Number(response.headers.get("x-modified"));
  return { modified, url: URL.createObjectURL(await response.blob()) };
}

async function store(path: string, modified: number, blob: Blob) {
  if (!("caches" in window)) return;
  const cache = await caches.open(STORE);
  await cache.delete(storeKey(path));
  await cache.put(
    storeKey(path),
    new Response(blob, {
      headers: { "content-type": blob.type, "x-modified": String(modified) },
    }),
  );
  const keys = await cache.keys();
  await Promise.all(
    keys.slice(0, Math.max(0, keys.length - KEEP_STORED)).map((key) =>
      cache.delete(key),
    ),
  );
}

async function fetchImage(path: string, known: Cached | undefined) {
  const answer = await api.action(ImageAction, {
    path,
    modified: known?.modified,
  });
  if (!answer.data) return known!.url;
  const bytes = Uint8Array.from(atob(answer.data), (char) =>
    char.charCodeAt(0),
  );
  const blob = new Blob([bytes], { type: imageType(path) });
  store(path, answer.modified, blob).catch((error: unknown) =>
    console.warn("docs: could not keep image", path, error),
  );
  return remember(path, {
    modified: answer.modified,
    url: URL.createObjectURL(blob),
  });
}

const check = (path: string, known: Cached | undefined) => {
  if (known && Date.now() - (checked.get(path) ?? 0) < FRESH_MS)
    return Promise.resolve(known.url);
  let running = checks.get(path);
  if (!running) {
    running = fetchImage(path, known).finally(() => {
      checks.delete(path);
      checked.set(path, Date.now());
    });
    checks.set(path, running);
  }
  return running;
};

/**
 * The image at `path` as an object URL: a copy kept in the page (or in Cache Storage across reloads) answers at once
 * through `shown`, then the server confirms its modification time and sends bytes only when the file changed.
 */
export async function imageUrl(path: string, shown: (url: string) => void) {
  const inMemory = memory.get(path);
  if (inMemory) {
    shown(inMemory.url);
    return check(path, inMemory);
  }
  const kept = await stored(path).catch((error: unknown) => {
    console.warn("docs: could not read kept image", path, error);
    return undefined;
  });
  if (kept) shown(remember(path, kept));
  return check(path, kept);
}
