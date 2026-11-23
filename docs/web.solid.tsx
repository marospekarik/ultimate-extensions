/** @jsxImportSource @solidjs/web */
import type { ConversationId } from "@earendil-works/pi-durable";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileDownIcon,
  FileTextIcon,
  GitCommitHorizontalIcon,
  HistoryIcon,
  ListIcon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  PlusIcon,
  GitPullRequestArrowIcon,
  RefreshCwIcon,
  SendIcon,
  Share2Icon,
  Trash2Icon,
  XIcon,
} from "@lucide/solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onSettled,
  Show,
  Switch,
} from "solid-js";
import type { JSX } from "@solidjs/web";
import { Markdown } from "@/components/markdown/markdown.solid.tsx";
import { Button } from "@/components/ui/button.solid.tsx";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.solid.tsx";
import { Form } from "@/components/ui/form.solid.tsx";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control.solid.tsx";
import { Input, Textarea } from "@/components/ui/input.solid.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.solid.tsx";
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
  renderEntry,
  ROOT,
  showSurface,
  StatusLine,
  switchConversation,
  touchKeyboard,
  useAction,
  useConversations,
  useDocOf,
  useExtensionUiState,
  useExternal,
  useNow,
  useSurface,
  useViewport,
  writingAs,
} from "@/sdk/solid";
import type { SolidEntryProps } from "@/sdk/solid";
import { Editor } from "./editor.solid.tsx";
import { Link } from "./link.solid.tsx";
import {
  depth,
  docUrl,
  nav,
  notify,
  openDoc,
  parseTarget,
  subscribe,
} from "./nav.ts";
import type { Nav } from "./nav.ts";
import { prefixOf } from "./blocks.ts";
import {
  docPath,
  findHeading,
  headingIds,
  imagePath,
  linkify,
} from "./links.ts";
import {
  ARCHIVE,
  DAY,
  imageType,
  isReport,
  limits,
  shownPath,
} from "./limits.ts";
import {
  AbortAction,
  BeginAction,
  ChunkAction,
  CommitAction,
  DocCommentsEntry,
  FileAction,
  FinishAction,
  HistoryAction,
  KeepAction,
  ListAction,
  PdfAction,
  PromoteAction,
  PromotedAction,
  PromotePlanAction,
  ReadAction,
  RemoveAction,
  ReportsAction,
  SendAction,
  VersionAction,
  WriteAction,
} from "./refs.ts";
import type { Doc, DocComment, DocComments, Report } from "./refs.ts";

const StandingDoc = docRef<Record<string, number>>("ultimate.standing-agents");

const useSelected = () => useExtensionUiState<string | null>("selected", null);

function DocLink() {
  const wanted = useExternal(() => nav.requested, subscribe);
  const [selected, setSelected] = useSelected();
  const surface = useSurface();
  createEffect(
    () => ({ wanted: wanted(), selected: selected() }),
    ({ wanted: target, selected: current }) => {
      if (target === undefined) return;
      writingAs("app", () => {
        nav.requested = undefined;
        nav.anchor = { hash: target.hash };
        if (target.push && target.path !== current)
          history.pushState(
            { depth: depth() + 1 } satisfies Nav,
            "",
            docUrl(target.path, target.hash),
          );
        setSelected(target.path);
        showSurface("docs");
      });
      notify();
    },
  );
  onSettled(() => {
    const back = () => {
      const target = parseTarget(new URL(location.href));
      if (!target) return;
      nav.anchor = { hash: target.hash };
      writingAs("app", () => setSelected(target.path));
      notify();
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  });
  createEffect(
    () => ({ surface: surface(), selected: selected() }),
    ({ surface: shownSurface, selected: current }) => {
      if (nav.requested !== undefined) return;
      const url = new URL(location.href);
      const shown = shownSurface === "docs" ? current : null;
      if (url.searchParams.get("doc") === shown) return;
      if (shown === null) url.searchParams.delete("doc");
      else url.searchParams.set("doc", shown);
      history.replaceState(history.state, "", url);
    },
  );
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

const IMAGE = "streamdown:docimg/";

const imageLinks = (body: string, from: string) =>
  body.replace(
    /!\[([^\]\n]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g,
    (match, alt: string, target: string, title: string) => {
      const path = imagePath(target, from);
      return path ? `![${alt}](${IMAGE}${encodeURI(path)}${title})` : match;
    },
  );

function loadImages(root: HTMLElement, urls: string[]) {
  for (const image of root.querySelectorAll<HTMLImageElement>(
    `img[src^="${IMAGE}"]`,
  )) {
    const path = decodeURI(image.getAttribute("src")!.slice(IMAGE.length));
    image.removeAttribute("src");
    image.alt ||= path;
    api.action(FileAction, { path }).then(
      ({ data }) => {
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
        const url = URL.createObjectURL(
          new Blob([bytes], { type: imageType(path) }),
        );
        urls.push(url);
        image.src = url;
      },
      () => {
        image.replaceWith(
          Object.assign(document.createElement("span"), {
            className: "text-muted-foreground font-mono text-[12px]",
            textContent: `[image not found: ${path}]`,
          }),
        );
      },
    );
  }
}

function groupOf(path: string) {
  const parts = path.split("/");
  if (parts.length === 1) return "";
  if (parts.length >= 3) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

const coarse =
  "pointer-coarse:h-11 pointer-coarse:px-3 pointer-coarse:text-[13px]";
const iconCoarse = "pointer-coarse:size-11";

function FileButton(props: {
  path: string;
  label: string;
  note?: string;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  return (
    <Button
      aria-label={props.path}
      class={cn(
        "hover:bg-accent/60 h-auto w-full items-baseline justify-start gap-2 rounded-none px-3 py-1 text-left text-[12.5px] font-normal whitespace-normal pointer-coarse:py-3 pointer-coarse:text-[14px]",
        props.selected && "bg-accent text-foreground",
      )}
      onClick={() => props.onSelect(props.path)}
      size={null}
      title={props.path}
      variant={null}
    >
      <span class="min-w-0 flex-1 truncate">{props.label}</span>
      <Show when={props.note}>
        <span class="text-muted-foreground/70 shrink-0 font-mono text-[10.5px]">
          {props.note}
        </span>
      </Show>
    </Button>
  );
}

const groupHeading =
  "text-muted-foreground/80 px-3 pt-3 pb-1 font-mono text-[10.5px] tracking-wider uppercase";

function Reports(props: {
  folder?: string;
  reports: Report[];
  filtering: boolean;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const now = useNow(60 * 60_000);
  const fresh = createMemo(() =>
    props.reports.filter((report) => !report.archived),
  );
  const kept = createMemo(() =>
    props.reports.filter((report) => report.archived),
  );
  const row = (report: () => Report) => (
    <FileButton
      label={report().path.slice(report().path.lastIndexOf("/") + 1)}
      note={
        report().expires === undefined
          ? undefined
          : `${Math.max(0, Math.ceil((report().expires! - now()) / DAY))}d left`
      }
      onSelect={props.onSelect}
      path={report().path}
      selected={report().path === props.selected}
    />
  );
  return (
    <>
      <Show
        when={
          fresh().length > 0 ||
          (props.reports.length === 0 && !props.filtering && props.folder)
        }
      >
        <section title={props.folder}>
          <h3 class={groupHeading}>Reports</h3>
          <For each={fresh()} keyed={(report) => report.path}>
            {row}
          </For>
          <Show when={props.reports.length === 0}>
            <p class="text-muted-foreground/60 truncate px-3 py-1 font-mono text-[11px]">
              none yet · {props.folder}
            </p>
          </Show>
        </section>
      </Show>
      <Show when={kept().length > 0}>
        <section title={props.folder && `${props.folder}archive/`}>
          <h3 class={groupHeading}>Reports · kept</h3>
          <For each={kept()} keyed={(report) => report.path}>
            {row}
          </For>
        </section>
      </Show>
    </>
  );
}

type Upload = {
  key: number;
  file: File;
  dir: string;
  progress: number;
  status: "queued" | "sending" | "asking" | "done" | "failed";
  path?: string;
  message?: string;
  onConflict?: "replace" | "keep";
};

function toBase64(bytes: ArrayBuffer) {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let at = 0; at < view.length; at += 0x8000)
    binary += String.fromCharCode(...view.subarray(at, at + 0x8000));
  return btoa(binary);
}

const failure = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^docs\/\w+: /,
    "",
  );

function useUploads(onDone: (path: string) => void) {
  const [items, setItems] = createSignal<Upload[]>([]);
  let live: Upload[] = [];
  let running = false;
  let next = 1;
  const set = (updated: Upload[]) => {
    live = updated;
    setItems(updated);
  };
  const patch = (key: number, change: Partial<Upload>) =>
    set(live.map((item) => (item.key === key ? { ...item, ...change } : item)));
  const send = async (item: Upload) => {
    patch(item.key, { status: "sending", progress: 0, message: undefined });
    let id: string | undefined;
    try {
      const begun = await api.action(BeginAction, {
        dir: item.dir,
        name: item.file.name,
        size: item.file.size,
        onConflict: item.onConflict,
      });
      if (begun.status === "conflict")
        return patch(item.key, { status: "asking", path: begun.path });
      id = begun.id;
      for (
        let at = 0, index = 0;
        at < item.file.size;
        index++, at += begun.chunkBytes
      ) {
        const slice = await item.file
          .slice(at, at + begun.chunkBytes)
          .arrayBuffer();
        await api.action(ChunkAction, { id, index, data: toBase64(slice) });
        patch(item.key, {
          progress: Math.min(1, (at + slice.byteLength) / item.file.size),
        });
      }
      const done = await api.action(FinishAction, { id });
      patch(item.key, {
        status: "done",
        progress: 1,
        path: done.path,
        message: `committed ${done.commit}`,
      });
      onDone(done.path);
    } catch (error) {
      if (id)
        await api
          .action(AbortAction, { id })
          .catch((abort: unknown) => console.warn("docs: abort", abort));
      patch(item.key, { status: "failed", message: failure(error) });
    }
  };
  const pump = async () => {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const item = live.find((entry) => entry.status === "queued");
        if (!item) break;
        await send(item);
      }
    } finally {
      running = false;
    }
  };
  return {
    items,
    add(files: File[], dir: string) {
      set([
        ...live,
        ...files.map((file): Upload => ({
          key: next++,
          file,
          dir,
          progress: 0,
          status: "queued",
        })),
      ]);
      void pump();
    },
    answer(key: number, onConflict: "replace" | "keep") {
      patch(key, { onConflict, status: "queued" });
      void pump();
    },
    dismiss(key: number) {
      set(live.filter((item) => item.key !== key));
    },
  };
}

type Uploads = ReturnType<typeof useUploads>;

function UploadRow(props: { item: Upload; uploads: Uploads }) {
  return (
    <li class="border-border/50 border-b px-3 py-1.5 text-[12px]">
      <div class="flex min-w-0 items-center gap-2">
        <span class="min-w-0 flex-1 truncate" title={props.item.file.name}>
          {props.item.file.name}
        </span>
        <span class="text-muted-foreground/70 shrink-0 font-mono text-[10.5px]">
          {formatBytes(props.item.file.size)}
        </span>
        <Show
          when={
            props.item.status === "done" ||
            props.item.status === "failed" ||
            props.item.status === "asking"
          }
        >
          <Button
            aria-label={`Dismiss upload ${props.item.file.name}`}
            class="text-muted-foreground hover:text-foreground -m-1 shrink-0 p-1 pointer-coarse:p-2"
            onClick={() => props.uploads.dismiss(props.item.key)}
            size={null}
            variant={null}
          >
            <XIcon class="size-3.5" />
          </Button>
        </Show>
      </div>
      <Show
        when={props.item.status === "sending" || props.item.status === "queued"}
      >
        <div
          aria-label={`Adding ${props.item.file.name}`}
          aria-valuenow={Math.round(props.item.progress * 100)}
          class="bg-muted mt-1 h-1 overflow-hidden rounded-full"
          role="progressbar"
        >
          <div
            class="bg-brand h-full transition-[width]"
            style={{ width: `${props.item.progress * 100}%` }}
          />
        </div>
      </Show>
      <Show when={props.item.message}>
        <p
          class={cn(
            "mt-0.5 font-mono text-[10.5px] break-words",
            props.item.status === "failed"
              ? "text-error"
              : "text-muted-foreground",
          )}
        >
          {props.item.message}
        </p>
      </Show>
      <Show when={props.item.status === "asking"}>
        <div class="mt-1">
          <p class="text-muted-foreground font-mono text-[10.5px] break-all">
            {props.item.path} exists
          </p>
          <div class="mt-1 flex gap-1">
            <Button
              aria-label={`Replace ${props.item.file.name}`}
              class={coarse}
              onClick={() => props.uploads.answer(props.item.key, "replace")}
              size="xs"
              variant="outline"
            >
              Replace
            </Button>
            <Button
              aria-label={`Keep both ${props.item.file.name}`}
              class={coarse}
              onClick={() => props.uploads.answer(props.item.key, "keep")}
              size="xs"
              variant="outline"
            >
              Keep both
            </Button>
          </div>
        </div>
      </Show>
    </li>
  );
}

const folderOf = (path: string | null) =>
  path && !isReport(path) ? path.slice(0, path.lastIndexOf("/") + 1) : "";

function AddButton(props: { dir: string; uploads: Uploads }) {
  let input: HTMLInputElement | undefined;
  const where = () => (props.dir ? `${props.dir}` : "the repo root");
  return (
    <>
      <Button
        aria-label="Add files"
        class="text-muted-foreground hover:text-foreground size-7 shrink-0 pointer-coarse:size-11"
        onClick={() => input?.click()}
        size="icon"
        title={`Add PDF or Markdown files to ${where()}; each is committed`}
        variant="ghost"
      >
        <PlusIcon class="size-4" />
      </Button>
      <input
        accept=".pdf,.md,application/pdf,text/markdown"
        aria-label="Choose files to add"
        class="hidden"
        multiple
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length) props.uploads.add(files, props.dir);
        }}
        ref={input}
        type="file"
      />
    </>
  );
}

function Files(props: {
  paths: string[];
  folder?: string;
  reports: Report[];
  selected: string | null;
  onSelect: (path: string) => void;
  uploads: Uploads;
  class?: string;
}) {
  const [filter, setFilter] = useExtensionUiState("filter", "");
  const needle = createMemo(() => filter().trim().toLowerCase());
  const shownReports = createMemo(() =>
    props.reports.filter(
      (report) => !needle() || report.path.toLowerCase().includes(needle()),
    ),
  );
  const groups = createMemo(() => {
    const map = new Map<string, string[]>();
    for (const path of props.paths) {
      if (needle() && !path.toLowerCase().includes(needle())) continue;
      const group = groupOf(path);
      map.set(group, [...(map.get(group) ?? []), path]);
    }
    const rank = (group: string) => (group === "" ? 0 : 1);
    return [...map].toSorted(
      ([a], [b]) => rank(a) - rank(b) || a.localeCompare(b),
    );
  });
  return (
    <nav class={cn("bg-sidebar flex min-h-0 flex-col", props.class)}>
      <div class="m-2 flex items-center gap-1">
        <Input
          aria-label="Filter docs"
          class="border-border/70 focus-visible:border-brand/50 min-w-0 flex-1 focus-visible:ring-0 pointer-coarse:h-11"
          onValueChange={setFilter}
          placeholder={`Filter ${props.paths.length + props.reports.length} docs…`}
          value={filter()}
        />
        <AddButton
          dir={folderOf(props.selected).replace(/\/$/, "")}
          uploads={props.uploads}
        />
      </div>
      <Show when={props.uploads.items().length > 0}>
        <ul aria-label="Uploads" class="border-border/50 border-t">
          <For each={props.uploads.items()} keyed={(item) => item.key}>
            {(item) => <UploadRow item={item()} uploads={props.uploads} />}
          </For>
        </ul>
      </Show>
      <div class="min-h-0 flex-1 overflow-y-auto pb-2">
        <Reports
          filtering={Boolean(needle())}
          folder={props.folder}
          onSelect={props.onSelect}
          reports={shownReports()}
          selected={props.selected}
        />
        <For each={groups()} keyed={(entry) => entry[0]}>
          {(entry) => (
            <section>
              <h3 class={groupHeading}>{entry()[0] || "Repository"}</h3>
              <For each={entry()[1]}>
                {(path) => (
                  <FileButton
                    label={
                      entry()[0] ? path.slice(entry()[0].length + 1) : path
                    }
                    onSelect={props.onSelect}
                    path={path}
                    selected={path === props.selected}
                  />
                )}
              </For>
            </section>
          )}
        </For>
        <Show when={groups().length === 0 && shownReports().length === 0}>
          <p class="text-muted-foreground px-3 py-2 font-mono text-[12px]">
            No docs match.
          </p>
        </Show>
      </div>
    </nav>
  );
}

function FilesDrawer(props: {
  open: boolean;
  onClose: () => void;
  children: JSX.Element;
}) {
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return undefined;
      const close = (event: KeyboardEvent) =>
        event.key === "Escape" && props.onClose();
      addEventListener("keydown", close);
      return () => removeEventListener("keydown", close);
    },
  );
  return (
    <div
      class={cn("fixed inset-0 z-40", !props.open && "pointer-events-none")}
      inert={!props.open}
    >
      <Button
        aria-label="Close docs list"
        class={cn(
          "absolute inset-0 h-auto w-full rounded-none bg-black/50 transition-opacity duration-300 hover:bg-black/50",
          props.open ? "opacity-100" : "opacity-0",
        )}
        onClick={props.onClose}
        size={null}
        variant={null}
      />
      <aside
        aria-label="Docs"
        class={cn(
          "border-sidebar-border absolute inset-y-0 left-0 flex w-[85%] max-w-[26rem] flex-col border-r pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl shadow-black/40 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          !props.open && "-translate-x-full",
        )}
      >
        {props.children}
      </aside>
    </div>
  );
}

function Path(props: { path: string | null }) {
  return (
    <Show
      when={props.path}
      fallback={
        <span class="text-muted-foreground font-mono text-[12px]">Docs</span>
      }
    >
      {(path) => {
        const cut = () => path().lastIndexOf("/") + 1;
        const folder = () =>
          isReport(path()) ? path().slice(1, cut()) : path().slice(0, cut());
        return (
          <span class="flex min-w-0 font-mono text-[12px]" title={path()}>
            <span class="text-muted-foreground/70 min-w-0 truncate">
              {folder()}
            </span>
            <span class="text-muted-foreground shrink-0">
              {path().slice(cut())}
            </span>
          </span>
        );
      }}
    </Show>
  );
}

function value(item: unknown): string {
  if (item === null || item === undefined) return "";
  if (Array.isArray(item)) return item.map(value).join(", ");
  if (item instanceof Date) return item.toISOString().slice(0, 10);
  if (typeof item === "object") return JSON.stringify(item);
  return `${item as string | number | boolean}`;
}

function Frontmatter(props: { data: Record<string, unknown> }) {
  const entries = createMemo(() => Object.entries(props.data));
  return (
    <Show when={entries().length > 0}>
      <dl class="border-border/70 bg-muted/20 border-l-brand/50 mb-5 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-md border border-l-2 px-3 py-2 text-[12.5px]">
        <For each={entries()} keyed={(entry) => entry[0]}>
          {(entry) => (
            <div class="contents">
              <dt class="text-muted-foreground font-mono text-[11.5px]">
                {entry()[0]}
              </dt>
              <dd class="min-w-0 break-words">{value(entry()[1])}</dd>
            </div>
          )}
        </For>
      </dl>
    </Show>
  );
}

const headingSelector = "h1, h2, h3, h4, h5, h6";

function headingAbove(node: Node | null, root: HTMLElement) {
  const element = node instanceof Element ? node : node?.parentElement;
  if (!element) return undefined;
  const headings = [...root.querySelectorAll(headingSelector)];
  const above = headings.filter(
    (heading) =>
      heading === element ||
      heading.compareDocumentPosition(element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
  );
  return above.at(-1)?.textContent?.trim() || undefined;
}

type Draft = { quote?: string; heading?: string };

function Body(props: {
  doc: Extract<Doc, { status: "ok" }>;
  known: Set<string>;
  onComment: (draft: Draft) => void;
}) {
  let ref: HTMLDivElement | undefined;
  const target = useExternal(() => nav.anchor, subscribe);
  createEffect(
    () => ({ body: props.doc.body, anchor: target() }),
    ({ anchor }) => {
      const root = ref;
      if (!root) return undefined;
      const place = () => {
        const headings = [...root.querySelectorAll(headingSelector)];
        const ids = headingIds(headings.map((item) => item.textContent ?? ""));
        headings.forEach((item, index) => {
          if (item.id !== ids[index]) item.id = ids[index];
        });
        return ids;
      };
      const jump = () => {
        if (!anchor.hash) return;
        const ids = place();
        const found = findHeading(ids, anchor.hash);
        if (found < 0) return;
        root
          .querySelectorAll(headingSelector)
          [found].scrollIntoView({ block: "start" });
      };
      const urls: string[] = [];
      place();
      loadImages(root, urls);
      jump();
      const watch = new MutationObserver(() => {
        place();
        loadImages(root, urls);
      });
      watch.observe(root, { childList: true, subtree: true });
      const settle = setTimeout(jump, 150);
      return () => {
        clearTimeout(settle);
        watch.disconnect();
        for (const url of urls) URL.revokeObjectURL(url);
      };
    },
  );
  const [pick, setPick] = createSignal<(Draft & { top: number }) | null>(null);
  const touch = touchKeyboard();
  const select = () => {
    const root = ref;
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
  onSettled(() => {
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
      class="relative"
      data-docs-body={props.doc.path}
      onMouseUp={touch ? undefined : select}
      ref={ref}
    >
      <Frontmatter data={props.doc.frontmatter} />
      <div data-docs-markdown="">
        <Markdown
          class="text-[14px] leading-relaxed"
          text={linkify(
            imageLinks(
              absoluteLinks(props.doc.body, props.doc.path),
              props.doc.path,
            ),
            props.doc.path,
            props.known,
          )}
        />
      </div>
      <Show when={pick()}>
        {(current) => (
          <Button
            aria-label="Comment on selection"
            class={cn(
              "shadow-sm",
              touch
                ? "sticky bottom-4 z-10 mx-auto mt-4 flex h-11 rounded-full px-5 text-[14px] shadow-lg shadow-black/30"
                : "absolute -right-2",
            )}
            onClick={() => {
              props.onComment({
                quote: current().quote,
                heading: current().heading,
              });
              setPick(null);
              getSelection()?.removeAllRanges();
            }}
            onMouseUp={(event: MouseEvent) => event.stopPropagation()}
            size="xs"
            style={
              touch
                ? undefined
                : { top: `${Math.max(0, current().top - 28)}px` }
            }
          >
            <MessageSquarePlusIcon class={cn(touch && "size-4!")} />
            {touch ? "Comment on selection" : "Comment"}
          </Button>
        )}
      </Show>
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
    type: "text/plain",
  });

const canShareFiles = () =>
  navigator.canShare?.({
    files: [new File([], "doc.pdf", { type: "application/pdf" })],
  }) ?? false;

const sharable = (file: File) =>
  navigator.canShare?.({ files: [file] }) ?? false;

function exportError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError")
    return `The browser blocked sharing this file. Tap Share again, or use Download. (${error.name}: ${error.message})`;
  return error instanceof Error ? error.message : String(error);
}

async function saveFile(file: File, share: boolean) {
  const name = file.name;
  if (share && sharable(file)) {
    try {
      await navigator.share({ files: [file] });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        throw new Error(exportError(error));
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
    .querySelectorAll("button, svg, script, style, .code-block-header")
    .forEach((node) => node.remove());
  copy.querySelectorAll("a").forEach((link) => {
    link.setAttribute("href", link.href);
  });
  const { data } = await api.action(PdfAction, { path, html: copy.innerHTML });
  const name = (path.split("/").pop() ?? "doc").replace(/\.md$/i, "");
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new File([bytes], `${name}.pdf`, { type: "application/pdf" });
}

type Pending = { comments: DocComment[]; note: string };
const empty: Pending = { comments: [], note: "" };

function PdfView(props: {
  path: string;
  phone: boolean;
  onFile: (file: File | undefined) => void;
}) {
  const pdf = useAction(FileAction, {
    get path() {
      return props.path;
    },
  });
  const file = createMemo(() => {
    const data = pdf.data();
    return data ? pdfFile(props.path, data.data) : undefined;
  });
  const [error, setError] = createSignal<string>();
  createEffect(file, (current) => {
    props.onFile(current);
    return () => props.onFile(undefined);
  });
  const url = createMemo(() => {
    const current = file();
    return current && URL.createObjectURL(current);
  });
  createEffect(url, (current) =>
    current ? () => URL.revokeObjectURL(current) : undefined,
  );
  return (
    <Switch>
      <Match when={pdf.error()}>
        <p class="text-error font-mono text-[12px]">{pdf.error()?.message}</p>
      </Match>
      <Match when={!file() || !url()}>
        <p class="text-muted-foreground font-mono text-[12px]">loading…</p>
      </Match>
      <Match when={props.phone || touchKeyboard()}>
        <div class="border-border/70 bg-secondary/40 mx-auto flex max-w-sm flex-col items-center gap-3 rounded-lg border p-6 text-center">
          <FileTextIcon class="text-brand size-8" />
          <p class="max-w-full font-mono text-[12.5px] break-all">
            {file()?.name}
          </p>
          <p class="text-muted-foreground font-mono text-[11.5px]">
            {formatBytes(file()?.size ?? 0)} · PDF
          </p>
          <Button
            class="h-11 w-full text-[14px]"
            render={(link) => (
              <a {...link} href={url()} rel="noreferrer" target="_blank" />
            )}
          >
            <ExternalLinkIcon />
            Open
          </Button>
          <Button
            class="h-11 w-full text-[14px]"
            onClick={() => {
              setError(undefined);
              saveFile(file()!, touchKeyboard()).catch((failed: unknown) =>
                setError(exportError(failed)),
              );
            }}
            variant="outline"
          >
            <DownloadIcon />
            Download
          </Button>
          <Show when={error()}>
            <p class="text-error font-mono text-[12px]">{error()}</p>
          </Show>
        </div>
      </Match>
      <Match when={true}>
        <iframe
          class="border-border/70 h-[calc(100dvh-12.5rem)] w-full rounded-md border bg-white"
          src={url()}
          title={file()?.name}
        />
      </Match>
    </Switch>
  );
}

function Where(props: { comment: Draft }) {
  return (
    <div class="space-y-1">
      <p class="text-muted-foreground font-mono text-[11px]">
        {props.comment.heading ? `§ ${props.comment.heading}` : "On the doc"}
      </p>
      <Show when={props.comment.quote}>
        <blockquote class="border-border text-muted-foreground line-clamp-3 border-l-2 pl-2 text-[12.5px]">
          {props.comment.quote}
        </blockquote>
      </Show>
    </div>
  );
}

function Composer(props: {
  draft: Draft;
  onAdd: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = createSignal("");
  let area: HTMLTextAreaElement | undefined;
  let form: HTMLFormElement | undefined;
  onSettled(() => area?.focus());
  return (
    <Form
      class="border-border/70 bg-background rounded-md border p-2"
      ref={form}
    >
      <Where comment={props.draft} />
      <Textarea
        aria-label="Comment text"
        class="placeholder:text-muted-foreground/50 mt-1.5 block min-h-16 w-full resize-y rounded-none border-0 bg-transparent p-0 text-[13px] leading-relaxed outline-none focus-visible:ring-0"
        maxlength={limits.text}
        onFocus={() => {
          if (touchKeyboard())
            setTimeout(() => form?.scrollIntoView({ block: "nearest" }), 300);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onCancel();
        }}
        onValueChange={setText}
        placeholder="A question, a challenge, a change you want…"
        ref={area}
        submitShortcut="mod+enter"
        value={text()}
      />
      <div class="flex justify-end gap-1.5">
        <Button
          class={coarse}
          onClick={props.onCancel}
          size="xs"
          variant="ghost"
        >
          Cancel comment
        </Button>
        <Button
          class={coarse}
          disabled={!text().trim()}
          onClick={() => props.onAdd(text().trim())}
          size="xs"
          type="submit"
        >
          Add comment
        </Button>
      </div>
    </Form>
  );
}

function Recipient(props: { value: number; onChange: (id: number) => void }) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [highlight, setHighlight] = createSignal<string>();
  const standing = useDocOf(() => ROOT, StandingDoc);
  const agents = createMemo(
    () =>
      new Map(Object.entries(standing() ?? {}).map(([name, id]) => [id, name])),
  );
  const conversations = useConversations();
  const nameOf = (id: number) =>
    agents().has(id)
      ? `@${agents().get(id)}`
      : `#${id} ${conversations().find((item) => item.id === id)?.title ?? ""}`.trim();
  const needle = createMemo(() => query().trim().toLowerCase());
  const recent = createMemo(() =>
    conversations()
      .filter(
        (item) =>
          !item.parentConversationId && !agents().has(item.id) && item.title,
      )
      .toSorted((a, b) => (b.inputAt ?? b.id) - (a.inputAt ?? a.id))
      .filter(
        (item) =>
          !needle() ||
          `#${item.id} ${item.title}`.toLowerCase().includes(needle()),
      )
      .slice(0, 30),
  );
  const startAt = () => {
    const first = [...agents().keys()][0] ?? recent()[0]?.id;
    return first === undefined ? undefined : String(first);
  };
  const changeQuery = (next: string) => {
    setQuery(next);
    setHighlight(undefined);
  };
  return (
    <Popover onOpenChange={setOpen} open={open()}>
      <PopoverTrigger
        aria-label="Choose who the comments go to"
        class="border-border/70 text-muted-foreground hover:bg-accent/60 flex h-6 max-w-64 min-w-0 items-center gap-1.5 rounded-md border px-2 font-mono text-[11.5px] pointer-coarse:h-11"
        title="Who the comments go to"
      >
        <SendIcon class="size-3 shrink-0" />
        to{" "}
        <span class="text-foreground/90 min-w-0 truncate">
          {nameOf(props.value)}
        </span>
        <ChevronDownIcon class="size-3 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="end" class="w-[min(24rem,calc(100vw-1rem))] p-0">
        <Command
          autoHighlight={false}
          filter={false}
          onAction={(chosen) => {
            const id = Number(chosen);
            if (!Number.isInteger(id)) return;
            setOpen(false);
            changeQuery("");
            props.onChange(id);
          }}
          onQueryChange={changeQuery}
          onValueChange={setHighlight}
          query={query()}
          value={highlight() ?? startAt()}
        >
          <CommandInput
            aria-label="Search comment recipients"
            class="font-mono text-[12.5px]"
            placeholder="Send the comments to…"
          />
          <CommandList class="max-h-[60vh]">
            <CommandGroup heading="Agents">
              <For each={[...agents()]} keyed={(entry) => entry[0]}>
                {(entry) => (
                  <CommandItem
                    class="font-mono text-[12.5px]"
                    value={String(entry()[0])}
                  >
                    @{entry()[1]}
                  </CommandItem>
                )}
              </For>
            </CommandGroup>
            <Show when={recent().length > 0}>
              <CommandGroup heading="Conversations">
                <For each={recent()} keyed={(item) => item.id}>
                  {(item) => (
                    <CommandItem
                      aria-label={`Send comments to conversation #${item().id}`}
                      class="gap-2 text-[12.5px]"
                      value={String(item().id)}
                    >
                      <span class="text-muted-foreground font-mono">
                        #{item().id}
                      </span>
                      <span class="truncate">{item().title}</span>
                    </CommandItem>
                  )}
                </For>
              </CommandGroup>
            </Show>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

type Axis = "x" | "y";

function useResize(options: {
  key: string;
  axis: Axis;
  fallback: number;
  min: number;
  max: () => number;
  grow: 1 | -1;
}) {
  const [stored, setStored] = useExtensionUiState<number | null>(
    options.key,
    null,
  );
  const [dragging, setDragging] = createSignal<number>();
  const clamp = (size: number) =>
    Math.round(Math.min(Math.max(size, options.min), options.max()));
  const size = () => clamp(dragging() ?? stored() ?? options.fallback);
  const onPointerDown = (
    event: PointerEvent & { currentTarget: HTMLDivElement },
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const at = (next: PointerEvent) =>
      options.axis === "x" ? next.clientX : next.clientY;
    const start = at(event);
    const from = size();
    let live: number | undefined;
    handle.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => {
      live = clamp(from + (at(next) - start) * options.grow);
      setDragging(live);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (live !== undefined) setStored(live);
      setDragging(undefined);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  return {
    size,
    custom: () => stored() !== null || dragging() !== undefined,
    dragging: () => dragging() !== undefined,
    reset: () => setStored(null),
    onPointerDown,
  };
}

function ResizeHandle(props: {
  axis: Axis;
  label: string;
  resize: ReturnType<typeof useResize>;
  class?: string;
}) {
  return (
    <div
      aria-hidden="true"
      class={cn(
        "absolute z-10 after:absolute after:bg-brand/60 after:opacity-0 after:transition-opacity hover:after:opacity-100",
        props.axis === "x"
          ? "inset-y-0 w-2 cursor-col-resize after:inset-y-0 after:left-1/2 after:w-px"
          : "inset-x-0 h-2 cursor-row-resize after:inset-x-0 after:top-1/2 after:h-px",
        props.resize.dragging() && "after:opacity-100",
        props.class,
      )}
      onDblClick={props.resize.reset}
      onPointerDown={props.resize.onPointerDown}
      title={props.label}
    />
  );
}

function Comments(props: {
  path: string;
  pending: Pending;
  setPending: (next: Pending) => void;
  draft: Draft | null;
  setDraft: (draft: Draft | null) => void;
}) {
  const viewport = useViewport();
  const standing = useDocOf(() => ROOT, StandingDoc);
  const [to, setTo] = useExtensionUiState<number | null>("to", null);
  const recipient = () => to() ?? standing()?.ultimate ?? 1;
  const [sending, setSending] = createSignal(false);
  const [result, setResult] = createSignal<{ sent?: number; error?: string }>(
    {},
  );
  const count = () => props.pending.comments.length;
  const resize = useResize({
    key: "commentsHeight",
    axis: "y",
    fallback: 240,
    min: 96,
    max: () => Math.round(window.innerHeight * 0.6),
    grow: -1,
  });
  const send = async (source: string | undefined) => {
    setSending(true);
    setResult({});
    try {
      const conversation = recipient();
      const note = props.pending.note.trim();
      await api.action(SendAction, {
        conversation,
        path: props.path,
        comments: props.pending.comments,
        ...(note && { note }),
      });
      writingAs(source, () => props.setPending(empty));
      setResult({ sent: conversation });
    } catch (error) {
      setResult({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSending(false);
    }
  };
  return (
    <Show when={count() > 0 || props.draft || result().sent}>
      <div
        class={cn(
          "border-border/70 bg-sidebar relative shrink-0 border-t",
          !resize.custom() && "max-h-[50%]",
        )}
        style={resize.custom() ? { height: `${resize.size()}px` } : undefined}
      >
        <Show when={viewport() === "desktop"}>
          <ResizeHandle
            axis="y"
            class="-top-1"
            label="Resize comments"
            resize={resize}
          />
        </Show>
        <div class="h-full max-h-full space-y-2 overflow-y-auto px-4 py-2.5 max-md:px-3">
          <Show when={props.draft}>
            {(draft) => (
              <Composer
                draft={draft()}
                onAdd={(text) => {
                  props.setPending({
                    ...props.pending,
                    comments: [...props.pending.comments, { ...draft(), text }],
                  });
                  props.setDraft(null);
                  setResult({});
                }}
                onCancel={() => props.setDraft(null)}
              />
            )}
          </Show>
          <For each={props.pending.comments} keyed={false}>
            {(comment, index) => (
              <div class="border-border/60 group bg-background/60 relative rounded-md border px-2.5 py-2">
                <Where comment={comment()} />
                <p class="mt-1 text-[13px] whitespace-pre-wrap">
                  {comment().text}
                </p>
                <Button
                  aria-label={`Delete comment ${index + 1}`}
                  class="text-muted-foreground hover:text-foreground absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:top-0 pointer-coarse:right-0 pointer-coarse:size-11 pointer-coarse:opacity-100"
                  onClick={() =>
                    props.setPending({
                      ...props.pending,
                      comments: props.pending.comments.filter(
                        (_, at) => at !== index,
                      ),
                    })
                  }
                  size={null}
                  variant={null}
                >
                  <XIcon class="size-3.5" />
                </Button>
              </div>
            )}
          </For>
          <Show when={count() > 0}>
            <Textarea
              aria-label="Overall note"
              class="border-border/70 placeholder:text-muted-foreground/50 focus-visible:border-brand/50 block min-h-9 w-full resize-y rounded-md border px-2.5 py-1.5 focus-visible:ring-0"
              maxlength={limits.note}
              onValueChange={(note) =>
                props.setPending({ ...props.pending, note })
              }
              placeholder="An overall note (optional)"
              rows={1}
              value={props.pending.note}
            />
          </Show>
          <Show when={result().error}>
            <p class="text-error font-mono text-[11.5px]">
              Not sent: {result().error}
            </p>
          </Show>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-muted-foreground flex items-center gap-1.5 font-mono text-[11.5px]">
              <MessageSquareIcon class="text-brand size-3.5" />
              {count() > 0 ? `${count()} pending` : null}
              <Show when={count() === 0 && result().sent !== undefined}>
                <Button
                  class="hover:text-foreground h-auto font-mono text-[11.5px] font-normal underline-offset-2 hover:underline"
                  onClick={() => {
                    switchConversation(result().sent! as ConversationId);
                    showSurface("agent");
                  }}
                  size={null}
                  variant={null}
                >
                  Sent to #{result().sent}
                </Button>
              </Show>
            </span>
            <Show when={count() > 0}>
              <div class="ml-auto flex min-w-0 items-center gap-1.5">
                <Recipient onChange={setTo} value={recipient()} />
                <Button
                  class={coarse}
                  onClick={() => props.setPending(empty)}
                  size="xs"
                  variant="ghost"
                >
                  Discard
                </Button>
                <Button
                  class={coarse}
                  disabled={sending() || count() > limits.comments}
                  onClick={(_, details) => send(details.source)}
                  size="xs"
                >
                  {sending() ? "Sending…" : `Send (${count()})`}
                  <ArrowRightIcon />
                </Button>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}

function VersionList(props: {
  path: string;
  onPick: (text: string) => void;
  onClose: () => void;
}) {
  const versions = useAction(HistoryAction, {
    get path() {
      return props.path;
    },
  });
  const now = useNow(60_000);
  return (
    <>
      <Show when={(versions.data() ?? []).length === 0}>
        <p class="text-muted-foreground px-2 py-2 font-mono text-[11.5px]">
          No earlier versions yet. Each save keeps the one it replaces.
        </p>
      </Show>
      <For each={versions.data() ?? []} keyed={(item) => item.id}>
        {(item) => (
          <Button
            class="hover:bg-accent/60 h-auto w-full items-baseline justify-between gap-2 rounded px-2 py-1.5 text-left font-mono text-[12px] font-normal pointer-coarse:py-3"
            onClick={async () => {
              const { text } = await api.action(VersionAction, {
                path: props.path,
                id: item().id,
              });
              props.onClose();
              props.onPick(text);
            }}
            size={null}
            variant={null}
          >
            <span>{formatAgo(item().at, now(), { ago: true })}</span>
            <span class="text-muted-foreground/70">
              {formatBytes(item().size)}
            </span>
          </Button>
        )}
      </For>
    </>
  );
}

function Versions(props: { path: string; onPick: (text: string) => void }) {
  const [open, setOpen] = createSignal(false);
  return (
    <Popover onOpenChange={setOpen} open={open()}>
      <PopoverTrigger
        render={(trigger) => (
          <Button
            {...trigger}
            aria-label="Earlier versions"
            class={iconCoarse}
            size="icon-xs"
            title="Earlier versions of this report"
            variant="ghost"
          />
        )}
      >
        <HistoryIcon />
      </PopoverTrigger>
      <PopoverContent align="end" class="w-64 p-1">
        <VersionList
          onClose={() => setOpen(false)}
          onPick={props.onPick}
          path={props.path}
        />
      </PopoverContent>
    </Popover>
  );
}

function Delete(props: {
  path: string;
  onDeleted: (source: string | undefined) => Promise<unknown>;
}) {
  const [open, setOpen] = createSignal(false);
  const [state, setState] = createSignal<{ busy?: boolean; error?: string }>(
    {},
  );
  const remove = async (source: string | undefined) => {
    setState({ busy: true });
    try {
      await api.action(RemoveAction, { path: props.path });
      await props.onDeleted(source);
      setOpen(false);
      setState({});
    } catch (error) {
      setState({ error: failure(error) });
    }
  };
  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        setState({});
      }}
      open={open()}
    >
      <PopoverTrigger
        render={(trigger) => (
          <Button
            {...trigger}
            aria-label="Delete"
            class={iconCoarse}
            size="icon-xs"
            title={
              isReport(props.path)
                ? "Delete this report for good"
                : "Delete this file from the repo (one commit)"
            }
            variant="ghost"
          />
        )}
      >
        <Trash2Icon />
      </PopoverTrigger>
      <PopoverContent align="end" class="w-72 max-w-[calc(100vw-1rem)] p-3">
        <p class="text-[12.5px] leading-snug">
          Delete{" "}
          <span class="font-mono break-all">{props.path.split("/").pop()}</span>
          ?
        </p>
        <p class="text-muted-foreground mt-1 font-mono text-[11px] leading-snug">
          {isReport(props.path)
            ? "Reports are not in git: it and its saved versions are gone for good and can't be restored."
            : "git rm and one commit; git history keeps it."}
        </p>
        <Show when={state().error}>
          <p class="text-error mt-1 font-mono text-[11px] break-words">
            {state().error}
          </p>
        </Show>
        <div class="mt-2 flex justify-end gap-1">
          <Button
            class={coarse}
            onClick={() => setOpen(false)}
            size="xs"
            variant="ghost"
          >
            Cancel delete
          </Button>
          <Button
            aria-label={`Delete ${props.path.split("/").pop()} for good`}
            class={coarse}
            data-agent-confirm={`Delete ${props.path}`}
            disabled={state().busy}
            onClick={(_, details) => remove(details.source)}
            size="xs"
            variant="destructive"
          >
            <Trash2Icon />
            {state().busy ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Promote(props: {
  path: string;
  onDone: () => Promise<unknown>;
}) {
  const [open, setOpen] = createSignal(false);
  const [state, setState] = createSignal<{ busy?: boolean; error?: string }>(
    {},
  );
  const plan = useAction(PromotePlanAction, {
    get path() {
      return props.path;
    },
  });
  const [dir, setDir] = createSignal<string | null>(null);
  const [name, setName] = createSignal<string | null>(null);
  const [links, setLinks] = createSignal<"rewrite" | "keep">("rewrite");
  const shownDir = () => dir() ?? plan.data()?.dir ?? "";
  const shownName = () => name() ?? plan.data()?.name ?? "";
  const reportLinks = () => plan.data()?.reportLinks ?? [];
  const images = () => plan.data()?.images ?? [];
  const submit = async () => {
    setState({ busy: true });
    try {
      await api.action(PromoteAction, {
        path: props.path,
        dir: shownDir(),
        name: shownName(),
        links: links(),
      });
      await props.onDone();
      setOpen(false);
      setState({});
    } catch (error) {
      setState({ error: failure(error) });
    }
  };
  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        setState({});
        if (next) {
          setDir(null);
          setName(null);
          void plan.refetch();
        }
      }}
      open={open()}
    >
      <PopoverTrigger
        render={(trigger) => (
          <Button
            {...trigger}
            aria-label="Promote to repo"
            class={iconCoarse}
            size="icon-xs"
            title="Promote: copy this report into the repo"
            variant="ghost"
          />
        )}
      >
        <GitPullRequestArrowIcon />
      </PopoverTrigger>
      <PopoverContent align="end" class="w-80 max-w-[calc(100vw-1rem)] p-3">
        <Form class="flex flex-col gap-2">
          <p class="text-[12.5px] leading-snug">Promote to the repo</p>
          <Show
            when={plan.data()}
            fallback={
              <p class="text-muted-foreground font-mono text-[11px]">
                {plan.error() ? failure(plan.error()) : "Reading the repo…"}
              </p>
            }
          >
            {(data) => (
              <>
                <label class="flex flex-col gap-1">
                  <span class="text-muted-foreground font-mono text-[11px]">
                    Folder
                    {data().by === "classify" ? " · suggested by a model" : ""}
                  </span>
                  <Input
                    aria-label="Promote folder"
                    class="pointer-coarse:h-11"
                    list="docs-promote-folders"
                    onValueChange={setDir}
                    value={shownDir()}
                  />
                  <datalist id="docs-promote-folders">
                    <For each={data().dirs}>{(item) => <option value={item()} />}</For>
                  </datalist>
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-muted-foreground font-mono text-[11px]">
                    File name
                  </span>
                  <Input
                    aria-label="Promote file name"
                    class="pointer-coarse:h-11"
                    onValueChange={setName}
                    value={shownName()}
                  />
                </label>
                <Show when={reportLinks().length > 0}>
                  <div class="border-border/70 rounded-md border p-2">
                    <p class="text-[12px] leading-snug">
                      {reportLinks().length} link
                      {reportLinks().length === 1 ? "" : "s"} to{" "}
                      <span class="font-mono">/.reports/</span> break in the
                      repo.
                    </p>
                    <SegmentedControl
                      aria-label="Report links"
                      bind={[links, setLinks]}
                      class="mt-1.5"
                    >
                      <SegmentedControlItem value="rewrite">
                        Rewrite or strip
                      </SegmentedControlItem>
                      <SegmentedControlItem value="keep">
                        Leave as is
                      </SegmentedControlItem>
                    </SegmentedControl>
                    <p class="text-muted-foreground mt-1 font-mono text-[11px] leading-snug">
                      Rewrite points a link at its promoted copy, or leaves its
                      text without the link.
                    </p>
                  </div>
                </Show>
                <Show when={images().length > 0}>
                  <p class="text-muted-foreground font-mono text-[11px] leading-snug">
                    {images().length} image{images().length === 1 ? "" : "s"}{" "}
                    copied along.
                  </p>
                </Show>
                <p class="text-muted-foreground font-mono text-[11px] leading-snug">
                  {data().remote
                    ? `A branch, a commit, a push and a pull request into ${data().base}.`
                    : "No remote: one commit on the checked-out branch."}
                </p>
              </>
            )}
          </Show>
          <Show when={state().error}>
            <p class="text-error font-mono text-[11px] break-words">
              {state().error}
            </p>
          </Show>
          <div class="flex justify-end gap-1">
            <Button
              class={coarse}
              onClick={() => setOpen(false)}
              size="xs"
              variant="ghost"
            >
              Cancel promote
            </Button>
            <Button
              aria-label="Confirm promote"
              class={coarse}
              data-agent-confirm={`Copy ${props.path} into the repo`}
              disabled={
                state().busy || !plan.data() || !shownName().trim()
              }
              onClick={() => submit()}
              size="xs"
              type="submit"
            >
              <GitPullRequestArrowIcon />
              {state().busy
                ? "Promoting…"
                : plan.data()?.remote
                  ? "Open PR"
                  : "Commit"}
            </Button>
          </div>
        </Form>
      </PopoverContent>
    </Popover>
  );
}

type Editing = {
  path: string;
  draft: string;
  base: string;
  prefix: string;
  note?: string;
};

type Status = { busy?: boolean; error?: string };

function Docs() {
  const list = useAction(ListAction);
  const reports = useAction(ReportsAction);
  const [selected, setSelected] = useSelected();
  const uploads = useUploads((added) => {
    void list.refetch().then(() => setSelected(added));
  });
  const paths = createMemo(() => list.data() ?? []);
  const known = createMemo(() => new Set(paths()));
  const reportList = createMemo(() => reports.data()?.reports ?? []);
  const path = createMemo(() => shownPath(selected(), paths()));
  const doc = useAction(ReadAction, {
    get path() {
      return path() ?? "";
    },
  });
  const data = () => (path() === null ? undefined : doc.data());
  const ok = createMemo(() => {
    const current = data();
    return current?.status === "ok" ? current : undefined;
  });
  const exportable = createMemo(() => {
    const current = data();
    return current?.status === "ok" || current?.status === "pdf"
      ? current
      : undefined;
  });
  const [all, setAll] = useExtensionUiState<Record<string, Pending>>(
    "comments",
    {},
  );
  const pending = () => (path() && all()[path()!]) || empty;
  const setPending = (next: Pending) => {
    const current = path();
    if (!current) return;
    setAll((previous) => {
      const rest = { ...previous };
      delete rest[current];
      return next.comments.length || next.note
        ? { ...rest, [current]: next }
        : rest;
    });
  };
  const [opened, setOpened] = createSignal<{
    path: string | null;
    draft: Draft;
  } | null>(null);
  const draft = () => (opened()?.path === path() ? opened()!.draft : null);
  const setDraft = (next: Draft | null) =>
    setOpened(next ? { path: path(), draft: next } : null);
  const now = useNow(60_000);
  const [keeping, setKeeping] = createSignal<Status>({});
  const keep = async (from: string, source: string | undefined) => {
    setKeeping({ busy: true });
    try {
      const { path: to } = await api.action(KeepAction, { path: from });
      writingAs(source, () => {
        setAll((previous) => {
          if (!previous[from]) return previous;
          const { [from]: moved, ...rest } = previous;
          return { ...rest, [to]: moved };
        });
        setSelected(to);
      });
      await reports.refetch();
      setKeeping({});
    } catch (error) {
      setKeeping({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const [editing, setEditing] = createSignal<Editing | null>(null);
  const [saving, setSaving] = createSignal<Status>({});
  const edit = () => (editing()?.path === path() ? editing() : null);
  const startEditing = (text?: string) => {
    const current = ok();
    if (!path() || !current) return;
    const prefix = prefixOf(current.text, current.body);
    if (text !== undefined && !text.startsWith(prefix)) {
      setSaving({
        error:
          "That version has different frontmatter and can't be restored here.",
      });
      return;
    }
    const start = text === undefined ? current.body : text.slice(prefix.length);
    if (prefix + current.body !== current.text) {
      setSaving({ error: "This doc's frontmatter can't be edited here." });
      return;
    }
    setSaving({});
    setEditing({
      path: current.path,
      draft: start,
      base: current.hash,
      prefix,
      note: text === undefined ? undefined : "restored",
    });
  };
  const stopEditing = () => {
    setEditing(null);
    setSaving({});
  };
  const save = async () => {
    const current = ok();
    const target = edit();
    if (!target || !current) return;
    setSaving({ busy: true });
    try {
      await api.action(WriteAction, {
        path: current.path,
        text: target.prefix + target.draft,
        base: target.base,
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
  let main: HTMLElement | undefined;
  createEffect(path, () => {
    if (!nav.anchor.hash) main?.scrollTo({ top: 0 });
  });
  const [viewed, setViewed] = createSignal<File>();
  const [ready, setReady] = createSignal<File>();
  createEffect(path, () => {
    setReady(undefined);
  });
  const deliver = (file: File, share: boolean) => {
    setReady(undefined);
    setSaving({ busy: true });
    saveFile(file, share).then(
      () => setSaving({}),
      (error: unknown) => setSaving({ error: exportError(error) }),
    );
  };
  const exportDoc = (how: "download" | "pdf" | "share") => {
    const current = exportable();
    if (!current) return;
    const share = how === "share" || touchKeyboard();
    const viewedFile = viewed();
    const prepared =
      how === "pdf"
        ? undefined
        : current.status === "ok"
          ? mdFile(current.path, current.text)
          : viewedFile &&
            new File([viewedFile], viewedFile.name, {
              type: "application/pdf",
            });
    if (prepared) return deliver(prepared, share);
    setSaving({ busy: true });
    const file =
      how === "pdf"
        ? renderPdf(current.path)
        : api
            .action(FileAction, { path: current.path })
            .then(({ data: bytes }) => pdfFile(current.path, bytes));
    file.then(
      (made) => {
        if (!share || !sharable(made)) return deliver(made, false);
        setSaving({});
        setReady(made);
      },
      (error: unknown) => setSaving({ error: exportError(error) }),
    );
  };
  const viewport = useViewport();
  const drawer = () => viewport() === "phone";
  const [filesOpen, setFilesOpen] = createSignal(false);
  const trail = useExternal(depth, subscribe);
  const filesResize = useResize({
    key: "filesWidth",
    axis: "x",
    fallback: 288,
    min: 200,
    max: () => Math.round(window.innerWidth * 0.4),
    grow: 1,
  });
  const files = (inDrawer: boolean) => {
    const list = (
      <Files
        class={inDrawer ? "flex-1" : "h-full"}
        folder={reports.data()?.folder}
        onSelect={(next) => {
          setSelected(next);
          setFilesOpen(false);
        }}
        paths={paths()}
        reports={reportList()}
        selected={path()}
        uploads={uploads}
      />
    );
    if (inDrawer) return list;
    return (
      <div
        class="border-border/70 relative shrink-0 border-r"
        style={{ width: `${filesResize.size()}px` }}
      >
        {list}
        <ResizeHandle
          axis="x"
          class="-right-1"
          label="Resize docs list"
          resize={filesResize}
        />
      </div>
    );
  };
  const report = () => {
    const current = path();
    return current !== null && isReport(current) ? data() : undefined;
  };
  const reportDoc = createMemo(() => {
    const current = report();
    return current?.status === "ok" || current?.status === "pdf"
      ? current
      : undefined;
  });
  const kept = () => !!reportDoc()?.path.startsWith(ARCHIVE);
  const promoted = useAction(PromotedAction, {
    get path() {
      return report() ? (path() ?? "") : "";
    },
  });
  const expires = () =>
    reportList().find((item) => item.path === path())?.expires;
  const statusError = () => keeping().error ?? saving().error;
  const editKey = () => {
    const current = edit();
    return current ? `edit:${current.note ?? ""}` : undefined;
  };
  return (
    <>
      <Header>
        <Show when={drawer()}>
          <Button
            aria-expanded={filesOpen() ? "true" : "false"}
            aria-label="Show docs"
            class="text-muted-foreground hover:text-foreground size-7 shrink-0 pointer-coarse:size-9"
            onClick={() => setFilesOpen(true)}
            size="icon"
            variant="ghost"
          >
            <ListIcon class="size-4" />
          </Button>
        </Show>
        <Show when={trail() > 0}>
          <Button
            aria-label="Back to the previous doc"
            class="text-muted-foreground hover:text-foreground size-7 shrink-0 pointer-coarse:size-9"
            onClick={() => window.history.back()}
            size="icon"
            variant="ghost"
          >
            <ArrowLeftIcon class="size-4" />
          </Button>
        </Show>
        <Path path={path()} />
      </Header>
      <div class="flex min-h-0 flex-1">
        <Show when={drawer()} fallback={files(false)}>
          <FilesDrawer onClose={() => setFilesOpen(false)} open={filesOpen()}>
            {files(true)}
          </FilesDrawer>
        </Show>
        <div class="flex min-w-0 flex-1 flex-col">
          <div class="border-border/60 text-muted-foreground flex h-9 shrink-0 items-center gap-3 border-b px-4 font-mono text-[11.5px] max-md:px-2 max-md:pl-4 pointer-coarse:h-11">
            <Show when={exportable()}>
              {(current) => (
                <span class="min-w-0 truncate">
                  {formatBytes(current().size)} ·{" "}
                  <span class="max-md:hidden">changed </span>
                  {formatAgo(current().modified, now(), { ago: true })}
                </span>
              )}
            </Show>
            <Show when={ok() && (kept() || expires() !== undefined)}>
              <span class="-ml-2 shrink-0 max-md:hidden">
                {kept()
                  ? "· kept"
                  : `· deleted in ${Math.max(0, Math.ceil((expires()! - now()) / DAY))}d`}
              </span>
            </Show>
            <Show when={report() && promoted.data()}>
              {(done) => (
                <span class="shrink-0 truncate" title={done().path}>
                  · promoted{" "}
                  <Show
                    fallback={`as ${done().commit ?? ""}`}
                    when={done().url}
                  >
                    <a
                      class="underline"
                      href={done().url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      PR
                    </a>
                  </Show>
                </span>
              )}
            </Show>
            <Show when={statusError()}>
              <span class="text-error truncate" title={statusError()}>
                {statusError()}
              </span>
            </Show>
            <div class="ml-auto flex shrink-0 items-center gap-1">
              <Show when={ready()}>
                {(file) => (
                  <Button
                    class={coarse}
                    onClick={() => deliver(file(), true)}
                    size="xs"
                    title={`Share ${file().name}`}
                  >
                    <Share2Icon />
                    Ready, tap to share
                  </Button>
                )}
              </Show>
              <Show
                when={edit()}
                fallback={
                  <Show when={ok()}>
                    {(current) => (
                      <>
                        <Show when={!kept()}>
                          <Button
                            class={coarse}
                            onClick={() => startEditing()}
                            size="xs"
                            variant="ghost"
                          >
                            <PencilIcon />
                            <span class="max-md:sr-only">Edit</span>
                          </Button>
                        </Show>
                        <Show when={report() && !kept()}>
                          <Versions
                            onPick={startEditing}
                            path={current().path}
                          />
                        </Show>
                        <Show when={!report() && current().dirty}>
                          <Button
                            aria-label="Commit"
                            class={iconCoarse}
                            disabled={saving().busy}
                            onClick={() => void commit(current().path)}
                            size="icon-xs"
                            title="Commit this file alone on the checked-out branch"
                            variant="ghost"
                          >
                            <GitCommitHorizontalIcon />
                          </Button>
                        </Show>
                      </>
                    )}
                  </Show>
                }
              >
                <Button
                  aria-label="Cancel editing"
                  class={coarse}
                  disabled={saving().busy}
                  onClick={stopEditing}
                  size="xs"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button
                  aria-label="Save"
                  class={coarse}
                  disabled={saving().busy}
                  onClick={() => void save()}
                  size="xs"
                >
                  <CheckIcon />
                  {saving().busy ? "Saving…" : "Save"}
                </Button>
              </Show>
              <Show when={reportDoc() && !kept()}>
                <Button
                  aria-label="Keep"
                  class={iconCoarse}
                  disabled={keeping().busy}
                  onClick={(_, details) =>
                    keep(reportDoc()!.path, details.source)
                  }
                  size="icon-xs"
                  title="Keep: move to archive/, the daily sweep never deletes it"
                  variant="ghost"
                >
                  <ArchiveIcon />
                </Button>
              </Show>
              <Show when={report() && ok() && !edit()}>
                <Promote
                  onDone={async () => {
                    await promoted.refetch();
                  }}
                  path={path()!}
                />
              </Show>
              <Button
                aria-label="Comment on doc"
                class={iconCoarse}
                disabled={!ok()}
                onClick={() => setDraft({})}
                size="icon-xs"
                title="Comment on the whole doc"
                variant="ghost"
              >
                <MessageSquarePlusIcon />
              </Button>
              <Button
                aria-label="Download"
                class={iconCoarse}
                disabled={saving().busy || !exportable()}
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
              <Show when={ok() && !edit()}>
                <Button
                  aria-label="Download as PDF"
                  class={iconCoarse}
                  disabled={saving().busy}
                  onClick={() => exportDoc("pdf")}
                  size="icon-xs"
                  title="Download as PDF; nothing is saved in the repo"
                  variant="ghost"
                >
                  <FileDownIcon />
                </Button>
              </Show>
              <Show when={!touchKeyboard() && canShareFiles()}>
                <Button
                  aria-label="Share"
                  class={iconCoarse}
                  disabled={saving().busy || !exportable()}
                  onClick={() => exportDoc("share")}
                  size="icon-xs"
                  title="Share the file, to AirDrop, Messages or another app"
                  variant="ghost"
                >
                  <Share2Icon />
                </Button>
              </Show>
              <Show when={!edit() && exportable()}>
                {(current) => (
                  <Delete
                    onDeleted={async (source) => {
                      writingAs(source, () => {
                        setPending(empty);
                        setSelected(null);
                      });
                      await (report() ? reports.refetch() : list.refetch());
                    }}
                    path={current().path}
                  />
                )}
              </Show>
              <Button
                aria-label="Reload"
                class="pointer-coarse:size-11"
                onClick={() => {
                  void Promise.all([
                    list.refetch(),
                    reports.refetch(),
                    doc.refetch(),
                  ]);
                }}
                size="icon-xs"
                variant="ghost"
              >
                <RefreshCwIcon
                  class={cn(
                    (list.loading() || doc.loading()) && "animate-spin",
                  )}
                />
              </Button>
            </div>
          </div>
          <main
            class="min-h-0 flex-1 overflow-y-auto px-6 py-5 max-md:px-4 max-md:py-4 [&_img]:h-auto [&_img]:max-w-full"
            ref={main}
          >
            <div
              class={cn(
                "mx-auto",
                data()?.status === "pdf" ? "max-w-5xl" : "max-w-3xl",
              )}
            >
              <Show when={list.error() ?? doc.error()}>
                {(failed) => (
                  <p class="text-error font-mono text-[12px]">
                    {failed().message}
                  </p>
                )}
              </Show>
              <Show when={path() === null && list.data() && !list.error()}>
                <p class="text-muted-foreground font-mono text-[12px]">
                  No Markdown docs tracked by git in this project.
                </p>
              </Show>
              <Show when={!data() && !doc.error() && path() !== null}>
                <p class="text-muted-foreground font-mono text-[12px]">
                  loading…
                </p>
              </Show>
              <Show
                when={(() => {
                  const current = data();
                  return current?.status === "missing" ? current : undefined;
                })()}
              >
                {(missing) => (
                  <p class="text-muted-foreground font-mono text-[12px]">
                    Not found: {missing().path}
                    {isReport(missing().path) &&
                      ". Reports not kept are deleted after 30 days."}
                  </p>
                )}
              </Show>
              <Show
                when={(() => {
                  const current = data();
                  return current?.status === "tooLarge" ? current : undefined;
                })()}
              >
                {(large) => (
                  <p class="text-muted-foreground font-mono text-[12px]">
                    {large().path} is {formatBytes(large().size ?? 0)}, over the
                    1 MB the viewer shows.
                  </p>
                )}
              </Show>
              <For each={ok() && editKey() ? [editKey()!] : []}>
                {() => (
                  <Editor
                    onSave={() => void save()}
                    onText={(next) =>
                      setEditing((previous) =>
                        previous ? { ...previous, draft: next } : previous,
                      )
                    }
                    text={edit()?.draft ?? ""}
                  />
                )}
              </For>
              <Show
                when={(() => {
                  const current = data();
                  return current?.status === "pdf" ? current : undefined;
                })()}
              >
                {(pdf) => (
                  <PdfView
                    onFile={setViewed}
                    path={pdf().path}
                    phone={drawer()}
                  />
                )}
              </Show>
              <Show when={!edit() && ok()}>
                {(current) => (
                  <Body doc={current()} known={known()} onComment={setDraft} />
                )}
              </Show>
            </div>
          </main>
          <Show when={path()}>
            {(current) => (
              <Comments
                draft={draft()}
                path={current()}
                pending={pending()}
                setDraft={setDraft}
                setPending={setPending}
              />
            )}
          </Show>
        </div>
        <Show when={viewport() === "desktop"}>
          <Dock>
            <Conversation variant="dock" />
          </Dock>
        </Show>
      </div>
      <StatusLine />
    </>
  );
}

function CommentsCard(
  props: Omit<SolidEntryProps, "entry"> & {
    entry: { id: number; data: DocComments };
  },
) {
  const data = () => props.entry.data;
  const title = () => (
    <>
      Docs · {data().comments.length}{" "}
      {data().comments.length === 1 ? "comment" : "comments"} on{" "}
      <Button
        aria-label={`Open ${data().path} in Docs (message ${props.entry.id})`}
        class="text-foreground/85 h-auto font-mono text-[11px] font-normal hover:underline"
        onClick={() => openDoc(data().path)}
        size={null}
        title={`Open ${data().path} in Docs`}
        variant={null}
      >
        {data().path}
      </Button>
    </>
  );
  return (
    <div class="mt-3 flex justify-end first:mt-0">
      <Fold
        card={props.entry.id}
        keep
        label={`Show Docs comments on ${data().path} (message ${props.entry.id})`}
        summary={title()}
      >
        <section class="border-border/70 border-l-brand/50 bg-secondary/40 w-full max-w-2xl min-w-0 overflow-hidden rounded-lg border border-l-2">
          <header class="border-border/60 text-muted-foreground flex items-center gap-2 border-b px-3 py-2 font-mono text-[11px]">
            <FileTextIcon class="text-brand size-3.5 shrink-0" />
            <span class="min-w-0 truncate">{title()}</span>
          </header>
          <Show when={data().note}>
            <p class="border-border/60 border-b px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap">
              {data().note}
            </p>
          </Show>
          <ol class="divide-border/60 divide-y">
            <For each={data().comments} keyed={false}>
              {(comment) => (
                <li class="space-y-1.5 px-3 py-2.5">
                  <Where comment={comment()} />
                  <p class="text-[13.5px] leading-relaxed break-words whitespace-pre-wrap">
                    {comment().text}
                  </p>
                </li>
              )}
            </For>
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
  entries: { "docs.comments": renderEntry(DocCommentsEntry, CommentsCard) },
});
