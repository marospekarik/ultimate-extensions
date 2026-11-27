/** @jsxImportSource @solidjs/web */
import {
  CheckIcon,
  CircleDotIcon,
  GitBranchIcon,
  MessageSquareWarningIcon,
  MinusIcon,
  ShieldCheckIcon,
  XIcon,
} from "@lucide/solid";
import { createSignal, Match, Show, Switch } from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card.solid.tsx";
import { Skeleton } from "@/components/ui/skeleton.solid.tsx";
import { cn, formatAgo, useAction } from "@/sdk/solid";
import { CardAction } from "./refs.ts";
import type { PrCard } from "./refs.ts";

/** How long a finger rests on a link before its card opens; a shorter tap still opens the link. */
const LONG_PRESS = 450;

/**
 * Hovering a PR link (or a long press on touch) shows a compact card about the PR: title, state, repo#number,
 * author, branches, size, checks, review and when it was last updated.
 */
export function PrHover(props: {
  repo: string;
  number: number;
  children: JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  let touch = false;
  let pressed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelPress = () => clearTimeout(timer);
  return (
    <HoverCard
      closeDelay={150}
      delay={300}
      open={open()}
      onOpenChange={(next, details) => {
        if (next && touch && !pressed) {
          details.cancel();
          return;
        }
        if (!next) pressed = false;
        setOpen(next);
      }}
    >
      <HoverCardTrigger
        aria-label={`Preview of ${props.repo}#${props.number}`}
        class="[-webkit-touch-callout:none]"
        onContextMenu={(event: MouseEvent) => {
          if (touch) event.preventDefault();
        }}
        onPointerDown={(event: PointerEvent) => {
          touch = event.pointerType !== "mouse";
          if (!touch) return;
          pressed = false;
          cancelPress();
          timer = setTimeout(() => {
            pressed = true;
            window.getSelection()?.removeAllRanges();
            setOpen(true);
          }, LONG_PRESS);
        }}
        onPointerEnter={(event: PointerEvent) => {
          if (event.pointerType === "mouse") touch = false;
        }}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
        onPointerUp={cancelPress}
        ref={(element: HTMLElement) =>
          element.addEventListener(
            "click",
            (event) => {
              if (!pressed) return;
              pressed = false;
              event.preventDefault();
              event.stopPropagation();
            },
            { capture: true },
          )
        }
        render={(trigger) => <span {...trigger} />}
      >
        {props.children}
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        class="w-96 max-w-[calc(100vw-1rem)] p-0"
        collisionPadding={8}
        data-pr-card={`${props.repo}#${props.number}`}
        side="bottom"
      >
        <Show when={open()}>
          <Card number={props.number} repo={props.repo} />
        </Show>
      </HoverCardContent>
    </HoverCard>
  );
}

const stateDot: Record<PrCard["state"], string> = {
  open: "bg-success",
  draft: "bg-muted-foreground/60",
  merged: "bg-violet-500 dark:bg-violet-400",
  closed: "bg-error",
};

function Card(props: { repo: string; number: number }) {
  const card = useAction(CardAction, {
    get repo() {
      return props.repo;
    },
    get number() {
      return props.number;
    },
  });
  return (
    <div class="flex flex-col gap-1 px-3 py-2 text-[12px] leading-[1.4]">
      <Switch>
        <Match when={card.data()}>
          {(pr) => <Details pr={pr()} />}
        </Match>
        <Match when={card.loading()}>
          <Skeleton class="h-[18px] w-11/12" />
          <Skeleton class="h-[15px] w-2/3" />
          <Skeleton class="h-[15px] w-3/4" />
          <Skeleton class="h-[15px] w-1/2" />
        </Match>
        <Match when={card.error()}>
          <div class="text-muted-foreground">
            Couldn't load {props.repo}#{props.number}
          </div>
        </Match>
      </Switch>
    </div>
  );
}

function Details(props: { pr: PrCard }) {
  const meta = "flex min-w-0 items-center gap-1.5 text-muted-foreground";
  return (
    <>
      <div class="flex min-w-0 items-baseline gap-2 text-[13px] font-medium text-foreground">
        <span
          aria-label={props.pr.state}
          class={cn(
            "size-2 shrink-0 translate-y-[-1px] rounded-full",
            stateDot[props.pr.state],
          )}
          role="img"
          title={props.pr.state}
        />
        <span class="line-clamp-2 break-words">{props.pr.title}</span>
      </div>
      <div class={cn(meta, "font-mono text-[11px]")}>
        <span class="truncate">
          {props.pr.repo}#{props.pr.number}
        </span>
        <span aria-hidden="true">·</span>
        <span class="shrink-0">{props.pr.state}</span>
        <time
          class="ml-auto shrink-0"
          datetime={props.pr.updatedAt}
          title={`Updated ${new Date(props.pr.updatedAt).toLocaleString()}`}
        >
          {formatAgo(Date.parse(props.pr.updatedAt), Date.now(), { ago: true })}
        </time>
      </div>
      <div class={cn(meta, "font-mono text-[11px]")}>
        <span class="max-w-[40%] shrink-0 truncate">{props.pr.author}</span>
        <GitBranchIcon aria-hidden="true" class="size-3 shrink-0" />
        <span class="min-w-0 truncate" title={`${props.pr.base} ← ${props.pr.head}`}>
          {props.pr.base} ← {props.pr.head}
        </span>
      </div>
      <div class={cn(meta, "flex-wrap gap-x-2.5 gap-y-0.5 text-[11px]")}>
        <Checks state={props.pr.checks} />
        <Review review={props.pr.review} />
        <span class="ml-auto shrink-0 font-mono">
          <span class="text-success">+{props.pr.additions}</span>{" "}
          <span class="text-error">−{props.pr.deletions}</span>{" "}
          · {props.pr.files} {props.pr.files === 1 ? "file" : "files"}
        </span>
      </div>
    </>
  );
}

function Checks(props: { state: PrCard["checks"] }) {
  const icon = "size-3.5 shrink-0";
  return (
    <span class="flex shrink-0 items-center gap-1">
      <Switch>
        <Match when={props.state === "pass"}>
          <CheckIcon aria-hidden="true" class={cn(icon, "text-success")} />
          passing
        </Match>
        <Match when={props.state === "fail"}>
          <XIcon aria-hidden="true" class={cn(icon, "text-error")} />
          failing
        </Match>
        <Match when={props.state === "pending"}>
          <CircleDotIcon aria-hidden="true" class={cn(icon, "text-warning")} />
          pending
        </Match>
        <Match when={props.state === "none"}>
          <MinusIcon aria-hidden="true" class={cn(icon, "opacity-60")} />
          no checks
        </Match>
      </Switch>
    </span>
  );
}

function Review(props: { review: PrCard["review"] }) {
  const icon = "size-3.5 shrink-0";
  return (
    <Switch>
      <Match when={props.review === "approved"}>
        <span class="flex shrink-0 items-center gap-1">
          <ShieldCheckIcon aria-hidden="true" class={cn(icon, "text-success")} />
          approved
        </span>
      </Match>
      <Match when={props.review === "changes"}>
        <span class="flex shrink-0 items-center gap-1">
          <MessageSquareWarningIcon
            aria-hidden="true"
            class={cn(icon, "text-warning")}
          />
          changes requested
        </span>
      </Match>
      <Match when={props.review === "required"}>
        <span class="shrink-0">review required</span>
      </Match>
    </Switch>
  );
}
