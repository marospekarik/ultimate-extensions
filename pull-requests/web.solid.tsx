/** @jsxImportSource @solidjs/web */
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CircleDotIcon,
  EyeIcon,
  FileDiffIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  LaptopIcon,
  MinusIcon,
  PlayIcon,
  RefreshCwIcon,
  XIcon,
} from "@lucide/solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Markdown } from "@/components/markdown/markdown.solid.tsx";
import { Button } from "@/components/ui/button.solid.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.solid.tsx";
import { Textarea } from "@/components/ui/input.solid.tsx";
import {
  api,
  cn,
  Conversation,
  defineWebExtension,
  Dock,
  errorMessage,
  formatAgo,
  Header,
  keepLast,
  showSurface,
  StatusLine,
  useAction,
  useExtensionUiState,
  useNow,
  useUiState,
  useViewport,
  writingAs,
} from "@/sdk/solid";
import {
  CloseAction,
  CommentAction,
  FetchAction,
  InstanceListAction,
  InstanceStartAction,
  InstanceStopAction,
  ListAction,
  LocalRunsAction,
  MergeAction,
  previewLabel,
  ReviewAction,
  RunLocallyAction,
  SitePreviewAction,
  StopLocalRunAction,
  ViewAction,
} from "./refs.ts";
import type {
  Check,
  Checks,
  InstancePreview,
  PrDetail,
  PrSummary,
  SitePreview,
  TimelineItem,
} from "./refs.ts";
import { Link, SURFACE } from "./link.solid.tsx";
import { Marks } from "./marks.solid.tsx";

const useSelected = () => useExtensionUiState<number | null>("selected", null);
/** The head each PR had when its diff was last opened in Review, by `<repo>#<number>`: what Merge pins. */
const useReviewed = () =>
  useExtensionUiState<Record<string, string>>("reviewed", {});

const ago = (at: string, now: number) =>
  formatAgo(Date.parse(at), now, { ago: true });

const textLink =
  "inline h-auto gap-0 p-0 font-[inherit] text-[length:inherit] font-normal whitespace-normal underline underline-offset-2 disabled:opacity-50";

// ── Small parts ──

function ChecksIcon(props: { state: Checks | Check["state"]; class?: string }) {
  const look = (tone: string) => cn("size-3.5 shrink-0", props.class, tone);
  return (
    <Switch fallback={<MinusIcon class={look("text-muted-foreground/60")} />}>
      <Match when={props.state === "pass"}>
        <CheckIcon class={look("text-success")} />
      </Match>
      <Match when={props.state === "fail"}>
        <XIcon class={look("text-error")} />
      </Match>
      <Match when={props.state === "pending"}>
        <CircleDotIcon class={look("text-warning")} />
      </Match>
    </Switch>
  );
}

const checksLabel: Record<Checks, string> = {
  pass: "CI passed",
  fail: "CI failed",
  pending: "CI running",
  none: "no CI checks",
};

function Tag(props: {
  children: JSX.Element;
  tone?: "error" | "warning" | "success";
}) {
  return (
    <span
      class={cn(
        "shrink-0 rounded-sm border px-1 font-mono text-[10.5px] leading-[1.5]",
        props.tone === "error" && "border-error/40 text-error",
        props.tone === "warning" && "border-warning/40 text-warning",
        props.tone === "success" && "border-success/40 text-success",
        !props.tone && "border-border/70 text-muted-foreground",
      )}
    >
      {props.children}
    </span>
  );
}

function Quiet(props: { children: JSX.Element }) {
  return (
    <p class="px-4 py-10 text-center font-mono text-[11.5px] text-muted-foreground/70">
      {props.children}
    </p>
  );
}

// ── The list ──

/** The Ultimate previews of PRs that run now, for a mark in the list. */
function usePreviewed() {
  const list = useAction(InstanceListAction, null, {
    every: 15_000,
    onError: keepLast,
  });
  return createMemo(
    () =>
      new Set(
        (list.data() ?? [])
          .filter((item) => item.running && item.label)
          .map((item) => item.label!),
      ),
  );
}

function List(props: {
  prs: PrSummary[];
  viewer: string;
  selected: number | null;
  onSelect: (n: number) => void;
  class?: string;
}) {
  const previewed = usePreviewed();
  const local = useAction(LocalRunsAction, null, {
    every: 15_000,
    onError: keepLast,
  });
  const runningLocally = createMemo(
    () =>
      new Set(
        (local.data()?.runs ?? [])
          .filter((run) => run.status !== "failed")
          .map((run) => run.number),
      ),
  );
  const now = useNow(60_000);
  return (
    <Show
      fallback={
        <nav class={cn("bg-sidebar", props.class)}>
          <Quiet>No open pull requests.</Quiet>
        </nav>
      }
      when={props.prs.length > 0}
    >
      <nav class={cn("min-h-0 overflow-y-auto bg-sidebar py-1", props.class)}>
        <For each={props.prs} keyed={(pr) => pr.number}>
          {(pr) => (
            <Button
              class={cn(
                "block h-auto w-full rounded-none px-3 py-2 text-left font-normal whitespace-normal hover:bg-accent/60 pointer-coarse:py-3",
                pr().number === props.selected && "bg-accent text-foreground",
              )}
              onClick={() => props.onSelect(pr().number)}
              size={null}
              title={pr().title}
              variant={null}
            >
              <span class="flex items-start gap-2">
                <ChecksIcon class="mt-[3px]" state={pr().checks} />
                <span class="line-clamp-2 min-w-0 flex-1 text-[12.5px] leading-snug">
                  {pr().title}
                </span>
              </span>
              <span class="mt-1 flex items-center gap-1.5 pl-[22px] font-mono text-[10.5px] text-muted-foreground">
                <span>#{pr().number}</span>
                <span class="min-w-0 truncate">
                  {pr().author === props.viewer ? "you" : pr().author}
                </span>
                <span class="shrink-0 text-muted-foreground/60">
                  · {ago(pr().updatedAt, now())}
                </span>
                <span class="ml-auto flex shrink-0 items-center gap-1">
                  <Marks number={pr().number} place="row" />
                  <Show when={runningLocally().has(pr().number)}>
                    <Tag>running</Tag>
                  </Show>
                  <Show when={previewed().has(previewLabel(pr().number))}>
                    <Tag>preview</Tag>
                  </Show>
                  <Show when={pr().draft}>
                    <Tag>draft</Tag>
                  </Show>
                  <Show when={pr().mergeable === "CONFLICTING"}>
                    <Tag tone="error">conflicts</Tag>
                  </Show>
                  <Show when={pr().blockers.length === 0}>
                    <Tag tone="success">ready</Tag>
                  </Show>
                </span>
              </span>
            </Button>
          )}
        </For>
      </nav>
    </Show>
  );
}

// ── The PR ──

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="mt-6">
      <h3 class="mb-2 font-mono text-[10.5px] tracking-wider text-muted-foreground/80 uppercase">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

const verdict: Record<string, { label: string; tone?: "error" | "success" }> = {
  APPROVED: { label: "approved", tone: "success" },
  CHANGES_REQUESTED: { label: "changes requested", tone: "error" },
  COMMENTED: { label: "reviewed" },
  DISMISSED: { label: "dismissed" },
};

function Timeline(props: { items: TimelineItem[]; viewer: string }) {
  const now = useNow(60_000);
  return (
    <Show
      fallback={
        <p class="font-mono text-[11.5px] text-muted-foreground/70">
          No comments yet.
        </p>
      }
      when={props.items.length > 0}
    >
      <ol class="space-y-3">
        <For each={props.items} keyed={false}>
          {(item) => (
            <li class="rounded-md border border-border/70 bg-card">
              <div class="flex items-center gap-1.5 border-b border-border/50 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                <span class="text-foreground/85">
                  {item().author === props.viewer ? "you" : item().author}
                </span>
                <Show when={item().kind === "review" && item().state}>
                  <Tag tone={verdict[item().state!]?.tone}>
                    {verdict[item().state!]?.label ?? item().state}
                  </Tag>
                </Show>
                <Show when={item().kind === "inline" && item().path}>
                  <span class="min-w-0 truncate" title={item().path}>
                    on {item().path}
                    {item().line ? `:${item().line}` : ""}
                  </span>
                </Show>
                <span class="ml-auto shrink-0 text-muted-foreground/60">
                  {ago(item().at, now())}
                </span>
              </div>
              <Show when={item().body.trim()}>
                <div class="px-3 py-2 text-[13px]">
                  <Markdown text={item().body} />
                </div>
              </Show>
            </li>
          )}
        </For>
      </ol>
    </Show>
  );
}

function MergeDialog(props: {
  pr: PrDetail;
  pinned: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged: () => void;
}) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const head = () => props.pinned ?? props.pr.headSha;
  const moved = () =>
    props.pinned !== undefined && props.pinned !== props.pr.headSha;
  const blocked = () => moved() || props.pr.blockers.length > 0;
  const merge = async (_event: unknown, details: { source?: string }) => {
    const source = details.source;
    setBusy(true);
    setError(null);
    try {
      await api.action(MergeAction, { number: props.pr.number, head: head() });
      writingAs(source, props.onMerged);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      onOpenChange={(next) => {
        if (busy()) return;
        setError(null);
        props.onOpenChange(next);
      }}
      open={props.open}
    >
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle class="text-[15px]">
            Merge PR #{props.pr.number}?
          </DialogTitle>
          <DialogDescription class="text-[13px]">
            {props.pr.title}
          </DialogDescription>
        </DialogHeader>
        <dl class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[11.5px]">
          <dt class="text-muted-foreground/70">commit</dt>
          <dd>
            {head().slice(0, 7)}{" "}
            <span class="text-muted-foreground">
              {props.pinned
                ? "(the head you opened in Review)"
                : "(the head shown; diff not opened)"}
            </span>
          </dd>
          <dt class="text-muted-foreground/70">into</dt>
          <dd>
            {props.pr.base}{" "}
            <span class="text-muted-foreground">as a merge commit</span>
          </dd>
          <dt class="text-muted-foreground/70">checks</dt>
          <dd class="flex items-center gap-1.5">
            <ChecksIcon state={props.pr.checks} />
            {checksLabel[props.pr.checks]}
          </dd>
        </dl>
        <Show when={moved()}>
          <p class="text-[12.5px] text-warning">
            New commits since you opened the diff ({props.pinned?.slice(0, 7)} →{" "}
            {props.pr.headSha.slice(0, 7)}). Open the diff again to review them.
          </p>
        </Show>
        <For each={props.pr.blockers}>
          {(blocker) => <p class="text-[12.5px] text-error">{blocker}</p>}
        </For>
        <Show when={error()}>
          <p class="text-[12.5px] text-error">{error()}</p>
        </Show>
        <div class="flex justify-end gap-2">
          <Button
            aria-label={`Cancel merge #${props.pr.number}`}
            disabled={busy()}
            onClick={() => props.onOpenChange(false)}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            aria-label={`Confirm merge #${props.pr.number}`}
            data-agent-confirm="Merges the pull request into its base branch on GitHub."
            disabled={busy() || blocked()}
            onClick={merge}
            size="sm"
          >
            <GitMergeIcon />
            {busy() ? "Merging…" : "Merge"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog(props: {
  pr: PrDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
}) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const close = async (_event: unknown, details: { source?: string }) => {
    const source = details.source;
    setBusy(true);
    setError(null);
    try {
      await api.action(CloseAction, { number: props.pr.number });
      writingAs(source, props.onClosed);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      onOpenChange={(next) => !busy() && props.onOpenChange(next)}
      open={props.open}
    >
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle class="text-[15px]">
            Close PR #{props.pr.number} without merging?
          </DialogTitle>
          <DialogDescription class="text-[13px]">
            {props.pr.title}
          </DialogDescription>
        </DialogHeader>
        <Show when={error()}>
          <p class="text-[12.5px] text-error">{error()}</p>
        </Show>
        <div class="flex justify-end gap-2">
          <Button
            aria-label={`Cancel close #${props.pr.number}`}
            disabled={busy()}
            onClick={() => props.onOpenChange(false)}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            aria-label={`Confirm close #${props.pr.number}`}
            data-agent-confirm="Closes the pull request on GitHub without merging it."
            disabled={busy()}
            onClick={close}
            size="sm"
            variant="destructive"
          >
            {busy() ? "Closing…" : "Close PR"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Composer(props: { pr: PrDetail; onSent: () => void }) {
  const [body, setBody] = createSignal("");
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const send = (what: string, call: () => Promise<unknown>) => async () => {
    setBusy(what);
    setError(null);
    try {
      await call();
      setBody("");
      props.onSent();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };
  const text = () => body().trim();
  return (
    <div class="mt-3 space-y-2">
      <Textarea
        aria-label={`Comment text for #${props.pr.number}`}
        class="block min-h-20 w-full border-border/70 px-3"
        onValueChange={setBody}
        placeholder={
          props.pr.own
            ? "Comment on GitHub…"
            : "Comment, or a note with your approval or requested changes…"
        }
        value={body()}
      />
      <Show when={error()}>
        <p class="text-[12.5px] text-error">{error()}</p>
      </Show>
      <div class="flex flex-wrap justify-end gap-2">
        <Show when={!props.pr.own}>
          <Button
            aria-label={`Request changes on #${props.pr.number}`}
            data-agent-confirm="Posts a review on GitHub that requests changes."
            disabled={busy() !== null || !text()}
            onClick={send("changes", () =>
              api.action(ReviewAction, {
                number: props.pr.number,
                event: "request-changes",
                body: text(),
              }),
            )}
            size="sm"
            variant="outline"
          >
            {busy() === "changes" ? "Sending…" : "Request changes"}
          </Button>
          <Button
            aria-label={`Approve #${props.pr.number}`}
            data-agent-confirm="Posts an approving review on GitHub."
            disabled={busy() !== null}
            onClick={send("approve", () =>
              api.action(ReviewAction, {
                number: props.pr.number,
                event: "approve",
                ...(text() && { body: text() }),
              }),
            )}
            size="sm"
            variant="outline"
          >
            <CheckIcon />
            {busy() === "approve" ? "Approving…" : "Approve"}
          </Button>
        </Show>
        <Button
          aria-label={`Comment on #${props.pr.number}`}
          data-agent-confirm="Posts the comment on the pull request on GitHub."
          disabled={busy() !== null || !text()}
          onClick={send("comment", () =>
            api.action(CommentAction, {
              number: props.pr.number,
              body: text(),
            }),
          )}
          size="sm"
          variant="secondary"
        >
          {busy() === "comment" ? "Posting…" : "Comment"}
        </Button>
      </div>
    </div>
  );
}

/** The site preview's state for the PR's head, under the action buttons like the diff note. */
function SitePreviewNote(props: {
  site: Exclude<SitePreview, { status: "off" }>;
}) {
  const sha = () => props.site.head.slice(0, 7);
  const check = () => (
    <Show when={props.site.check?.url}>
      {(url) => (
        <a
          class="underline underline-offset-2"
          href={url()}
          rel="noreferrer"
          target="_blank"
        >
          {props.site.status === "failed" ? "see the run" : "the run"}
        </a>
      )}
    </Show>
  );
  return (
    <Switch
      fallback={
        <p class="text-muted-foreground/70">No site preview for this PR.</p>
      }
    >
      <Match when={props.site.status === "ready"}>
        <p class="flex items-center gap-1.5 text-muted-foreground">
          <CheckIcon class="size-3.5 text-success" />
          Site preview built for {sha()}, the current head.
        </p>
      </Match>
      <Match when={props.site.status === "building"}>
        <p class="flex items-center gap-1.5 text-muted-foreground">
          <CircleDotIcon class="size-3.5 text-warning" />
          Site preview is building for {sha()}; the page may still show an
          earlier build. {check()}
        </p>
      </Match>
      <Match when={props.site.status === "failed"}>
        <p class="flex items-center gap-1.5 text-error">
          <XIcon class="size-3.5" />
          The site preview failed to build for {sha()}: {check()}
        </p>
      </Match>
      <Match when={props.site.status === "earlier"}>
        <p class="text-muted-foreground">
          Site preview is from an earlier commit: the commits since did not
          change the site.
        </p>
      </Match>
    </Switch>
  );
}

/** How many Ultimate previews of PRs may run at once; starting one more stops the one opened least recently. */
const PREVIEW_CAP = 2;
const isPrPreview = (item: InstancePreview) =>
  item.running && /^PR #\d+$/.test(item.label ?? "");

type Details = { source?: string };

/**
 * An Ultimate preview of the PR's head for PRs that change `.ultimate/`: `button` starts it, `note` says what runs and
 * offers its link (the `instance` link renderer shows it in the frame here, or opens its tailnet address elsewhere),
 * Stop, and Restart when the PR moved on.
 */
function useUltimatePreview(
  number: () => number,
  pr: () => PrDetail | undefined,
  inPreview: () => boolean,
) {
  const list = useAction(InstanceListAction, null, {
    every: 5000,
    onError: keepLast,
  });
  /** When each running PR preview was last started or opened, by preview id: the cap stops the oldest. */
  const [opened, setOpened] = useExtensionUiState<Record<string, number>>(
    "previewOpened",
    {},
  );
  const [busy, setBusy] = createSignal<"starting" | "stopping" | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const active = () => {
    const current = pr();
    return current && current.ultimate && !inPreview() ? current : undefined;
  };
  const running = () => (list.data() ?? []).filter(isPrPreview);
  const mine = () =>
    running().find((item) => item.label === previewLabel(number()));
  const touch = (id: string) => {
    const alive = running();
    setOpened((previous) => ({
      ...Object.fromEntries(
        Object.entries(previous).filter(([key]) =>
          alive.some((item) => item.id === key),
        ),
      ),
      [id]: Date.now(),
    }));
  };
  const act =
    (
      what: "starting" | "stopping",
      call: (source: string | undefined) => Promise<unknown>,
    ) =>
    async (_event: unknown, details: Details) => {
      setBusy(what);
      setError(null);
      try {
        await call(details.source);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusy(null);
        void list.refetch();
      }
    };
  const start = act("starting", async (source) => {
    const label = previewLabel(number());
    const { head } = await api.action(FetchAction, { number: number() });
    const existing = mine();
    if (existing) await api.action(InstanceStopAction, { id: existing.id });
    const others = running()
      .filter((item) => item.label !== label)
      .toSorted((a, b) => (opened()[a.id] ?? 0) - (opened()[b.id] ?? 0));
    for (const item of others.slice(
      0,
      Math.max(0, others.length - PREVIEW_CAP + 1),
    ))
      await api.action(InstanceStopAction, { id: item.id });
    const started = await api.action(InstanceStartAction, { ref: head, label });
    writingAs(source, () => touch(started.id));
  });
  const stop = act("stopping", () =>
    api.action(InstanceStopAction, { id: mine()!.id }),
  );
  const sha = (ref?: string) => ref?.slice(0, 7) ?? "?";
  const button = () => (
    <Show when={active()?.trusted && !mine()}>
      <Button
        aria-label={`Ultimate preview of #${number()}`}
        disabled={busy() !== null}
        onClick={start}
        size="sm"
        title="Runs this PR's .ultimate/ changes in a separate Ultimate. It stops after an hour with no page open."
        variant="outline"
      >
        <PlayIcon />
        {busy() === "starting" ? "Starting…" : "Ultimate preview"}
      </Button>
    </Show>
  );
  const note = () => (
    <Show when={active()}>
      {(current) => (
        <>
          <Show when={!current().trusted}>
            <p class="text-muted-foreground/70">
              No Ultimate preview: it would run this PR&apos;s .ultimate/ code
              as you, so it is offered only for PRs from people with write
              access, never from forks.
            </p>
          </Show>
          <Show when={busy() === "starting"}>
            <p class="flex items-center gap-1.5 text-muted-foreground">
              <CircleDotIcon class="size-3.5 animate-pulse text-warning" />
              Starting an Ultimate preview of {sha(current().headSha)}; it takes
              about half a minute.
            </p>
          </Show>
          <Show when={mine()}>
            {(live) => (
              <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
                <CheckIcon class="size-3.5 text-success" />
                <span>Ultimate preview of {sha(live().ref)}:</span>
                <div
                  class="[&_p]:m-0"
                  ref={(element) =>
                    element.addEventListener("click", () => touch(live().id), {
                      capture: true,
                    })
                  }
                >
                  <Markdown text={`[${live().label}](${live().url}/)`} />
                </div>
                <span>·</span>
                <Button
                  aria-label={`Stop Ultimate preview of #${number()}`}
                  class={textLink}
                  disabled={busy() !== null}
                  onClick={stop}
                  size={null}
                  variant={null}
                >
                  {busy() === "stopping" ? "Stopping…" : "Stop"}
                </Button>
              </div>
            )}
          </Show>
          <Show when={mine() && mine()!.ref !== current().headSha}>
            <p class="text-warning">
              New commits since the preview started ({sha(mine()?.ref)} →{" "}
              {sha(current().headSha)}
              ).{" "}
              <Button
                aria-label={`Restart Ultimate preview of #${number()}`}
                class={textLink}
                disabled={busy() !== null}
                onClick={start}
                size={null}
                variant={null}
              >
                {busy() === "starting" ? "Restarting…" : "Restart it"}
              </Button>
            </p>
          </Show>
          <Show when={error()}>
            <p class="text-error">{error()}</p>
          </Show>
        </>
      )}
    </Show>
  );
  return { button, note };
}

/** Whether this page is on this machine: a local run listens on its localhost only. */
const onThisMachine = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(
  location.hostname,
);

/**
 * A local run of the PR's head with the user's `pullRequests.localRun` command: `button` starts it, `note` links it
 * while it runs, with Stop, and Restart when the PR moved on.
 */
function useLocalRun(number: () => number, pr: () => PrDetail | undefined) {
  const runs = useAction(LocalRunsAction, null, {
    every: 3000,
    onError: keepLast,
  });
  const [busy, setBusy] = createSignal<"starting" | "stopping" | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const enabled = () => (runs.data()?.enabled ? pr() : undefined);
  const mine = () => runs.data()?.runs.find((run) => run.number === number());
  const act =
    (what: "starting" | "stopping", call: () => Promise<unknown>) =>
    async () => {
      setBusy(what);
      setError(null);
      try {
        await call();
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusy(null);
        void runs.refetch();
      }
    };
  const start = act("starting", () =>
    api.action(RunLocallyAction, { number: number() }),
  );
  const stop = act("stopping", () =>
    api.action(StopLocalRunAction, { number: number() }),
  );
  const sha = (ref: string) => ref.slice(0, 7);
  const live = () => {
    const run = mine();
    return run && run.status !== "failed" ? run : undefined;
  };
  const address = () => {
    const run = mine();
    return run?.status === "running"
      ? onThisMachine
        ? run.url
        : (run.tailnet ?? run.url)
      : undefined;
  };
  const button = () => (
    <Show when={enabled()?.trusted && !live()}>
      <Button
        aria-label={`Run #${number()} locally`}
        disabled={busy() !== null}
        onClick={start}
        size="sm"
        title="Runs this PR's head on this machine with mocked providers, in a temporary worktree removed on Stop."
        variant="outline"
      >
        <LaptopIcon />
        {busy() === "starting" ? "Starting…" : "Run locally"}
      </Button>
    </Show>
  );
  const stopButton = () => (
    <Button
      aria-label={`Stop local run of #${number()}`}
      class={textLink}
      disabled={busy() !== null || mine()?.status === "stopping"}
      onClick={stop}
      size={null}
      variant={null}
    >
      {busy() === "stopping" || mine()?.status === "stopping"
        ? "Stopping…"
        : "Stop"}
    </Button>
  );
  const note = () => (
    <Show when={enabled()}>
      {(current) => (
        <>
          <Show when={!current().trusted}>
            <p class="text-muted-foreground/70">
              No local run: it would run this PR&apos;s code as you, so it is
              offered only for PRs from people with write access, never from
              forks.
            </p>
          </Show>
          <Show when={mine()?.status === "starting" && mine()}>
            {(run) => (
              <p class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
                <CircleDotIcon class="size-3.5 animate-pulse text-warning" />
                <span>Starting {sha(run().head)} locally…</span>
                <span>·</span>
                {stopButton()}
              </p>
            )}
          </Show>
          <Show when={mine()?.status === "running" && mine()}>
            {(run) => (
              <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
                <CheckIcon class="size-3.5 text-success" />
                <span>
                  Running at{" "}
                  <a
                    class="underline underline-offset-2"
                    href={address()}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {address()}
                  </a>{" "}
                  (commit {sha(run().head)})
                </span>
                <span>·</span>
                {stopButton()}
              </div>
            )}
          </Show>
          <Show when={mine()?.status === "stopping"}>
            <p class="flex items-center gap-1.5 text-muted-foreground">
              <CircleDotIcon class="size-3.5 animate-pulse text-warning" />
              Stopping the local run and removing its worktree…
            </p>
          </Show>
          <Show
            when={
              mine()?.status === "running" &&
              !onThisMachine &&
              address() === undefined
            }
          >
            <p class="text-muted-foreground">
              The local run is reachable only on this machine: open it in a
              browser here.
            </p>
          </Show>
          <Show when={live() && live()!.head !== current().headSha}>
            <p class="text-warning">
              New commits since the local run started ({sha(live()!.head)} →{" "}
              {sha(current().headSha)}).{" "}
              <Button
                aria-label={`Restart local run of #${number()}`}
                class={textLink}
                disabled={busy() !== null}
                onClick={start}
                size={null}
                variant={null}
              >
                {busy() === "starting" ? "Restarting…" : "Restart it"}
              </Button>
            </p>
          </Show>
          <Show when={failedRun()}>
            {(run) => (
              <p class="text-error">
                The local run of {sha(run().head)} stopped: {run().error}
              </p>
            )}
          </Show>
          <Show when={error()}>
            <p class="text-error">{error()}</p>
          </Show>
        </>
      )}
    </Show>
  );
  const failedRun = () => {
    const run = mine();
    return run?.status === "failed" ? run : undefined;
  };
  return { button, note };
}

function Detail(props: {
  number: number;
  repo: string;
  viewer: string;
  preview: boolean;
  onDone: (message: string) => void;
}) {
  const view = useAction(
    ViewAction,
    {
      get number() {
        return props.number;
      },
    },
    { every: 60_000, focus: true },
  );
  const siteAction = useAction(
    SitePreviewAction,
    {
      get number() {
        return props.number;
      },
    },
    { every: 60_000, focus: true },
  );
  const site = () => {
    const data = siteAction.data();
    return data?.status === "off" ? undefined : data;
  };
  const pr = () =>
    view.data()?.number === props.number ? view.data() : undefined;
  const ultimatePreview = useUltimatePreview(
    () => props.number,
    pr,
    () => props.preview,
  );
  const localRun = useLocalRun(() => props.number, pr);
  return (
    <Show
      fallback={
        <Show
          fallback={
            <p class="font-mono text-[12px] text-muted-foreground">loading…</p>
          }
          when={view.error()}
        >
          {(error) => (
            <p class="font-mono text-[12px] text-error">{error().message}</p>
          )}
        </Show>
      }
      when={pr()}
    >
      {(current) => (
        <DetailBody
          localRun={localRun}
          onDone={props.onDone}
          onSent={() => void view.refetch()}
          pr={current()}
          preview={props.preview}
          repo={props.repo}
          site={site()}
          ultimatePreview={ultimatePreview}
          viewer={props.viewer}
        />
      )}
    </Show>
  );
}

function DetailBody(props: {
  pr: PrDetail;
  repo: string;
  viewer: string;
  preview: boolean;
  site: Exclude<SitePreview, { status: "off" }> | undefined;
  localRun: { button: () => JSX.Element; note: () => JSX.Element };
  ultimatePreview: { button: () => JSX.Element; note: () => JSX.Element };
  onDone: (message: string) => void;
  onSent: () => void;
}) {
  const [reviewed, setReviewed] = useReviewed();
  const [, setReviewSpec] = useUiState<string>(
    "ext.review.spec",
    "uncommitted",
  );
  const [opening, setOpening] = createSignal(false);
  const [openError, setOpenError] = createSignal<string | null>(null);
  const [dialog, setDialog] = createSignal<"merge" | "close" | null>(null);
  const key = () => `${props.repo}#${props.pr.number}`;
  const pinned = () => reviewed()[key()];
  const stale = () => pinned() !== undefined && pinned() !== props.pr.headSha;
  const openDiff = async (_event: unknown, details: Details) => {
    const source = details.source;
    setOpening(true);
    setOpenError(null);
    try {
      const { spec, head } = await api.action(FetchAction, {
        number: props.pr.number,
      });
      writingAs(source, () => {
        setReviewed((previous) => ({ ...previous, [key()]: head }));
        setReviewSpec(spec);
        showSurface("review");
      });
    } catch (caught) {
      setOpenError(errorMessage(caught));
    } finally {
      setOpening(false);
    }
  };
  const forget = () =>
    setReviewed((previous) => {
      const rest = { ...previous };
      delete rest[key()];
      return rest;
    });
  return (
    <>
      <div class="flex items-start gap-2">
        <h1 class="min-w-0 flex-1 text-[17px] leading-snug font-semibold">
          {props.pr.title}
        </h1>
        <a
          class="mt-1 flex shrink-0 items-center gap-0.5 font-mono text-[11.5px] text-muted-foreground hover:text-foreground"
          href={props.pr.url}
          rel="noreferrer"
          target="_blank"
          title="Open on GitHub"
        >
          #{props.pr.number}
          <ArrowUpRightIcon class="size-3" />
        </a>
      </div>
      <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
        <span class="text-foreground/85">
          {props.pr.own ? "you" : props.pr.author}
        </span>
        <span
          class="min-w-0 truncate"
          title={`${props.pr.head} → ${props.pr.base}`}
        >
          {props.pr.head} → {props.pr.base}
        </span>
        <span>
          <span class="text-diff-add">+{props.pr.additions}</span>{" "}
          <span class="text-diff-del">−{props.pr.deletions}</span> ·{" "}
          {props.pr.changedFiles} files
        </span>
        <Show when={props.pr.draft}>
          <Tag>draft</Tag>
        </Show>
        <Show when={verdict[props.pr.reviewDecision]}>
          {(decision) => <Tag tone={decision().tone}>{decision().label}</Tag>}
        </Show>
      </div>
      <Marks number={props.pr.number} place="detail" />

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <Button
          aria-label={`Review diff of #${props.pr.number}`}
          disabled={opening()}
          onClick={openDiff}
          size="sm"
          variant="outline"
        >
          <FileDiffIcon />
          {opening() ? "Fetching…" : "Review diff"}
        </Button>
        <Show
          when={
            props.site &&
            props.site.status !== "none" &&
            props.site.status !== "failed"
          }
        >
          <Button
            aria-label={`Preview site of #${props.pr.number}`}
            render={(link) => (
              <a
                {...link}
                href={props.site?.url}
                rel="noreferrer"
                target="_blank"
                title={props.site?.url}
              >
                <EyeIcon />
                Preview site
              </a>
            )}
            size="sm"
            variant="outline"
          />
        </Show>
        {props.localRun.button()}
        {props.ultimatePreview.button()}
        <Button
          aria-label={`Merge #${props.pr.number}`}
          disabled={props.preview || props.pr.blockers.length > 0 || stale()}
          onClick={() => setDialog("merge")}
          size="sm"
          title={props.preview ? "Off in a preview" : undefined}
        >
          <GitMergeIcon />
          Merge
        </Button>
        <Button
          aria-label={`Close PR #${props.pr.number}`}
          class="ml-auto text-muted-foreground"
          disabled={props.preview}
          onClick={() => setDialog("close")}
          size="sm"
          title={props.preview ? "Off in a preview" : undefined}
          variant="ghost"
        >
          Close PR
        </Button>
      </div>
      <Show when={openError()}>
        <p class="mt-2 text-[12.5px] text-error">{openError()}</p>
      </Show>
      <div class="mt-3 space-y-1 text-[12.5px]">
        <Show when={props.preview}>
          <p class="text-muted-foreground">
            This is a preview: merging, closing, commenting and reviewing are
            off here.
          </p>
        </Show>
        <Show when={props.site}>
          {(site) => <SitePreviewNote site={site()} />}
        </Show>
        {props.localRun.note()}
        {props.ultimatePreview.note()}
        <Show when={pinned() === props.pr.headSha}>
          <p class="flex items-center gap-1.5 text-muted-foreground">
            <CheckIcon class="size-3.5 text-success" />
            You opened the diff at {props.pr.headSha.slice(0, 7)}, the current
            head.
          </p>
        </Show>
        <Show when={stale()}>
          <p class="text-warning">
            New commits since you opened the diff ({pinned()?.slice(0, 7)} →{" "}
            {props.pr.headSha.slice(0, 7)}): review the diff again before
            merging.{" "}
            <Button
              aria-label={`Forget the reviewed head of #${props.pr.number}`}
              class={textLink}
              onClick={forget}
              size={null}
              variant={null}
            >
              Forget
            </Button>
          </p>
        </Show>
        <For each={props.pr.blockers}>
          {(blocker) => (
            <p class="text-muted-foreground">Merge waits: {blocker}</p>
          )}
        </For>
      </div>

      <Section title="Checks">
        <Show
          fallback={
            <p class="font-mono text-[11.5px] text-muted-foreground/70">
              No checks reported.
            </p>
          }
          when={props.pr.checkList.length > 0}
        >
          <ul class="space-y-1">
            <For each={props.pr.checkList} keyed={(check) => check.name}>
              {(check) => (
                <li class="flex items-center gap-2 text-[12.5px]">
                  <ChecksIcon state={check().state} />
                  <Show fallback={check().name} when={check().url}>
                    {(url) => (
                      <a
                        class="hover:underline"
                        href={url()}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {check().name}
                      </a>
                    )}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Section>

      <Section title="Description">
        <Show
          fallback={
            <p class="font-mono text-[11.5px] text-muted-foreground/70">
              No description.
            </p>
          }
          when={props.pr.body.trim()}
        >
          <div class="text-[13.5px]">
            <Markdown text={props.pr.body} />
          </div>
        </Show>
      </Section>

      <Section title={`Conversation (${props.pr.timeline.length})`}>
        <Timeline items={props.pr.timeline} viewer={props.viewer} />
        <Show when={!props.preview}>
          <Composer onSent={props.onSent} pr={props.pr} />
        </Show>
      </Section>

      <MergeDialog
        onMerged={() => {
          setDialog(null);
          forget();
          props.onDone(
            `Merged #${props.pr.number} into ${props.pr.base}. Local ${props.pr.base} follows within five minutes when Ultimate opened the PR.`,
          );
        }}
        onOpenChange={(open) => setDialog(open ? "merge" : null)}
        open={dialog() === "merge"}
        pinned={pinned()}
        pr={props.pr}
      />
      <CloseDialog
        onClosed={() => {
          setDialog(null);
          forget();
          props.onDone(`Closed #${props.pr.number}.`);
        }}
        onOpenChange={(open) => setDialog(open ? "close" : null)}
        open={dialog() === "close"}
        pr={props.pr}
      />
    </>
  );
}

// ── The surface ──

function PullRequests() {
  const list = useAction(ListAction, null, { every: 60_000, focus: true });
  const [selected, setSelected] = useSelected();
  const [done, setDone] = createSignal<string | null>(null);
  const viewport = useViewport();
  const phone = () => viewport() === "phone";
  const data = list.data;
  const ok = () => {
    const current = data();
    return current?.status === "ok" ? current : undefined;
  };
  const setup = () => {
    const current = data();
    return current?.status === "setup" ? current : undefined;
  };
  const prs = () => ok()?.prs ?? [];
  const number = createMemo(() => {
    const chosen = selected();
    return chosen !== null && prs().some((pr) => pr.number === chosen)
      ? chosen
      : null;
  });
  const select = (n: number | null) => {
    setDone(null);
    setSelected(n);
  };
  return (
    <>
      <Header>
        <Show when={phone() && number() !== null}>
          <Button
            aria-label="All pull requests"
            class="size-7 shrink-0 text-muted-foreground pointer-coarse:size-9"
            onClick={() => select(null)}
            size="icon"
            variant="ghost"
          >
            <ArrowLeftIcon class="size-4" />
          </Button>
        </Show>
        <span class="flex min-w-0 items-center gap-2 text-[13px] font-medium">
          <GitPullRequestIcon class="size-4 shrink-0 text-muted-foreground" />
          <span class="max-md:hidden">PRs</span>
          <Show when={ok()}>
            {(current) => (
              <span class="truncate font-mono text-[11.5px] font-normal text-muted-foreground">
                {current().repo} · {prs().length} open
              </span>
            )}
          </Show>
          <Show when={ok()?.preview}>
            <Tag tone="warning">preview</Tag>
          </Show>
        </span>
        <Button
          aria-label="Reload pull requests"
          class="ml-auto pointer-coarse:size-11"
          onClick={() => void list.refetch()}
          size="icon-xs"
          variant="ghost"
        >
          <RefreshCwIcon class={cn(list.loading() && "animate-spin")} />
        </Button>
      </Header>
      <div class="flex min-h-0 flex-1">
        <Switch>
          <Match when={setup()}>
            {(current) => <Quiet>{current().reason}</Quiet>}
          </Match>
          <Match when={list.error() && !data()}>
            <Quiet>{list.error()?.message}</Quiet>
          </Match>
          <Match when={!data()}>
            <Quiet>loading…</Quiet>
          </Match>
          <Match when={ok()}>
            {(current) => (
              <>
                <Show when={!phone() || number() === null}>
                  <List
                    class={
                      phone()
                        ? "flex-1"
                        : "w-80 shrink-0 border-r border-border/70"
                    }
                    onSelect={select}
                    prs={current().prs}
                    selected={number()}
                    viewer={current().viewer}
                  />
                </Show>
                <Show when={!phone() || number() !== null}>
                  <main class="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5 max-md:px-4 max-md:py-4">
                    <div class="mx-auto max-w-3xl">
                      <Show
                        fallback={
                          <Show
                            fallback={
                              <Quiet>
                                {prs().length ? "Pick a pull request." : ""}
                              </Quiet>
                            }
                            when={done()}
                          >
                            {(message) => (
                              <p class="flex items-center gap-2 text-[13px]">
                                <CheckIcon class="size-4 text-success" />
                                {message()}
                              </p>
                            )}
                          </Show>
                        }
                        keyed
                        when={number()}
                      >
                        {(chosen) => (
                          <Detail
                            number={chosen}
                            onDone={(message) => {
                              setDone(message);
                              setSelected(null);
                              void list.refetch();
                            }}
                            preview={current().preview}
                            repo={current().repo}
                            viewer={current().viewer}
                          />
                        )}
                      </Show>
                    </div>
                  </main>
                </Show>
              </>
            )}
          </Match>
        </Switch>
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

// ── Elsewhere: the status line count and PR links in messages ──

function OpenCount() {
  const list = useAction(ListAction, null, { every: 5 * 60_000 });
  const open = () => {
    const data = list.data();
    return data?.status === "ok" && data.prs.length > 0 ? data : undefined;
  };
  return (
    <Show when={open()}>
      {(data) => {
        const ready = () =>
          data().prs.filter((pr) => pr.blockers.length === 0).length;
        return (
          <Button
            class="-mx-1 h-auto gap-1.5 rounded-sm px-1 py-0 font-[inherit] text-[length:inherit] font-normal text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => showSurface(SURFACE)}
            size={null}
            title={`${data().prs.length} open pull requests on ${data().repo}, ${ready()} ready to merge`}
            variant={null}
          >
            <GitPullRequestIcon class="size-3" />
            {data().prs.length} PRs
            <Show when={ready() > 0}>
              <span class="text-success">· {ready()} ready</span>
            </Show>
          </Button>
        );
      }}
    </Show>
  );
}

export default defineWebExtension({
  surfaces: [
    {
      id: SURFACE,
      title: "PRs",
      icon: GitPullRequestIcon,
      description: "The project's open GitHub PRs: diff, CI, comments, merge",
      order: 55,
      component: PullRequests,
    },
  ],
  commands: [
    {
      id: "pull-requests.open",
      title: "Open PRs",
      run: (context) => context.showSurface(SURFACE),
    },
  ],
  slots: { "statusline.right": [OpenCount] },
  link: Link,
});
