/** @jsxImportSource @solidjs/web */
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  XIcon,
} from "@lucide/solid";
import { createSignal, Show } from "solid-js";
import { Button } from "@/components/ui/button.solid.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog.solid.tsx";

export type Shown = { path: string; alt: string; url: string };

const MAX_SCALE = 6;
const SWIPE_PX = 60;
const TAP_PX = 8;

type View = { scale: number; x: number; y: number };

const nameOf = (path: string) => path.split("/").pop() ?? path;

export function Lightbox(props: {
  images: Shown[];
  index: number | null;
  onIndex: (index: number | null) => void;
}) {
  const [view, setView] = createSignal<View>({ scale: 1, x: 0, y: 0 });
  const current = () =>
    props.index === null ? undefined : props.images[props.index];
  const several = () => props.images.length > 1;
  const reset = () => setView({ scale: 1, x: 0, y: 0 });
  const step = (by: number) => {
    if (props.index === null || !several()) return;
    reset();
    props.onIndex(
      (props.index + by + props.images.length) % props.images.length,
    );
  };
  const zoomAt = (
    from: View,
    scale: number,
    clientX: number,
    clientY: number,
    box: DOMRect,
  ) => {
    const next = Math.min(MAX_SCALE, Math.max(1, scale));
    if (next === 1) return setView({ scale: 1, x: 0, y: 0 });
    const cx = clientX - box.left - box.width / 2;
    const cy = clientY - box.top - box.height / 2;
    const ratio = next / from.scale;
    setView({
      scale: next,
      x: cx - (cx - from.x) * ratio,
      y: cy - (cy - from.y) * ratio,
    });
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let gesture:
    | {
        start: { x: number; y: number };
        view: View;
        distance?: number;
        moved: boolean;
      }
    | undefined;
  const distance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType === "mouse")
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture = {
      start: { x: event.clientX, y: event.clientY },
      view: view(),
      distance: pointers.size === 2 ? distance() : undefined,
      moved: pointers.size > 1 || (gesture?.moved ?? false),
    };
  };
  const move = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (pointers.size === 2 && gesture.distance) {
      gesture.moved = true;
      const [a, b] = [...pointers.values()];
      zoomAt(
        gesture.view,
        (gesture.view.scale * distance()) / gesture.distance,
        (a.x + b.x) / 2,
        (a.y + b.y) / 2,
        box,
      );
      return;
    }
    const dx = event.clientX - gesture.start.x;
    const dy = event.clientY - gesture.start.y;
    if (Math.hypot(dx, dy) > TAP_PX) gesture.moved = true;
    if (gesture.view.scale > 1)
      setView({
        ...gesture.view,
        x: gesture.view.x + dx,
        y: gesture.view.y + dy,
      });
  };
  const up = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId) || !gesture) return;
    const start = gesture;
    if (pointers.size > 0) {
      const [rest] = [...pointers.values()];
      gesture = { start: rest, view: view(), moved: true };
      return;
    }
    gesture = undefined;
    const dx = event.clientX - start.start.x;
    const dy = event.clientY - start.start.y;
    if (!start.moved) {
      const image = (event.target as Element).closest("img");
      if (!image) return props.onIndex(null);
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      if (view().scale > 1) reset();
      else zoomAt(view(), 2.5, event.clientX, event.clientY, box);
      return;
    }
    if (
      start.view.scale === 1 &&
      Math.abs(dx) > SWIPE_PX &&
      Math.abs(dx) > Math.abs(dy) * 1.5
    )
      step(dx < 0 ? 1 : -1);
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    zoomAt(
      view(),
      view().scale * Math.exp(-event.deltaY / 300),
      event.clientX,
      event.clientY,
      (event.currentTarget as HTMLElement).getBoundingClientRect(),
    );
  };

  return (
    <Dialog
      open={props.index !== null}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          props.onIndex(null);
        }
      }}
    >
      <DialogContent
        backdropClass="bg-black/90 backdrop-blur-sm"
        class="inset-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-transparent p-0 text-white shadow-none sm:max-w-none"
        data-docs-lightbox=""
        initialFocus="content"
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === "ArrowRight") step(1);
          else if (event.key === "ArrowLeft") step(-1);
          else return;
          event.preventDefault();
        }}
        showCloseButton={false}
      >
        <Show when={current()}>
          {(image) => (
            <>
              <div class="flex min-w-0 items-center gap-2 bg-black/60 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
                <div class="min-w-0 flex-1">
                  <DialogTitle class="truncate text-[13px] font-medium">
                    {image().alt || nameOf(image().path)}
                  </DialogTitle>
                  <DialogDescription class="truncate font-mono text-[11px] text-white/60">
                    {several()
                      ? `${(props.index ?? 0) + 1} / ${props.images.length} · `
                      : ""}
                    {image().path}
                  </DialogDescription>
                </div>
                <Button
                  aria-label="Open original"
                  class="text-white hover:bg-white/15 hover:text-white pointer-coarse:h-11"
                  render={(link) => (
                    <a
                      {...link}
                      href={image().url}
                      rel="noreferrer"
                      target="_blank"
                    />
                  )}
                  size="sm"
                  variant="ghost"
                >
                  <ExternalLinkIcon />
                  <span class="max-sm:hidden">Open original</span>
                </Button>
                <Button
                  aria-label="Close image"
                  class="text-white hover:bg-white/15 hover:text-white pointer-coarse:size-11"
                  onClick={() => props.onIndex(null)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <XIcon />
                </Button>
              </div>
              <div
                class="relative min-h-0 flex-1 touch-none overflow-hidden select-none"
                onPointerCancel={up}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onWheel={wheel}
              >
                <img
                  alt={image().alt || nameOf(image().path)}
                  class="absolute inset-0 m-auto max-h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] object-contain"
                  draggable={false}
                  src={image().url}
                  style={{
                    transform: `translate(${view().x}px, ${view().y}px) scale(${view().scale})`,
                    cursor: view().scale > 1 ? "zoom-out" : "zoom-in",
                  }}
                />
              </div>
              <Show when={several()}>
                <Button
                  aria-label="Previous image"
                  class="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white max-sm:hidden"
                  onClick={() => step(-1)}
                  size="icon"
                  variant="ghost"
                >
                  <ChevronLeftIcon />
                </Button>
                <Button
                  aria-label="Next image"
                  class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white max-sm:hidden"
                  onClick={() => step(1)}
                  size="icon"
                  variant="ghost"
                >
                  <ChevronRightIcon />
                </Button>
              </Show>
            </>
          )}
        </Show>
      </DialogContent>
    </Dialog>
  );
}
