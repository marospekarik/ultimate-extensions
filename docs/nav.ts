export type Target = { path: string; hash: string };
export type Nav = { depth: number };

export const parseTarget = (url: URL): Target | undefined => {
  const path = url.searchParams.get("doc");
  return path
    ? { path, hash: decodeURIComponent(url.hash.slice(1)) }
    : undefined;
};

export const nav: {
  requested: (Target & { push?: boolean }) | undefined;
  anchor: { hash: string };
} = { requested: parseTarget(new URL(location.href)), anchor: { hash: "" } };
nav.anchor = { hash: nav.requested?.hash ?? "" };

const listeners = new Set<() => void>();
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const notify = () => {
  for (const listener of listeners) listener();
};
export const depth = () => (history.state as Nav | null)?.depth ?? 0;

export function openDoc(path: string, hash = "") {
  nav.requested = { path, hash, push: true };
  notify();
}

export const docUrl = (path: string, hash: string) => {
  const url = new URL(location.href);
  url.searchParams.set("doc", path);
  url.hash = hash ? `#${encodeURIComponent(hash)}` : "";
  return url;
};
