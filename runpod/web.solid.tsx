/** @jsxImportSource @solidjs/web */
import { Server } from '@lucide/solid'
import { createSignal, For, Show } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import { Popover, PopoverContent } from '@/components/ui/popover.solid.tsx'
import { StatusPopoverTrigger } from '@/components/ui/status-trigger.solid.tsx'
import { ROOT, api, defineWebExtension, errorMessage, keepLast, useAction, useNow } from '@/sdk/solid'
import { PodsAction, StopAction, TerminateAction } from './refs.ts'
import type { Pod } from './refs.ts'

const HOUR = 3_600_000
const money = (n: number) => `$${n.toFixed(2)}`

function Row(props: { pod: Pod; done: () => void }) {
  const now = useNow(30_000)
  const [busy, setBusy] = createSignal(false)
  const [confirm, setConfirm] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const running = () => props.pod.status === 'RUNNING'
  const spent = () =>
    running() && props.pod.startedAt ? (props.pod.costPerHr * (now() - props.pod.startedAt)) / HOUR : undefined
  const run = async (ref: typeof StopAction | typeof TerminateAction) => {
    setBusy(true)
    setError(undefined)
    try {
      await api.action(ref, { id: props.pod.id }, { conversationId: ROOT })
      props.done()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }
  const small =
    'rounded-sm border border-border px-1.5 py-0.5 text-[11px] font-normal text-foreground/90 transition-colors hover:bg-accent'
  return (
    <li class="px-2 py-1.5" data-runpod-pod={props.pod.id}>
      <div class="flex items-center gap-2 text-[12px]">
        <span class="min-w-0 truncate text-foreground/90">{props.pod.name}</span>
        <span class="shrink-0 text-[10.5px] text-muted-foreground/70">{props.pod.gpu}</span>
        <span class="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {running()
            ? `${money(props.pod.costPerHr)}/h${spent() === undefined ? '' : ` · ${money(spent()!)}`}`
            : props.pod.status.toLowerCase()}
        </span>
      </div>
      <div class="mt-1 flex items-center gap-1.5">
        <Show when={running()}>
          <Button class={small} disabled={busy()} onClick={() => void run(StopAction)} size={null} variant={null}>
            Stop
          </Button>
        </Show>
        <Show
          when={confirm()}
          fallback={
            <Button class={small} disabled={busy()} onClick={() => setConfirm(true)} size={null} variant={null}>
              Terminate
            </Button>
          }
        >
          <Button
            class={`${small} border-error/60 text-error`}
            disabled={busy()}
            onClick={() => void run(TerminateAction)}
            size={null}
            variant={null}
          >
            Delete pod and its disk
          </Button>
          <Button class={small} onClick={() => setConfirm(false)} size={null} variant={null}>
            Cancel
          </Button>
        </Show>
      </div>
      <Show when={error()}>
        <p class="mt-0.5 text-[11px] leading-snug break-words text-error/85">{error()}</p>
      </Show>
    </li>
  )
}

function Chip() {
  const { data, refetch } = useAction(PodsAction, null, { conversation: ROOT, onError: keepLast, every: 60_000 })
  const done = () => void refetch()
  const running = () => data()?.pods.filter((pod) => pod.status === 'RUNNING') ?? []
  const rate = () => running().reduce((sum, pod) => sum + pod.costPerHr, 0)
  return (
    <Show when={data() && !data()!.setup && (data()!.pods.length || data()!.problem)}>
      <Popover>
        <StatusPopoverTrigger aria-label="Runpod pods" data-runpod={running().length ? 'running' : 'idle'}>
          <Server class="size-3" />
          {data()!.problem ? 'runpod ?' : running().length ? `${running().length} pod · ${money(rate())}/h` : 'no pod running'}
        </StatusPopoverTrigger>
        <PopoverContent align="end" class="w-80 max-w-[calc(100vw-1rem)] p-1" side="top">
          <Show when={data()!.problem}>
            <p class="px-2 py-1.5 text-[11px] text-error/85">{data()!.problem}</p>
          </Show>
          <ul class="flex flex-col font-mono">
            <For each={data()!.pods} keyed={(pod) => pod.id}>
              {(pod) => <Row pod={pod()} done={done} />}
            </For>
          </ul>
        </PopoverContent>
      </Popover>
    </Show>
  )
}

export default defineWebExtension({ slots: { 'statusline.right': [{ component: Chip, order: -1 }] } })
