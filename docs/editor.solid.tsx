/** @jsxImportSource @solidjs/web */
import { PlusIcon } from "@lucide/solid";
import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import { Button } from "@/components/ui/button.solid.tsx";
import { Textarea } from "@/components/ui/input.solid.tsx";
import { Markdown } from "@/components/markdown/markdown.solid.tsx";
import { cn } from "@/sdk/solid";
import {
  continueList,
  joinSource,
  kindOf,
  parseSource,
  spans,
} from "./blocks.ts";
import type { Block, Kind, Source } from "./blocks.ts";

const kindClass: Record<Kind, string> = {
  h1: "text-[17px] leading-snug font-semibold tracking-tight",
  h2: "text-[15.5px] leading-snug font-semibold tracking-tight",
  h3: "text-[14px] leading-snug font-semibold",
  quote:
    "border-border text-muted-foreground border-l-2 pl-3 text-[14px] leading-relaxed",
  code: "font-mono text-[12px] leading-[1.6]",
  text: "text-[14px] leading-relaxed",
};

const spanClass = {
  mark: "text-muted-foreground/60",
  bold: "text-foreground font-bold",
  italic: "text-foreground/90 italic",
  code: "bg-muted rounded-sm",
} as const;

type Caret = "start" | "end";

function Mirror(props: { text: string; kind: Kind }) {
  return (
    <div
      aria-hidden="true"
      class={cn(
        "col-start-1 row-start-1 min-w-0 break-words whitespace-pre-wrap",
        kindClass[props.kind],
      )}
    >
      <Show
        when={props.kind !== "code"}
        fallback={props.text}
      >
        <For each={props.text.split("\n")} keyed={false}>
          {(line, index) => (
            <span>
              {index > 0 && "\n"}
              <For each={spans(line())} keyed={false}>
                {(part) => (
                  <span class={part().style && spanClass[part().style!]}>
                    {part().text}
                  </span>
                )}
              </For>
            </span>
          )}
        </For>
      </Show>
      {"\n"}
    </div>
  );
}

function BlockEditor(props: {
  block: Block;
  caret: Caret;
  onChange: (text: string) => void;
  onKey: (event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => void;
  onBlur: () => void;
}) {
  let area: HTMLTextAreaElement | undefined;
  const kind = () => kindOf(props.block.text);
  createEffect(
    () => props.caret,
    (caret) => {
      if (!area) return;
      area.focus({ preventScroll: true });
      const at = caret === "start" ? 0 : area.value.length;
      area.setSelectionRange(at, at);
      area.scrollIntoView({ block: "nearest" });
    },
  );
  return (
    <div class="bg-muted/30 ring-brand/40 -mx-2 grid rounded-md px-2 py-1 ring-1">
      <Mirror kind={kind()} text={props.block.text} />
      <Textarea
        aria-label="Edit block"
        autocapitalize="sentences"
        class={cn(
          "caret-foreground col-start-1 row-start-1 block h-full min-h-0 w-full resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 break-words whitespace-pre-wrap text-transparent outline-none focus-visible:ring-0",
          kindClass[kind()],
        )}
        onBlur={props.onBlur}
        onKeyDown={(event) => props.onKey(event)}
        onValueChange={props.onChange}
        ref={area}
        rows={1}
        spellcheck
        value={props.block.text}
      />
    </div>
  );
}

export function Editor(props: {
  text: string;
  onText: (text: string) => void;
  onSave: () => void;
}) {
  const [source, setSource] = createSignal<Source>(parseSource(untrack(() => props.text)));
  const [active, setActive] = createSignal<{
    index: number;
    caret: Caret;
  } | null>(null);
  const update = (next: Source) => {
    setSource(next);
    props.onText(joinSource(next));
  };
  const setBlocks = (blocks: Block[]) => update({ ...source(), blocks });
  const open = (index: number, caret: Caret = "end") =>
    setActive({ index, caret });
  const edit = (index: number, value: string) =>
    setBlocks(
      source().blocks.map((block, at) =>
        at === index ? { ...block, text: value } : block,
      ),
    );
  const insertAfter = (index: number, first: string, second: string) => {
    const blocks = [...source().blocks];
    const gap = blocks[index].gap;
    blocks.splice(
      index,
      1,
      { text: first, gap: "\n\n" },
      { text: second, gap: gap || "\n" },
    );
    setBlocks(blocks);
    open(index + 1, "start");
  };
  const remove = (index: number) => {
    const blocks = source().blocks.filter((_, at) => at !== index);
    setBlocks(blocks);
    if (index > 0) open(index - 1);
    else setActive(null);
  };
  const wrap = (area: HTMLTextAreaElement, index: number, mark: string) => {
    const { selectionStart: a, selectionEnd: b, value } = area;
    edit(
      index,
      `${value.slice(0, a)}${mark}${value.slice(a, b)}${mark}${value.slice(b)}`,
    );
    requestAnimationFrame(() =>
      area.setSelectionRange(a + mark.length, b + mark.length),
    );
  };
  const onKey = (
    event: KeyboardEvent & { currentTarget: HTMLTextAreaElement },
    index: number,
  ) => {
    const area = event.currentTarget;
    const { selectionStart: start, selectionEnd: end, value } = area;
    const collapsed = start === end;
    const meta = event.metaKey || event.ctrlKey;
    if (event.isComposing) return;
    if (meta && event.key === "Enter") {
      event.preventDefault();
      props.onSave();
    } else if (meta && event.key.toLowerCase() === "b") {
      event.preventDefault();
      wrap(area, index, "**");
    } else if (meta && event.key.toLowerCase() === "i") {
      event.preventDefault();
      wrap(area, index, "*");
    } else if (event.key === "Escape") {
      area.blur();
    } else if (event.key === "Enter" && !event.shiftKey && collapsed) {
      if (kindOf(value) === "code") return;
      event.preventDefault();
      const list = continueList(value.slice(0, start));
      if (list && list.empty) {
        insertAfter(
          index,
          value.slice(0, list.lineStart).replace(/\s+$/, ""),
          value.slice(end),
        );
      } else if (list) {
        edit(
          index,
          `${value.slice(0, start)}\n${list.next}${value.slice(end)}`,
        );
      } else {
        insertAfter(
          index,
          value.slice(0, start).replace(/\s+$/, ""),
          value.slice(end),
        );
      }
    } else if (event.key === "Backspace" && value === "") {
      event.preventDefault();
      remove(index);
    } else if (
      event.key === "ArrowUp" &&
      collapsed &&
      start === 0 &&
      index > 0
    ) {
      event.preventDefault();
      open(index - 1);
    } else if (
      event.key === "ArrowDown" &&
      collapsed &&
      end === value.length &&
      index < source().blocks.length - 1
    ) {
      event.preventDefault();
      open(index + 1, "start");
    }
  };
  const leave = (index: number) => {
    setActive((current) => (current?.index === index ? null : current));
    if (
      source().blocks[index]?.text.trim() === "" &&
      source().blocks.length > 1
    )
      update({
        ...source(),
        blocks: source().blocks.filter((_, at) => at !== index),
      });
  };
  const append = () => {
    const blocks = [...source().blocks];
    if (blocks.length > 0)
      blocks[blocks.length - 1] = {
        ...blocks[blocks.length - 1],
        gap: "\n\n",
      };
    blocks.push({ text: "", gap: "\n" });
    setBlocks(blocks);
    open(blocks.length - 1);
  };
  return (
    <div class="space-y-1">
      <For each={source().blocks} keyed={false}>
        {(block, index) => (
          <Show
            when={active()?.index === index && active()}
            fallback={
              <div
                class="hover:bg-muted/30 -mx-2 cursor-text rounded-md px-2 py-0.5"
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("a")) return;
                  open(index);
                }}
              >
                <Markdown
                  class="text-[14px] leading-relaxed"
                  text={block().text}
                />
              </div>
            }
          >
            {(current) => (
              <BlockEditor
                block={block()}
                caret={current().caret}
                onBlur={() => leave(index)}
                onChange={(value) => edit(index, value)}
                onKey={(event) => onKey(event, index)}
              />
            )}
          </Show>
        )}
      </For>
      <Button
        class="text-muted-foreground hover:text-foreground h-8 gap-1.5 font-mono text-[11.5px] font-normal pointer-coarse:h-11"
        onClick={append}
        size={null}
        variant={null}
      >
        <PlusIcon class="size-3.5" />
        Add text
      </Button>
    </div>
  );
}
