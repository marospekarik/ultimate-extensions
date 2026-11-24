/** @jsxImportSource @solidjs/web */
import { ChevronRightIcon } from "@lucide/solid";
import { createEffect, createMemo, For, Show } from "solid-js";
import { Button } from "@/components/ui/button.solid.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.solid.tsx";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.solid.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog.solid.tsx";
import {
  cn,
  formatAgo,
  useDialog,
  useExtensionUiState,
  useNow,
  writingAs,
} from "@/sdk/solid";
import { DAY } from "./limits.ts";
import type { Report } from "./refs.ts";
import { ancestors, buildTree, docName, fileFallback } from "./tree.ts";
import type { TreeNode } from "./tree.ts";

export const jumpDialog = "docs.jump";

const REPORTS_SHOWN = 5;
const WARN_DAYS = 7;

const rowText =
  "text-[12.5px] pointer-coarse:py-3 pointer-coarse:text-[14px] font-normal";

const indent = (depth: number) => ({ "padding-left": `${depth * 14 + 10}px` });

export const groupHeading =
  "text-muted-foreground/80 flex items-baseline justify-between gap-2 px-3 pt-3 pb-1 font-mono text-[10.5px] tracking-wider uppercase";

const countClass =
  "text-muted-foreground/60 shrink-0 font-mono text-[10.5px] tracking-normal normal-case";

export const reportFallback = (path: string) =>
  fileFallback(path).replace(/^\d{4}-\d{2}-\d{2}-/, "");

export function FileButton(props: {
  path: string;
  label: string;
  detail?: string;
  note?: string;
  warn?: boolean;
  depth?: number;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  return (
    <Button
      aria-label={props.path}
      class={cn(
        "hover:bg-accent/60 h-auto w-full items-baseline justify-start gap-2 rounded-none py-1 pr-3 text-left whitespace-normal",
        rowText,
        props.selected && "bg-accent text-foreground",
      )}
      onClick={() => props.onSelect(props.path)}
      size={null}
      style={indent(props.depth ?? 0)}
      title={props.path}
      variant={null}
    >
      <span class="w-3 shrink-0" />
      <span class="min-w-0 flex-1 truncate">
        {props.label}
        <Show when={props.detail}>
          <span class="text-muted-foreground/60 ml-1.5 font-mono text-[10.5px]">
            {props.detail}
          </span>
        </Show>
      </span>
      <Show when={props.note}>
        <span
          class={cn(
            "shrink-0 font-mono text-[10.5px]",
            props.warn ? "text-warning" : "text-muted-foreground/70",
          )}
        >
          {props.note}
        </span>
      </Show>
    </Button>
  );
}

export function Reports(props: {
  folder?: string;
  reports: Report[];
  titles: Record<string, string>;
  filtering: boolean;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const now = useNow(60 * 60_000);
  const [all, setAll] = useExtensionUiState("reportsAll", false);
  const fresh = createMemo(() =>
    props.reports.filter((report) => !report.archived),
  );
  const kept = createMemo(() =>
    props.reports.filter((report) => report.archived),
  );
  const expanded = () => all() || props.filtering;
  const shown = createMemo(() =>
    expanded()
      ? fresh()
      : fresh().filter(
          (report, index) =>
            index < REPORTS_SHOWN || report.path === props.selected,
        ),
  );
  const hidden = () => fresh().length - shown().length;
  const daysLeft = (report: Report) =>
    report.expires === undefined
      ? undefined
      : Math.max(0, Math.ceil((report.expires - now()) / DAY));
  const row = (report: () => Report) => {
    const left = () => daysLeft(report());
    const warn = () => left() !== undefined && left()! < WARN_DAYS;
    return (
      <FileButton
        label={
          props.titles[report().path] ?? reportFallback(report().path)
        }
        note={
          warn()
            ? `${left()}d left`
            : formatAgo(report().modified, now())
        }
        onSelect={props.onSelect}
        path={report().path}
        selected={report().path === props.selected}
        warn={warn()}
      />
    );
  };
  return (
    <Show
      when={
        props.reports.length > 0 ||
        (!props.filtering && props.folder !== undefined)
      }
    >
      <section title={props.folder}>
        <h3 class={groupHeading}>
          Reports
          <Show when={props.reports.length > 0}>
            <span class={countClass}>{props.reports.length}</span>
          </Show>
        </h3>
        <For each={shown()} keyed={(report) => report.path}>
          {row}
        </For>
        <Show when={props.reports.length === 0}>
          <p class="text-muted-foreground/60 truncate px-3 py-1 font-mono text-[11px]">
            none yet · {props.folder}
          </p>
        </Show>
        <Show when={expanded() && kept().length > 0}>
          <h4 class="text-muted-foreground/60 px-3 pt-2 pb-0.5 font-mono text-[10px] tracking-wider uppercase">
            Kept
          </h4>
          <For each={kept()} keyed={(report) => report.path}>
            {row}
          </For>
        </Show>
        <Show
          when={
            !props.filtering &&
            (hidden() > 0 || kept().length > 0 || (all() && fresh().length > REPORTS_SHOWN))
          }
        >
          <Button
            aria-label={all() ? "Show fewer reports" : "Show all reports"}
            class={cn(
              "text-brand hover:text-brand/80 h-auto w-full justify-start rounded-none px-3 py-1 text-[11.5px]",
              rowText,
            )}
            onClick={(_event, details) =>
              writingAs(details.source, () => setAll(!all()))
            }
            size={null}
            variant={null}
          >
            {all()
              ? "Show fewer"
              : [
                  hidden() > 0 && `Show ${hidden()} more`,
                  kept().length > 0 && `${kept().length} kept`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </Button>
        </Show>
      </section>
    </Show>
  );
}

type FolderNode = Extract<TreeNode, { kind: "folder" }>;

const folderOf = (node: TreeNode) =>
  node.kind === "folder" ? node : undefined;

function Folder(props: {
  node: FolderNode;
  depth: number;
  forceOpen: boolean;
  isOpen: (path: string) => boolean;
  setOpen: (path: string, open: boolean) => void;
  titles: Record<string, string>;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <Collapsible
      bind={[
        () => props.forceOpen || props.isOpen(props.node.path),
        (open) => props.setOpen(props.node.path, open),
      ]}
    >
      <CollapsibleTrigger
        aria-label={`Folder ${props.node.path}`}
        class={cn(
          "group/folder hover:bg-accent/60 flex w-full min-w-0 items-center gap-2 py-1 pr-3 text-left",
          rowText,
        )}
        style={indent(props.depth)}
        title={props.node.path}
      >
        <ChevronRightIcon
          aria-hidden="true"
          class="text-muted-foreground size-3 shrink-0 transition-transform group-aria-expanded/folder:rotate-90"
        />
        <span class="min-w-0 flex-1 truncate">
          {props.node.name}
        </span>
        <span class={countClass}>{props.node.count}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Nodes
          depth={props.depth + 1}
          forceOpen={props.forceOpen}
          isOpen={props.isOpen}
          nodes={props.node.children}
          onSelect={props.onSelect}
          selected={props.selected}
          setOpen={props.setOpen}
          titles={props.titles}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

function Nodes(props: {
  nodes: TreeNode[];
  depth: number;
  forceOpen: boolean;
  isOpen: (path: string) => boolean;
  setOpen: (path: string, open: boolean) => void;
  titles: Record<string, string>;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const label = (node: TreeNode) =>
    node.kind === "file"
      ? (props.titles[node.path] ?? node.fallback)
      : node.name;
  const clashes = createMemo(() => {
    const seen = new Map<string, number>();
    for (const node of props.nodes)
      if (node.kind === "file")
        seen.set(label(node), (seen.get(label(node)) ?? 0) + 1);
    return seen;
  });
  return (
    <For each={props.nodes} keyed={(node) => `${node.kind}:${node.path}`}>
      {(node) => (
        <Show
          fallback={
            <FileButton
              depth={props.depth}
              detail={
                (clashes().get(label(node())) ?? 0) > 1 ||
                (props.titles[node().path] === undefined &&
                  !/\.md$/i.test(node().path))
                  ? node().path.slice(node().path.lastIndexOf("/") + 1)
                  : undefined
              }
              label={label(node())}
              onSelect={props.onSelect}
              path={node().path}
              selected={node().path === props.selected}
            />
          }
          when={folderOf(node())}
        >
          {(folder) => (
            <Folder
              depth={props.depth}
              forceOpen={props.forceOpen}
              isOpen={props.isOpen}
              node={folder()}
              onSelect={props.onSelect}
              selected={props.selected}
              setOpen={props.setOpen}
              titles={props.titles}
            />
          )}
        </Show>
      )}
    </For>
  );
}

export function DocTree(props: {
  paths: string[];
  total: number;
  titles: Record<string, string>;
  filtering: boolean;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpenList] = useExtensionUiState<string[]>("open", []);
  const openSet = createMemo(() => new Set(open()));
  const tree = createMemo(() => buildTree(props.paths));
  createEffect(
    () => props.selected,
    (selected) => {
      if (!selected) return;
      const needed = ancestors(selected);
      if (needed.length === 0) return;
      writingAs("app", () =>
        setOpenList((previous) =>
          needed.every((path) => previous.includes(path))
            ? previous
            : [...new Set([...previous, ...needed])],
        ),
      );
    },
  );
  return (
    <Show when={props.paths.length > 0}>
      <section>
        <h3 class={groupHeading}>
          Repository
          <span class={countClass}>{props.total}</span>
        </h3>
        <Nodes
          depth={0}
          forceOpen={props.filtering}
          isOpen={(path) => openSet().has(path)}
          nodes={tree()}
          onSelect={props.onSelect}
          selected={props.selected}
          setOpen={(path, next) => {
            if (props.filtering) return;
            setOpenList((previous) =>
              next
                ? [...new Set([...previous, path])]
                : previous.filter((item) => item !== path),
            );
          }}
          titles={props.titles}
        />
      </section>
    </Show>
  );
}

export function JumpDialog(props: {
  paths: string[];
  reports: Report[];
  titles: Record<string, string>;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useDialog(jumpDialog);
  const items = createMemo(() => [
    ...props.reports.map((report) => ({
      path: report.path,
      title: props.titles[report.path] ?? reportFallback(report.path),
      where: report.archived ? "report · kept" : "report",
    })),
    ...props.paths.map((path) => ({
      path,
      title: props.titles[path] ?? docName(path),
      where: path,
    })),
  ]);
  return (
    <Dialog onOpenChange={setOpen} open={open()}>
      <DialogContent
        class="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogTitle class="sr-only">Jump to doc</DialogTitle>
        <DialogDescription class="sr-only">
          Type part of a doc's title or path, then pick it to open it.
        </DialogDescription>
        <Command
          onAction={(path) => {
            setOpen(false);
            props.onSelect(path);
          }}
        >
          <CommandInput
            aria-label="Find a doc"
            class="text-[13px]"
            placeholder="Jump to doc…"
          />
          <CommandEmpty class="text-muted-foreground py-6 text-center text-[12px]">
            No doc matches.
          </CommandEmpty>
          <CommandList class="max-h-[55vh]">
            <For each={items()} keyed={(item) => item.path}>
              {(item) => (
                <CommandItem
                  class="flex-col items-start gap-0 py-1.5"
                  keywords={[item().path]}
                  label={item().title}
                  value={item().path}
                >
                  <span class="w-full truncate text-[13px]">
                    {item().title}
                  </span>
                  <span class="text-muted-foreground w-full truncate font-mono text-[10.5px]">
                    {item().where}
                  </span>
                </CommandItem>
              )}
            </For>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
