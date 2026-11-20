import { PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { MessageResponse } from "@/components/ai/message";
import { cn } from "@/sdk";
import { continueList, joinSource, kindOf, parseSource, spans } from "./blocks.ts";
import type { Block, Kind, Source } from "./blocks.ts";

const kindClass: Record<Kind, string> = {
  h1: "text-[17px] leading-snug font-semibold tracking-tight",
  h2: "text-[15.5px] leading-snug font-semibold tracking-tight",
  h3: "text-[14px] leading-snug font-semibold",
  quote: "border-border text-muted-foreground border-l-2 pl-3 text-[14px] leading-relaxed",
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

function Mirror({ text, kind }: { text: string; kind: Kind }) {
  return (
    <div
      aria-hidden
      className={cn(
        "col-start-1 row-start-1 min-w-0 break-words whitespace-pre-wrap",
        kindClass[kind],
      )}
    >
      {kind === "code"
        ? text
        : text.split("\n").map((line, index) => (
            <span key={index}>
              {index > 0 && "\n"}
              {spans(line).map((part, at) => (
                <span className={part.style && spanClass[part.style]} key={at}>
                  {part.text}
                </span>
              ))}
            </span>
          ))}
      {"\n"}
    </div>
  );
}

function BlockEditor({
  block,
  caret,
  onChange,
  onKey,
  onBlur,
}: {
  block: Block;
  caret: Caret;
  onChange: (text: string) => void;
  onKey: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const kind = kindOf(block.text);
  useEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.focus({ preventScroll: true });
    const at = caret === "start" ? 0 : area.value.length;
    area.setSelectionRange(at, at);
    area.scrollIntoView({ block: "nearest" });
  }, [caret]);
  return (
    <div className="bg-muted/30 ring-brand/40 -mx-2 grid rounded-md px-2 py-1 ring-1">
      <Mirror kind={kind} text={block.text} />
      <textarea
        aria-label="Edit block"
        autoCapitalize="sentences"
        className={cn(
          "caret-foreground col-start-1 row-start-1 block h-full w-full resize-none overflow-hidden bg-transparent break-words whitespace-pre-wrap text-transparent outline-none",
          kindClass[kind],
        )}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKey}
        ref={ref}
        rows={1}
        spellCheck
        value={block.text}
      />
    </div>
  );
}

export function Editor({
  text,
  onText,
  onSave,
}: {
  text: string;
  onText: (text: string) => void;
  onSave: () => void;
}) {
  const [source, setSource] = useState<Source>(() => parseSource(text));
  const [active, setActive] = useState<{ index: number; caret: Caret } | null>(
    null,
  );
  const update = (next: Source) => {
    setSource(next);
    onText(joinSource(next));
  };
  const setBlocks = (blocks: Block[]) => update({ ...source, blocks });
  const open = (index: number, caret: Caret = "end") =>
    setActive({ index, caret });
  const edit = (index: number, value: string) =>
    setBlocks(
      source.blocks.map((block, at) =>
        at === index ? { ...block, text: value } : block,
      ),
    );
  const insertAfter = (index: number, first: string, second: string) => {
    const blocks = [...source.blocks];
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
    const blocks = source.blocks.filter((_, at) => at !== index);
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
    requestAnimationFrame(() => area.setSelectionRange(a + mark.length, b + mark.length));
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>, index: number) => {
    const area = event.currentTarget;
    const { selectionStart: start, selectionEnd: end, value } = area;
    const collapsed = start === end;
    const meta = event.metaKey || event.ctrlKey;
    if (event.nativeEvent.isComposing) return;
    if (meta && event.key === "Enter") {
      event.preventDefault();
      onSave();
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
        insertAfter(index, value.slice(0, list.lineStart).replace(/\s+$/, ""), value.slice(end));
      } else if (list) {
        edit(index, `${value.slice(0, start)}\n${list.next}${value.slice(end)}`);
      } else {
        insertAfter(index, value.slice(0, start).replace(/\s+$/, ""), value.slice(end));
      }
    } else if (event.key === "Backspace" && value === "") {
      event.preventDefault();
      remove(index);
    } else if (event.key === "ArrowUp" && collapsed && start === 0 && index > 0) {
      event.preventDefault();
      open(index - 1);
    } else if (
      event.key === "ArrowDown" &&
      collapsed &&
      end === value.length &&
      index < source.blocks.length - 1
    ) {
      event.preventDefault();
      open(index + 1, "start");
    }
  };
  const leave = (index: number) => {
    setActive((current) => (current?.index === index ? null : current));
    if (source.blocks[index]?.text.trim() === "" && source.blocks.length > 1) {
      setSource((previous) => {
        const blocks = previous.blocks.filter((_, at) => at !== index);
        const next = { ...previous, blocks };
        onText(joinSource(next));
        return next;
      });
    }
  };
  const append = () => {
    const blocks = [...source.blocks];
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
    <div className="space-y-1">
      {source.blocks.map((block, index) =>
        active?.index === index ? (
          <BlockEditor
            block={block}
            caret={active.caret}
            key={index}
            onBlur={() => leave(index)}
            onChange={(value) => edit(index, value)}
            onKey={(event) => onKey(event, index)}
          />
        ) : (
          <div
            className="hover:bg-muted/30 -mx-2 cursor-text rounded-md px-2 py-0.5"
            key={index}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) return;
              open(index);
            }}
          >
            <MessageResponse className="text-[14px] leading-relaxed">
              {block.text}
            </MessageResponse>
          </div>
        ),
      )}
      <button
        className="text-muted-foreground hover:text-foreground flex h-8 items-center gap-1.5 font-mono text-[11.5px] pointer-coarse:h-11"
        onClick={append}
        type="button"
      >
        <PlusIcon className="size-3.5" />
        Add text
      </button>
    </div>
  );
}
