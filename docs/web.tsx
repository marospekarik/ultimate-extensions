import type { ConversationId, EntryRecord } from "@earendil-works/pi-durable";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  CheckIcon,
  GitCommitHorizontalIcon,
  HistoryIcon,
  PencilIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileDownIcon,
  FileTextIcon,
  ListIcon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  RefreshCwIcon,
  SendIcon,
  Share2Icon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { MessageResponse } from "@/components/ai/message";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  api,
  cn,
  Conversation,
  defineWebExtension,
  docRef,
  Dock,
  Fold,
  formatAgo,
  formatBytes,
  Header,
  ROOT,
  StatusLine,
  touchKeyboard,
  useAction,
  useConversations,
  useDocOf,
  useExtensionUiState,
  useNow,
  useUltimate,
  useViewport,
} from "@/sdk";
import type { Viewport } from "@/sdk";
import { Editor } from "./editor.tsx";
import { prefixOf } from "./blocks.ts";
import { docPath, findHeading, headingIds, linkify } from "./links.ts";
import { ARCHIVE, DAY, isReport, limits, shownPath } from "./limits.ts";
import {
  CommitAction,
  FileAction,
  HistoryAction,
  PdfAction,
  KeepAction,
  ListAction,
  ReadAction,
  ReportsAction,
  SendAction,
  VersionAction,
  WriteAction,
} from "./refs.ts";
import type { Doc, DocComment, DocComments, Report } from "./refs.ts";

const StandingDoc = docRef<Record<string, number>>("ultimate.standing-agents");

type Target = { path: string; hash: string };
type Nav = { depth: number };

const parseTarget = (url: URL): Target | undefined => {
  const path = url.searchParams.get("doc");
  return path
    ? { path, hash: decodeURIComponent(url.hash.slice(1)) }
    : undefined;
};

let requested: (Target & { push?: boolean }) | undefined = parseTarget(
  new URL(location.href),
);
let anchor = { hash: requested?.hash ?? "" };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const notify = () => {
  for (const listener of listeners) listener();
};
const depth = () => (history.state as Nav | null)?.depth ?? 0;

export function openDoc(path: string, hash = "") {
  requested = { path, hash, push: true };
  notify();
}

const docUrl = (path: string, hash: string) => {
  const url = new URL(location.href);
  url.searchParams.set("doc", path);
  url.hash = hash ? `#${encodeURIComponent(hash)}` : "";
  return url;
};

const useSelected = () => useExtensionUiState<string | null>("selected", null);

function DocLink() {
  const wanted = useSyncExternalStore(subscribe, () => requested);
  const [selected, setSelected] = useSelected();
  const { surface, showSurface } = useUltimate();
  useEffect(() => {
    if (wanted === undefined) return;
    requested = undefined;
    anchor = { hash: wanted.hash };
    if (wanted.push && wanted.path !== selected)
      history.pushState(
        { depth: depth() + 1 } satisfies Nav,
        "",
        docUrl(wanted.path, wanted.hash),
      );
    setSelected(wanted.path);
    showSurface("docs");
    notify();
  }, [wanted, selected, setSelected, showSurface]);
  useEffect(() => {
    const back = () => {
      const target = parseTarget(new URL(location.href));
      if (!target) return;
      anchor = { hash: target.hash };
      setSelected(target.path);
      notify();
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [setSelected]);
  useEffect(() => {
    if (requested !== undefined) return;
    const url = new URL(location.href);
    const shown = surface === "docs" ? selected : null;
    if (url.searchParams.get("doc") === shown) return;
    if (shown === null) url.searchParams.delete("doc");
    else url.searchParams.set("doc", shown);
    history.replaceState(history.state, "", url);
  }, [surface, selected]);
  return null;
}

const absoluteLinks = (body: string, from: string) =>
  body
    .replace(
      /\]\(([^)\s]+?\.(?:md|pdf))((?:#[^)\s]*)?)\)/gi,
      (match, target: string, hash: string) => {
        const path = docPath(target, from);
        return path ? `](/${path}${hash})` : match;
      },
    )
    .replace(
      /\]\((#[^)\s]*)\)/g,
      (_match, hash: string) => `](/${from}${hash})`,
    );

function Link({
  href,
  children,
  core,
}: {
  href: string;
  children: ReactNode;
  core: ReactNode;
}) {
  const path = docPath(href);
  if (!path) return core;
  const hash = decodeURIComponent(href.split("#")[1] ?? "");
  return (
    <a
      href={docUrl(path, hash).search + (hash ? `#${hash}` : "")}
      onClick={(event) => {
        event.preventDefault();
        openDoc(path, hash);
      }}
      title={`Open ${path}${hash ? `#${hash}` : ""} in Docs`}
    >
      {children}
    </a>
  );
}

function groupOf(path: string) {
  const parts = path.split("/");
  if (parts.length === 1) return "";
  if (parts.length >= 3) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

function FileButton({
  path,
  label,
  note,
  selected,
  onSelect,
}: {
  path: string;
  label: string;
  note?: string;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  return (
    <button
      className={cn(
        "hover:bg-accent/60 flex w-full items-baseline gap-2 px-3 py-1 text-left text-[12.5px] pointer-coarse:py-3 pointer-coarse:text-[14px]",
        selected && "bg-accent text-foreground",
      )}
      onClick={() => onSelect(path)}
      title={path}
      type="button"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {note && (
        <span className="text-muted-foreground/70 shrink-0 font-mono text-[10.5px]">
          {note}
        </span>
      )}
    </button>
  );
}

function Reports({
  folder,
  reports,
  filtering,
  selected,
  onSelect,
}: {
  folder?: string;
  reports: Report[];
  filtering: boolean;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const now = useNow(60 * 60_000);
  const fresh = reports.filter((report) => !report.archived);
  const kept = reports.filter((report) => report.archived);
  const row = (report: Report) => (
    <FileButton
      key={report.path}
      label={report.path.slice(report.path.lastIndexOf("/") + 1)}
      note={
        report.expires === undefined
          ? undefined
          : `${Math.max(0, Math.ceil((report.expires - now) / DAY))}d left`
      }
      onSelect={onSelect}
      path={report.path}
      selected={report.path === selected}
    />
  );
  return (
    <>
      {(fresh.length > 0 || (reports.length === 0 && !filtering && folder)) && (
        <section title={folder}>
          <h3 className="text-muted-foreground/80 px-3 pt-3 pb-1 font-mono text-[10.5px] tracking-wider uppercase">
            Reports
          </h3>
          {fresh.map(row)}
          {reports.length === 0 && (
            <p className="text-muted-foreground/60 truncate px-3 py-1 font-mono text-[11px]">
              none yet · {folder}
            </p>
          )}
        </section>
      )}
      {kept.length > 0 && (
        <section title={folder && `${folder}archive/`}>
          <h3 className="text-muted-foreground/80 px-3 pt-3 pb-1 font-mono text-[10.5px] tracking-wider uppercase">
            Reports · kept
          </h3>
          {kept.map(row)}
        </section>
      )}
    </>
  );
}

function Files({
  paths,
  folder,
  reports,
  selected,
  onSelect,
  className,
}: {
  paths: string[];
  folder?: string;
  reports: Report[];
  selected: string | null;
  onSelect: (path: string) => void;
  className?: string;
}) {
  const [filter, setFilter] = useExtensionUiState("filter", "");
  const needle = filter.trim().toLowerCase();
  const shownReports = reports.filter(
    (report) => !needle || report.path.toLowerCase().includes(needle),
  );
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const path of paths) {
      if (needle && !path.toLowerCase().includes(needle)) continue;
      const group = groupOf(path);
      map.set(group, [...(map.get(group) ?? []), path]);
    }
    const rank = (group: string) => (group === "" ? 0 : 1);
    return [...map].toSorted(
      ([a], [b]) => rank(a) - rank(b) || a.localeCompare(b),
    );
  }, [paths, needle]);
  return (
    <nav className={cn("bg-sidebar flex min-h-0 flex-col", className)}>
      <input
        aria-label="Filter docs"
        className="border-border/70 placeholder:text-muted-foreground/60 bg-background focus:border-brand/50 m-2 rounded-md border px-2 py-1 font-mono text-[12px] outline-none pointer-coarse:h-11"
        onChange={(event) => setFilter(event.target.value)}
        placeholder={`Filter ${paths.length + reports.length} docs…`}
        value={filter}
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        <Reports
          filtering={Boolean(needle)}
          folder={folder}
          onSelect={onSelect}
          reports={shownReports}
          selected={selected}
        />
        {groups.map(([group, items]) => (
          <section key={group}>
            <h3 className="text-muted-foreground/80 px-3 pt-3 pb-1 font-mono text-[10.5px] tracking-wider uppercase">
              {group || "Repository"}
            </h3>
            {items.map((path) => (
              <FileButton
                key={path}
                label={group ? path.slice(group.length + 1) : path}
                onSelect={onSelect}
                path={path}
                selected={path === selected}
              />
            ))}
          </section>
        ))}
        {groups.length === 0 && shownReports.length === 0 && (
          <p className="text-muted-foreground px-3 py-2 font-mono text-[12px]">
            No docs match.
          </p>
        )}
      </div>
    </nav>
  );
}

function FilesDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [open, onClose]);
  return (
    <div
      className={cn("fixed inset-0 z-40", !open && "pointer-events-none")}
      inert={!open}
    >
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 bg-black/50 transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      <aside
        aria-label="Docs"
        className={cn(
          "border-sidebar-border absolute inset-y-0 left-0 flex w-[85%] max-w-[26rem] flex-col border-r pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl shadow-black/40 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          !open && "-translate-x-full",
        )}
      >
        {children}
      </aside>
    </div>
  );
}

function Path({ path }: { path: string | null }) {
  if (!path)
    return (
      <span className="text-muted-foreground font-mono text-[12px]">Docs</span>
    );
  const cut = path.lastIndexOf("/") + 1;
  const folder = isReport(path) ? path.slice(1, cut) : path.slice(0, cut);
  return (
    <span className="flex min-w-0 font-mono text-[12px]" title={path}>
      <span className="text-muted-foreground/70 min-w-0 truncate">
        {folder}
      </span>
      <span className="text-muted-foreground shrink-0">{path.slice(cut)}</span>
    </span>
  );
}

function value(item: unknown): string {
  if (item === null || item === undefined) return "";
  if (Array.isArray(item)) return item.map(value).join(", ");
  if (item instanceof Date) return item.toISOString().slice(0, 10);
  if (typeof item === "object") return JSON.stringify(item);
  return `${item as string | number | boolean}`;
}

function Frontmatter({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;
  return (
    <dl className="border-border/70 bg-muted/20 border-l-brand/50 mb-5 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-md border border-l-2 px-3 py-2 text-[12.5px]">
      {entries.map(([key, item]) => (
        <div className="contents" key={key}>
          <dt className="text-muted-foreground font-mono text-[11.5px]">
            {key}
          </dt>
          <dd className="min-w-0 break-words">{value(item)}</dd>
        </div>
      ))}
    </dl>
  );
}

function headingAbove(node: Node | null, root: HTMLElement) {
  const element = node instanceof Element ? node : node?.parentElement;
  if (!element) return undefined;
  const headings = [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  const above = headings.filter(
    (heading) =>
      heading === element ||
      heading.compareDocumentPosition(element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
  );
  return above.at(-1)?.textContent?.trim() || undefined;
}

type Draft = { quote?: string; heading?: string };

function Body({
  doc,
  known,
  onComment,
}: {
  doc: Extract<Doc, { status: "ok" }>;
  known: Set<string>;
  onComment: (draft: Draft) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const target = useSyncExternalStore(subscribe, () => anchor);
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const place = () => {
      const headings = [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")];
      const ids = headingIds(headings.map((item) => item.textContent ?? ""));
      headings.forEach((item, index) => {
        if (item.id !== ids[index]) item.id = ids[index];
      });
      return ids;
    };
    const jump = () => {
      if (!target.hash) return;
      const ids = place();
      const found = findHeading(ids, target.hash);
      if (found < 0) return;
      root
        .querySelectorAll("h1, h2, h3, h4, h5, h6")
        [found].scrollIntoView({ block: "start" });
    };
    place();
    jump();
    const watch = new MutationObserver(() => {
      place();
    });
    watch.observe(root, { childList: true, subtree: true });
    const settle = setTimeout(jump, 150);
    return () => {
      clearTimeout(settle);
      watch.disconnect();
    };
  }, [doc.body, target]);
  const [pick, setPick] = useState<(Draft & { top: number }) | null>(null);
  const touch = touchKeyboard();
  const select = () => {
    const root = ref.current;
    const selection = getSelection();
    const quote = selection?.toString().trim();
    if (
      !root ||
      !selection ||
      !quote ||
      selection.rangeCount === 0 ||
      !root.contains(selection.anchorNode)
    ) {
      setPick(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const box = root.getBoundingClientRect();
    setPick({
      quote: quote.slice(0, limits.quote),
      heading: headingAbove(selection.anchorNode, root),
      top: rect.top - box.top,
    });
  };
  useEffect(() => {
    if (!touch) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const change = () => {
      clearTimeout(timer);
      timer = setTimeout(select, 400);
    };
    document.addEventListener("selectionchange", change);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", change);
    };
  });
  return (
    <div
      className="relative"
      data-docs-body={doc.path}
      onMouseUp={touch ? undefined : select}
      ref={ref}
    >
      <Frontmatter data={doc.frontmatter} />
      <div data-docs-markdown>
        <MessageResponse
          className="text-[14px] leading-relaxed"
          mode="static"
          parseIncompleteMarkdown={false}
        >
          {linkify(absoluteLinks(doc.body, doc.path), doc.path, known)}
        </MessageResponse>
      </div>
      {pick && (
        <Button
          className={cn(
            "shadow-sm",
            touch
              ? "sticky bottom-4 z-10 mx-auto mt-4 flex h-11 rounded-full px-5 text-[14px] shadow-lg shadow-black/30"
              : "absolute -right-2",
          )}
          onClick={() => {
            onComment({ quote: pick.quote, heading: pick.heading });
            setPick(null);
            getSelection()?.removeAllRanges();
          }}
          onMouseUp={(event) => event.stopPropagation()}
          size="xs"
          style={touch ? undefined : { top: Math.max(0, pick.top - 28) }}
        >
          <MessageSquarePlusIcon className={cn(touch && "size-4!")} />
          {touch ? "Comment on selection" : "Comment"}
        </Button>
      )}
    </div>
  );
}

function pdfFile(path: string, data: string) {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new File([bytes], path.split("/").pop() ?? "doc.pdf", {
    type: "application/pdf",
  });
}

const mdFile = (path: string, text: string) =>
  new File([text], path.split("/").pop() ?? "doc.md", {
    type: "text/markdown",
  });

const canShareFiles = () =>
  navigator.canShare?.({
    files: [new File([], "doc.pdf", { type: "application/pdf" })],
  }) ?? false;

async function saveFile(file: File, share: boolean) {
  const name = file.name;
  if (share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        throw error;
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

async function renderPdf(path: string) {
  const source = document.querySelector("[data-docs-markdown]");
  if (!source) throw new Error("Open the doc first");
  const copy = source.cloneNode(true) as HTMLElement;
  copy
    .querySelectorAll(
      "button, svg, script, style, [data-streamdown=code-block-header]",
    )
    .forEach((node) => node.remove());
  copy.querySelectorAll("a").forEach((link) => {
    link.setAttribute("href", link.href);
  });
  const { data } = await api.action(PdfAction, { path, html: copy.innerHTML });
  const name = (path.split("/").pop() ?? "doc").replace(/\.md$/i, "");
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new File([bytes], `${name}.pdf`, { type: "application/pdf" });
}

const coarse =
  "pointer-coarse:h-11 pointer-coarse:px-3 pointer-coarse:text-[13px]";
const iconCoarse = "pointer-coarse:size-11";

type Pending = { comments: DocComment[]; note: string };
const empty: Pending = { comments: [], note: "" };

function PdfView({ path, phone }: { path: string; phone: boolean }) {
  const pdf = useAction(FileAction, { path });
  const file = useMemo(
    () => (pdf.data ? pdfFile(path, pdf.data.data) : undefined),
    [path, pdf.data],
  );
  const url = useMemo(() => file && URL.createObjectURL(file), [file]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  if (pdf.error)
    return (
      <p className="text-error font-mono text-[12px]">{pdf.error.message}</p>
    );
  if (!file || !url)
    return (
      <p className="text-muted-foreground font-mono text-[12px]">loading…</p>
    );
  if (phone || touchKeyboard())
    return (
      <div className="border-border/70 bg-secondary/40 mx-auto flex max-w-sm flex-col items-center gap-3 rounded-lg border p-6 text-center">
        <FileTextIcon className="text-brand size-8" />
        <p className="max-w-full font-mono text-[12.5px] break-all">
          {file.name}
        </p>
        <p className="text-muted-foreground font-mono text-[11.5px]">
          {formatBytes(file.size)} · PDF
        </p>
        <Button asChild className="h-11 w-full text-[14px]">
          <a href={url} rel="noreferrer" target="_blank">
            <ExternalLinkIcon />
            Open
          </a>
        </Button>
        <Button
          className="h-11 w-full text-[14px]"
          onClick={() => void saveFile(file, touchKeyboard())}
          variant="outline"
        >
          <DownloadIcon />
          Download
        </Button>
      </div>
    );
  return (
    <iframe
      className="border-border/70 h-[calc(100dvh-12.5rem)] w-full rounded-md border bg-white"
      src={url}
      title={file.name}
    />
  );
}

function Composer({
  draft,
  onAdd,
  onCancel,
}: {
  draft: Draft;
  onAdd: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="border-border/70 bg-background rounded-md border p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onAdd(text.trim());
      }}
    >
      <Where comment={draft} />
      <textarea
        autoFocus
        onFocus={(event) => {
          const form = event.currentTarget.form;
          if (touchKeyboard())
            setTimeout(() => form?.scrollIntoView({ block: "nearest" }), 300);
        }}
        className="placeholder:text-muted-foreground/50 mt-1.5 block min-h-16 w-full resize-y bg-transparent text-[13px] leading-relaxed outline-none"
        maxLength={limits.text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            text.trim()
          )
            onAdd(text.trim());
        }}
        placeholder="A question, a challenge, a change you want…"
        value={text}
      />
      <div className="flex justify-end gap-1.5">
        <Button
          className={coarse}
          onClick={onCancel}
          size="xs"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          className={coarse}
          disabled={!text.trim()}
          size="xs"
          type="submit"
        >
          Add comment
        </Button>
      </div>
    </form>
  );
}

function Where({ comment }: { comment: Draft }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground font-mono text-[11px]">
        {comment.heading ? `§ ${comment.heading}` : "On the doc"}
      </p>
      {comment.quote && (
        <blockquote className="border-border text-muted-foreground line-clamp-3 border-l-2 pl-2 text-[12.5px]">
          {comment.quote}
        </blockquote>
      )}
    </div>
  );
}

function Recipient({
  value: chosen,
  onChange,
}: {
  value: number;
  onChange: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const standing = useDocOf(ROOT, StandingDoc) ?? {};
  const agents = new Map(
    Object.entries(standing).map(([name, id]) => [id, name]),
  );
  const conversations = useConversations();
  const nameOf = (id: number) =>
    agents.has(id)
      ? `@${agents.get(id)}`
      : `#${id} ${conversations.find((item) => item.id === id)?.title ?? ""}`.trim();
  const needle = query.trim().toLowerCase();
  const recent = conversations
    .filter(
      (item) =>
        !item.parentConversationId && !agents.has(item.id) && item.title,
    )
    .toSorted((a, b) => (b.inputAt ?? b.id) - (a.inputAt ?? a.id))
    .filter(
      (item) =>
        !needle || `#${item.id} ${item.title}`.toLowerCase().includes(needle),
    )
    .slice(0, 30);
  const choose = (id: number) => {
    setOpen(false);
    setQuery("");
    onChange(id);
  };
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          className="border-border/70 text-muted-foreground hover:bg-accent/60 flex h-6 max-w-64 min-w-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 font-mono text-[11.5px] pointer-coarse:h-11"
          title="Who the comments go to"
          type="button"
        >
          <SendIcon className="size-3 shrink-0" />
          to{" "}
          <span className="text-foreground/90 min-w-0 truncate">
            {nameOf(chosen)}
          </span>
          <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(24rem,calc(100vw-1rem))] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            className="font-mono text-[12.5px]"
            onValueChange={setQuery}
            placeholder="Send the comments to…"
            value={query}
          />
          <CommandList className="max-h-[60vh]">
            <CommandGroup heading="Agents">
              {[...agents].map(([id, name]) => (
                <CommandItem
                  className="font-mono text-[12.5px]"
                  key={id}
                  onSelect={() => choose(id)}
                  value={String(id)}
                >
                  @{name}
                </CommandItem>
              ))}
            </CommandGroup>
            {recent.length > 0 && (
              <CommandGroup heading="Conversations">
                {recent.map((item) => (
                  <CommandItem
                    className="gap-2 text-[12.5px]"
                    key={item.id}
                    onSelect={() => choose(item.id)}
                    value={String(item.id)}
                  >
                    <span className="text-muted-foreground font-mono">
                      #{item.id}
                    </span>
                    <span className="truncate">{item.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Comments({
  path,
  pending,
  setPending,
  draft,
  setDraft,
}: {
  path: string;
  pending: Pending;
  setPending: (next: Pending) => void;
  draft: Draft | null;
  setDraft: (draft: Draft | null) => void;
}) {
  const standing = useDocOf(ROOT, StandingDoc);
  const [to, setTo] = useExtensionUiState<number | null>("to", null);
  const recipient = to ?? standing?.ultimate ?? 1;
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent?: number; error?: string }>({});
  const { switchConversation, showSurface } = useUltimate();
  const count = pending.comments.length;
  if (count === 0 && !draft && !result.sent) return null;
  const send = async () => {
    setSending(true);
    setResult({});
    try {
      await api.action(SendAction, {
        conversation: recipient,
        path,
        comments: pending.comments,
        ...(pending.note.trim() && { note: pending.note.trim() }),
      });
      setPending(empty);
      setResult({ sent: recipient });
    } catch (error) {
      setResult({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="border-border/70 bg-sidebar max-h-[50%] shrink-0 space-y-2 overflow-y-auto border-t px-4 py-2.5 max-md:px-3">
      {draft && (
        <Composer
          draft={draft}
          onAdd={(text) => {
            setPending({
              ...pending,
              comments: [...pending.comments, { ...draft, text }],
            });
            setDraft(null);
            setResult({});
          }}
          onCancel={() => setDraft(null)}
        />
      )}
      {pending.comments.map((comment, index) => (
        <div
          className="border-border/60 group bg-background/60 relative rounded-md border px-2.5 py-2"
          key={index}
        >
          <Where comment={comment} />
          <p className="mt-1 text-[13px] whitespace-pre-wrap">{comment.text}</p>
          <button
            aria-label="Delete comment"
            className="text-muted-foreground hover:text-foreground absolute top-1.5 right-1.5 flex cursor-pointer items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:top-0 pointer-coarse:right-0 pointer-coarse:size-11 pointer-coarse:opacity-100"
            onClick={() =>
              setPending({
                ...pending,
                comments: pending.comments.filter((_, at) => at !== index),
              })
            }
            type="button"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ))}
      {count > 0 && (
        <textarea
          aria-label="Overall note"
          className="border-border/70 placeholder:text-muted-foreground/50 bg-background focus:border-brand/50 block min-h-9 w-full resize-y rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
          maxLength={limits.note}
          onChange={(event) =>
            setPending({ ...pending, note: event.target.value })
          }
          placeholder="An overall note (optional)"
          rows={1}
          value={pending.note}
        />
      )}
      {result.error && (
        <p className="text-error font-mono text-[11.5px]">
          Not sent: {result.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-[11.5px]">
          <MessageSquareIcon className="text-brand size-3.5" />
          {count > 0 ? `${count} pending` : null}
          {count === 0 && result.sent !== undefined && (
            <button
              className="hover:text-foreground cursor-pointer underline-offset-2 hover:underline"
              onClick={() => {
                switchConversation(result.sent! as ConversationId);
                showSurface("agent");
              }}
              type="button"
            >
              Sent to #{result.sent}
            </button>
          )}
        </span>
        {count > 0 && (
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <Recipient onChange={setTo} value={recipient} />
            <Button
              className={coarse}
              onClick={() => setPending(empty)}
              size="xs"
              variant="ghost"
            >
              Discard
            </Button>
            <Button
              className={coarse}
              disabled={sending || count > limits.comments}
              onClick={() => void send()}
              size="xs"
            >
              {sending ? "Sending…" : `Send (${count})`}
              <ArrowRightIcon />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Versions({
  path,
  onPick,
}: {
  path: string;
  onPick: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const versions = useAction(HistoryAction, { path }, { enabled: open });
  const now = useNow(60_000);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label="Earlier versions"
          className={iconCoarse}
          size="icon-xs"
          title="Earlier versions of this report"
          variant="ghost"
        >
          <HistoryIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        {(versions.data ?? []).length === 0 && (
          <p className="text-muted-foreground px-2 py-2 font-mono text-[11.5px]">
            No earlier versions yet. Each save keeps the one it replaces.
          </p>
        )}
        {(versions.data ?? []).map((item) => (
          <button
            className="hover:bg-accent/60 flex w-full items-baseline justify-between gap-2 rounded px-2 py-1.5 text-left font-mono text-[12px] pointer-coarse:py-3"
            key={item.id}
            onClick={async () => {
              const { text } = await api.action(VersionAction, {
                path,
                id: item.id,
              });
              setOpen(false);
              onPick(text);
            }}
            type="button"
          >
            <span>{formatAgo(item.at, now, { ago: true })}</span>
            <span className="text-muted-foreground/70">
              {formatBytes(item.size)}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function Docs() {
  const list = useAction(ListAction);
  const reports = useAction(ReportsAction);
  const [selected, setSelected] = useSelected();
  const paths = list.data ?? [];
  const known = useMemo(() => new Set(paths), [paths]);
  const reportList = reports.data?.reports ?? [];
  const path = shownPath(selected, paths);
  const doc = useAction(
    ReadAction,
    { path: path ?? "" },
    { enabled: path !== null },
  );
  const [all, setAll] = useExtensionUiState<Record<string, Pending>>(
    "comments",
    {},
  );
  const pending = (path && all[path]) || empty;
  const setPending = (next: Pending) =>
    path &&
    setAll((previous) => {
      const rest = { ...previous };
      delete rest[path];
      return next.comments.length || next.note
        ? { ...rest, [path]: next }
        : rest;
    });
  const [opened, setOpened] = useState<{
    path: string | null;
    draft: Draft;
  } | null>(null);
  const draft = opened?.path === path ? opened.draft : null;
  const setDraft = (next: Draft | null) =>
    setOpened(next ? { path, draft: next } : null);
  const now = useNow(60_000);
  const [keeping, setKeeping] = useState<{ busy?: boolean; error?: string }>(
    {},
  );
  const keep = async (from: string) => {
    setKeeping({ busy: true });
    try {
      const { path: to } = await api.action(KeepAction, { path: from });
      setAll((previous) => {
        if (!previous[from]) return previous;
        const { [from]: moved, ...rest } = previous;
        return { ...rest, [to]: moved };
      });
      setSelected(to);
      await reports.refetch();
      setKeeping({});
    } catch (error) {
      setKeeping({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const [editing, setEditing] = useState<{
    path: string;
    draft: string;
    base: string;
    prefix: string;
    note?: string;
  } | null>(null);
  const [saving, setSaving] = useState<{ busy?: boolean; error?: string }>({});
  const edit = editing?.path === path ? editing : null;
  const startEditing = (text?: string) => {
    if (!path || data?.status !== "ok") return;
    const prefix = prefixOf(data.text, data.body);
    if (text !== undefined && !text.startsWith(prefix)) {
      setSaving({
        error:
          "That version has different frontmatter and can't be restored here.",
      });
      return;
    }
    const draft = text === undefined ? data.body : text.slice(prefix.length);
    if (prefix + data.body !== data.text) {
      setSaving({ error: "This doc's frontmatter can't be edited here." });
      return;
    }
    setSaving({});
    setEditing({
      path,
      draft,
      base: data.hash,
      prefix,
      note: text === undefined ? undefined : "restored",
    });
  };
  const stopEditing = () => {
    setEditing(null);
    setSaving({});
  };
  const save = async () => {
    if (!edit || data?.status !== "ok") return;
    setSaving({ busy: true });
    try {
      await api.action(WriteAction, {
        path: data.path,
        text: edit.prefix + edit.draft,
        base: edit.base,
      });
      await doc.refetch();
      await reports.refetch();
      stopEditing();
    } catch (error) {
      setSaving({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const commit = async (target: string) => {
    setSaving({ busy: true });
    try {
      await api.action(CommitAction, { path: target });
      await doc.refetch();
      setSaving({});
    } catch (error) {
      setSaving({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!anchor.hash) main.current?.scrollTo({ top: 0 });
  }, [path]);
  const data = doc.data;
  const exportDoc = (how: "download" | "pdf" | "share") => {
    if (data?.status !== "ok" && data?.status !== "pdf") return;
    setSaving({ busy: true });
    const file =
      how === "pdf"
        ? renderPdf(data.path)
        : data.status === "ok"
          ? Promise.resolve(mdFile(data.path, data.text))
          : api
              .action(FileAction, { path: data.path })
              .then(({ data: bytes }) => pdfFile(data.path, bytes));
    file
      .then((file) => saveFile(file, how === "share" || touchKeyboard()))
      .then(
        () => setSaving({}),
        (error: unknown) =>
          setSaving({
            error: error instanceof Error ? error.message : String(error),
          }),
      );
  };
  const viewport: Viewport = useViewport();
  const drawer = viewport === "phone";
  const [filesOpen, setFilesOpen] = useState(false);
  const closeFiles = useCallback(() => setFilesOpen(false), []);
  const files = (
    <Files
      className={drawer ? "flex-1" : "border-border/70 w-72 shrink-0 border-r"}
      onSelect={(next) => {
        setSelected(next);
        setFilesOpen(false);
      }}
      paths={paths}
      folder={reports.data?.folder}
      reports={reportList}
      selected={path}
    />
  );
  const report = path !== null && isReport(path) ? data : undefined;
  const kept =
    (report?.status === "ok" || report?.status === "pdf") &&
    report.path.startsWith(ARCHIVE);
  const expires = reportList.find((item) => item.path === path)?.expires;
  return (
    <>
      <Header>
        {drawer && (
          <Button
            aria-expanded={filesOpen}
            aria-label="Show docs"
            className="text-muted-foreground hover:text-foreground size-7 shrink-0 pointer-coarse:size-9"
            onClick={() => setFilesOpen(true)}
            size="icon"
            variant="ghost"
          >
            <ListIcon className="size-4" />
          </Button>
        )}
        {depth() > 0 && (
          <Button
            aria-label="Back to the previous doc"
            className="text-muted-foreground hover:text-foreground size-7 shrink-0 pointer-coarse:size-9"
            onClick={() => history.back()}
            size="icon"
            variant="ghost"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
        )}
        <Path path={path} />
      </Header>
      <div className="flex min-h-0 flex-1">
        {drawer ? (
          <FilesDrawer onClose={closeFiles} open={filesOpen}>
            {files}
          </FilesDrawer>
        ) : (
          files
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-border/60 text-muted-foreground flex h-9 shrink-0 items-center gap-3 border-b px-4 font-mono text-[11.5px] max-md:px-2 max-md:pl-4 pointer-coarse:h-11">
            {(data?.status === "ok" || data?.status === "pdf") && (
              <span className="min-w-0 truncate">
                {formatBytes(data.size)} ·{" "}
                <span className="max-md:hidden">changed </span>
                {formatAgo(data.modified, now, { ago: true })}
              </span>
            )}
            {data?.status === "ok" && (kept || expires !== undefined) && (
              <span className="-ml-2 shrink-0 max-md:hidden">
                {kept
                  ? "· kept"
                  : `· deleted in ${Math.max(0, Math.ceil((expires! - now) / DAY))}d`}
              </span>
            )}
            {(keeping.error ?? saving.error) && (
              <span
                className="text-error truncate"
                title={keeping.error ?? saving.error}
              >
                {keeping.error ?? saving.error}
              </span>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {edit ? (
                <>
                  <Button
                    className={coarse}
                    disabled={saving.busy}
                    onClick={stopEditing}
                    size="xs"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <Button
                    className={coarse}
                    disabled={saving.busy}
                    onClick={() => void save()}
                    size="xs"
                  >
                    <CheckIcon />
                    {saving.busy ? "Saving…" : "Save"}
                  </Button>
                </>
              ) : (
                data?.status === "ok" && (
                  <>
                    {!kept && (
                      <Button
                        className={coarse}
                        onClick={() => startEditing()}
                        size="xs"
                        variant="ghost"
                      >
                        <PencilIcon />
                        <span className="max-md:sr-only">Edit</span>
                      </Button>
                    )}
                    {report && !kept && (
                      <Versions onPick={startEditing} path={data.path} />
                    )}
                    {!report && data.dirty && (
                      <Button
                        aria-label="Commit"
                        className={iconCoarse}
                        disabled={saving.busy}
                        onClick={() => void commit(data.path)}
                        size="icon-xs"
                        title="Commit this file alone on the checked-out branch"
                        variant="ghost"
                      >
                        <GitCommitHorizontalIcon />
                      </Button>
                    )}
                  </>
                )
              )}
              {(report?.status === "ok" || report?.status === "pdf") &&
                !kept && (
                  <Button
                    aria-label="Keep"
                    className={iconCoarse}
                    disabled={keeping.busy}
                    onClick={() => void keep(report.path)}
                    size="icon-xs"
                    title="Keep: move to archive/, the daily sweep never deletes it"
                    variant="ghost"
                  >
                    <ArchiveIcon />
                  </Button>
                )}
              <Button
                aria-label="Comment on doc"
                className={iconCoarse}
                disabled={data?.status !== "ok"}
                onClick={() => setDraft({})}
                size="icon-xs"
                title="Comment on the whole doc"
                variant="ghost"
              >
                <MessageSquarePlusIcon />
              </Button>
              <Button
                aria-label="Download"
                className={iconCoarse}
                disabled={
                  saving.busy ||
                  (data?.status !== "ok" && data?.status !== "pdf")
                }
                onClick={() => exportDoc("download")}
                size="icon-xs"
                title={
                  touchKeyboard()
                    ? "Save or share the file"
                    : "Download the file"
                }
                variant="ghost"
              >
                <DownloadIcon />
              </Button>
              {data?.status === "ok" && !edit && (
                <Button
                  aria-label="Download as PDF"
                  className={iconCoarse}
                  disabled={saving.busy}
                  onClick={() => exportDoc("pdf")}
                  size="icon-xs"
                  title="Download as PDF; nothing is saved in the repo"
                  variant="ghost"
                >
                  <FileDownIcon />
                </Button>
              )}
              {!touchKeyboard() && canShareFiles() && (
                <Button
                  aria-label="Share"
                  className={iconCoarse}
                  disabled={
                    saving.busy ||
                    (data?.status !== "ok" && data?.status !== "pdf")
                  }
                  onClick={() => exportDoc("share")}
                  size="icon-xs"
                  title="Share the file, to AirDrop, Messages or another app"
                  variant="ghost"
                >
                  <Share2Icon />
                </Button>
              )}
              <Button
                aria-label="Reload"
                className="pointer-coarse:size-11"
                onClick={() =>
                  void Promise.all([
                    list.refetch(),
                    reports.refetch(),
                    doc.refetch(),
                  ])
                }
                size="icon-xs"
                variant="ghost"
              >
                <RefreshCwIcon
                  className={cn(
                    (list.loading || doc.loading) && "animate-spin",
                  )}
                />
              </Button>
            </div>
          </div>
          <main
            className="min-h-0 flex-1 overflow-y-auto px-6 py-5 max-md:px-4 max-md:py-4 [&_img]:h-auto [&_img]:max-w-full"
            ref={main}
          >
            <div
              className={cn(
                "mx-auto",
                data?.status === "pdf" ? "max-w-5xl" : "max-w-3xl",
              )}
            >
              {(list.error || doc.error) && (
                <p className="text-error font-mono text-[12px]">
                  {(list.error ?? doc.error)?.message}
                </p>
              )}
              {path === null && list.data && !list.error && (
                <p className="text-muted-foreground font-mono text-[12px]">
                  No Markdown docs tracked by git in this project.
                </p>
              )}
              {!data && !doc.error && path !== null && (
                <p className="text-muted-foreground font-mono text-[12px]">
                  loading…
                </p>
              )}
              {data?.status === "missing" && (
                <p className="text-muted-foreground font-mono text-[12px]">
                  Not found: {data.path}
                  {isReport(data.path) &&
                    ". Reports not kept are deleted after 30 days."}
                </p>
              )}
              {data?.status === "tooLarge" && (
                <p className="text-muted-foreground font-mono text-[12px]">
                  {data.path} is {formatBytes(data.size ?? 0)}, over the 1 MB
                  the viewer shows.
                </p>
              )}
              {data?.status === "ok" && edit && (
                <Editor
                  key={edit.note ?? ""}
                  onSave={() => void save()}
                  onText={(draft) =>
                    setEditing((previous) =>
                      previous ? { ...previous, draft } : previous,
                    )
                  }
                  text={edit.draft}
                />
              )}
              {data?.status === "pdf" && (
                <PdfView path={data.path} phone={drawer} />
              )}
              {data?.status === "ok" && !edit && (
                <Body doc={data} known={known} onComment={setDraft} />
              )}
            </div>
          </main>
          {path && (
            <Comments
              draft={draft}
              path={path}
              pending={pending}
              setDraft={setDraft}
              setPending={setPending}
            />
          )}
        </div>
        {viewport === "desktop" && (
          <Dock>
            <Conversation variant="dock" />
          </Dock>
        )}
      </div>
      <StatusLine />
    </>
  );
}

function CommentsCard({ entry }: { entry: EntryRecord }) {
  const { path, comments, note } = entry.data as DocComments;
  const title = (
    <>
      Docs · {comments.length} {comments.length === 1 ? "comment" : "comments"}{" "}
      on{" "}
      <button
        className="text-foreground/85 cursor-pointer hover:underline"
        onClick={() => openDoc(path)}
        title={`Open ${path} in Docs`}
        type="button"
      >
        {path}
      </button>
    </>
  );
  return (
    <div className="mt-3 flex justify-end first:mt-0">
      <Fold card={entry.id} keep summary={<>{title}</>}>
        <section className="border-border/70 border-l-brand/50 bg-secondary/40 w-full max-w-2xl min-w-0 overflow-hidden rounded-lg border border-l-2">
          <header className="border-border/60 text-muted-foreground flex items-center gap-2 border-b px-3 py-2 font-mono text-[11px]">
            <FileTextIcon className="text-brand size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{title}</span>
          </header>
          {note && (
            <p className="border-border/60 border-b px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap">
              {note}
            </p>
          )}
          <ol className="divide-border/60 divide-y">
            {comments.map((comment, index) => (
              <li className="space-y-1.5 px-3 py-2.5" key={index}>
                <Where comment={comment} />
                <p className="text-[13.5px] leading-relaxed break-words whitespace-pre-wrap">
                  {comment.text}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </Fold>
    </div>
  );
}

export default defineWebExtension({
  surfaces: [
    {
      id: "docs",
      title: "Docs",
      icon: FileTextIcon,
      description:
        "The repo's Markdown and your reports: read, edit, comment and send to an agent",
      order: 50,
      component: Docs,
    },
  ],
  commands: [
    {
      id: "docs.open",
      title: "Open Docs",
      run: (context) => context.showSurface("docs"),
    },
  ],
  slots: { overlay: [DocLink] },
  link: Link,
  entries: { "docs.comments": CommentsCard },
});
