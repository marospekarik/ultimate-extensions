/** @jsxImportSource @solidjs/web */
import { KeyRoundIcon, RefreshCwIcon, ZapIcon } from '@lucide/solid'
import type { JSX } from '@solidjs/web'
import { createSignal, For, onSettled, Show } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.solid.tsx'
import {
  api,
  cn,
  definePoint,
  defineWebExtension,
  events,
  provide,
  useAction,
  useNow,
} from '@/sdk/solid'
import { RefreshAction, UsageAction } from './refs.ts'
import type { Credits, Peak, Plan, Today, UsageWindow } from './refs.ts'

/** project-rail's `BarFooter` point, declared by name so this folder imports nothing from that one. */
const BarFooter = definePoint<{ where: 'rail' | 'phone' }, JSX.Element>('project-rail.footer')

const HOUR = 3_600_000
const DAY = 24 * HOUR

const percent = (used: number) => `${Math.round(used * 100)}%`
const tokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : `${n}`
const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const date = (at: number) =>
  new Date(at)
    .toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
    .replaceAll(',', '')

/** How long ago a reading was taken: readings are polled or ride on responses, so their age is part of them. */
function age(at: number, now: number) {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

function ahead(at: number, now: number) {
  const minutes = Math.ceil((at - now) / 60_000)
  if (minutes <= 0) return 'now'
  if (minutes < 60) return `in ${minutes}m`
  if (minutes < 48 * 60) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest ? `in ${hours}h ${rest}m` : `in ${hours}h`
  }
  const days = Math.floor(minutes / (24 * 60))
  const hours = Math.round((minutes - days * 24 * 60) / 60)
  return hours ? `in ${days}d ${hours}h` : `in ${days}d`
}

/**
 * A window's reset: its time today, or its day first when it is further off, and how long that is. Past its reset the
 * server shows 0%, so it says when it reset until a newer reading brings the next window.
 */
function resets(window: UsageWindow, now: number) {
  if (window.resetsAt === undefined)
    return window.cycle ? `resets ${window.cycle}` : 'no reset time'
  const at = window.resetsAt
  if (at <= now)
    return `reset ${now - at > DAY ? `${date(at)} ` : ''}${clock(at)} · ${age(at, now)}`
  const day = at - now > DAY ? `${date(at)} ` : ''
  return `resets ${day}${clock(at)} · ${ahead(at, now)}`
}

/** The window that binds: the one used most. */
const binding = (plan: Plan) =>
  plan.windows.reduce<UsageWindow | undefined>(
    (most, window) => (!most || window.used > most.used ? window : most),
    undefined,
  )

const tone = (used: number) =>
  used > 0.9 ? 'text-error' : used > 0.7 ? 'text-warning' : 'text-muted-foreground'

function Bar(props: { used: number; class?: string }) {
  return (
    <span
      class={cn('relative h-1.5 w-8 shrink-0 overflow-hidden rounded-full bg-muted', props.class)}
    >
      <span
        class={cn(
          'absolute inset-y-0 left-0 rounded-full',
          props.used > 0.9
            ? 'bg-error/70'
            : props.used > 0.7
              ? 'bg-warning/70'
              : 'bg-current opacity-70',
        )}
        style={{ width: `${Math.min(100, Math.max(0, props.used * 100))}%` }}
      />
    </span>
  )
}

/** A one-line reading: the windows' percentages, and a bar for the one that binds. */
function Reading(props: { plan: Plan }) {
  return (
    <Show
      when={binding(props.plan)}
      fallback={<span class="shrink-0 font-mono text-[10px] text-muted-foreground/50">—</span>}
    >
      {(most) => (
        <>
          <Bar used={most().used} />
          <span class="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
            {props.plan.windows
              .map((window) => `${window.label.replace('week', 'wk')} ${percent(window.used)}`)
              .join(' · ')}
          </span>
        </>
      )}
    </Show>
  )
}

/** The amber mark Ollama's row carries while usage costs twice as much. The words are in the card. */
function PeakMark(props: { peak: Peak }) {
  return (
    <Show when={props.peak.on}>
      <ZapIcon
        aria-label={`Peak hours until ${props.peak.until === undefined ? 'later' : clock(props.peak.until)}: Ollama usage costs twice as much`}
        class="size-3 shrink-0 text-amber-500"
        data-peak
        fill="currentColor"
      />
    </Show>
  )
}

/**
 * Ollama's day in UTC, as the pricing page states it: 12:00–18:00 on weekdays costs twice as much, and weekends are
 * off-peak throughout. The hour now is outlined.
 */
function Strip(props: { now: number }) {
  const at = () => new Date(props.now)
  const weekday = () => at().getUTCDay() !== 0 && at().getUTCDay() !== 6
  return (
    <span aria-hidden="true" class="flex w-full gap-px">
      <For each={Array.from({ length: 24 }, (_, cell) => cell)}>
        {(cell) => (
          <span
            class={cn(
              'h-2 flex-1 rounded-[1px]',
              weekday() && cell >= 12 && cell < 18 ? 'bg-amber-500/70' : 'bg-muted',
              cell === at().getUTCHours() && 'ring-1 ring-foreground/50',
            )}
          />
        )}
      </For>
    </span>
  )
}

function CreditsLine(props: { credits: Credits; now: number }) {
  const left = () => `$${props.credits.left.toFixed(2)}`
  return (
    <div class="flex items-baseline gap-2">
      <span class="w-14 shrink-0 text-muted-foreground">credits</span>
      <span class="min-w-0 flex-1">
        {props.credits.total === undefined
          ? left()
          : `${left()} of $${props.credits.total.toFixed(0)}`}{' '}
        left
        <Show when={props.credits.until}>
          {(until) => (
            <span class="text-muted-foreground/60">
              {' '}
              · resets {date(until())} · {ahead(until(), props.now)}
            </span>
          )}
        </Show>
      </span>
    </div>
  )
}

/** The last 24 hours: requests, and dollars and tokens where the plan records them. */
function Day(props: { today: Today }) {
  return (
    <div class="flex items-baseline gap-2">
      <span class="w-14 shrink-0 text-muted-foreground">24 h</span>
      <span class="min-w-0 flex-1">
        {props.today.requests.toLocaleString()} requests
        {props.today.usd !== undefined && ` · $${props.today.usd.toFixed(2)}`}
        <Show when={props.today.input !== undefined && props.today.output !== undefined}>
          <span class="text-muted-foreground/60">
            {' '}
            · {tokens(props.today.input!)} in / {tokens(props.today.output!)} out
            {props.today.cached !== undefined && ` · ${tokens(props.today.cached)} cached`}
          </span>
        </Show>
      </span>
    </div>
  )
}

/**
 * One provider's whole story: its windows with resets, what it costs, and what the plan does at a limit. It mounts
 * when its row is opened and asks that provider at once; the stored numbers show until the answer replaces them.
 */
function Card(props: { plan: Plan; peak: Peak; now: number }) {
  const usage = useAction(UsageAction, null, { every: 30_000, onError: () => {} })
  const [asking, setAsking] = createSignal(false)
  const ask = async (plan: Plan['id']) => {
    setAsking(true)
    await api.action(RefreshAction, { plan }).catch(() => {})
    await usage.refetch()
    setAsking(false)
  }
  onSettled(() => void ask(props.plan.id))
  const plan = () => props.plan
  return (
    <div class="flex flex-col gap-2.5 font-mono text-[11px]">
      <div class="flex flex-wrap items-baseline gap-x-2 whitespace-nowrap">
        <span class="text-[12px] text-foreground">{plan().name}</span>
        <span class="text-[10px] text-muted-foreground/50">{plan().detail}</span>
        <span class="ml-auto text-[10px] text-muted-foreground/50">
          {plan().at === undefined
            ? 'not known yet'
            : `as of ${clock(plan().at!)} · ${age(plan().at!, props.now)}`}
        </span>
      </div>
      <For each={plan().windows} keyed={(window) => window.key}>
        {(window) => (
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-2">
              <span class="w-12 shrink-0 text-muted-foreground">{window().label}</span>
              <Bar class="w-auto flex-1" used={window().used} />
              <span class={cn('w-8 shrink-0 text-right tabular-nums', tone(window().used))}>
                {percent(window().used)}
              </span>
            </div>
            <div class="pl-14 text-[10px] text-muted-foreground/60">
              {resets(window(), props.now)}
            </div>
          </div>
        )}
      </For>
      <Show when={plan().id === 'claude' && plan().windows.length === 0}>
        <div class="text-muted-foreground/70">
          No reading yet. Refresh asks Anthropic, and every Claude Code turn brings one.
        </div>
      </Show>
      <Show when={plan().id === 'codex' && plan().setup}>
        <div class="text-muted-foreground/70">
          No ChatGPT login here. Sign in with ChatGPT to see Codex's windows.
        </div>
      </Show>
      <Show when={plan().credits}>
        {(credits) => <CreditsLine credits={credits()} now={props.now} />}
      </Show>
      <Show when={plan().today}>{(today) => <Day today={today()} />}</Show>
      <Show when={plan().id === 'ollama'}>
        <div class="flex flex-col gap-1">
          <div
            class={cn(
              'flex items-center gap-1.5',
              props.peak.on ? 'text-amber-500' : 'text-muted-foreground',
            )}
          >
            <Show when={props.peak.on}>
              <ZapIcon class="size-3" fill="currentColor" />
            </Show>
            <span>
              {props.peak.on
                ? `2× cost until ${props.peak.until === undefined ? 'later' : clock(props.peak.until)}`
                : props.peak.from === undefined
                  ? 'off-peak'
                  : `off-peak · 2× from ${clock(props.peak.from)}`}
            </span>
          </div>
          <Strip now={props.now} />
          <div class="flex justify-between text-[10px] text-muted-foreground/50">
            <span>00 UTC</span>
            <span>2× 12–18 weekdays · never weekends</span>
          </div>
        </div>
      </Show>
      <For each={plan().notes}>
        {(note) => <div class="text-[10px] text-muted-foreground/70">{note}</div>}
      </For>
      <Show when={plan().problem}>
        <div
          class={cn('text-[10px]', plan().paused ? 'text-muted-foreground/60' : 'text-warning')}
        >
          {plan().problem}
          {plan().retryAt !== undefined && ` · next try ${clock(plan().retryAt!)}`}
        </div>
      </Show>
      <Show when={plan().id === 'ollama' && plan().setup}>
        <Button
          class="h-auto justify-start gap-1.5 rounded-md border border-border/70 px-2 py-1 font-mono text-[10px] font-normal text-foreground hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => events.emit('secrets:open', { name: 'OLLAMA_API_KEY' })}
          size={null}
          variant={null}
        >
          <KeyRoundIcon class="size-3" />
          Add OLLAMA_API_KEY in Secrets
        </Button>
      </Show>
      <div class="flex items-center justify-between border-t border-border/60 pt-1.5">
        <span class="truncate pr-2 text-[10px] text-muted-foreground/50">
          {plan().windows.length > 1 ? 'account-wide' : ''}
        </span>
        <Button
          aria-label={`Refresh ${plan().name} usage`}
          class="h-auto gap-1 rounded-sm px-1 py-0.5 font-mono text-[10px] font-normal text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          disabled={asking()}
          onClick={() => ask(plan().id)}
          size={null}
          variant={null}
        >
          <RefreshCwIcon class={cn('size-3', asking() && 'animate-spin')} />
          {asking() ? 'asking' : 'refresh'}
        </Button>
      </div>
    </div>
  )
}

const reveal =
  'opacity-0 transition-opacity duration-100 group-hover/rail:opacity-100 group-hover/rail:delay-[350ms] group-has-[:focus-visible]/rail:opacity-100 group-has-[:focus-visible]/rail:delay-[350ms]'
const fadeOut =
  'transition-opacity duration-100 group-hover/rail:opacity-0 group-hover/rail:delay-200 group-has-[:focus-visible]/rail:opacity-0 group-has-[:focus-visible]/rail:delay-200'

function Full(props: { plan: Plan; peak: Peak }) {
  return (
    <>
      <span class="shrink-0 text-[12px] whitespace-nowrap text-foreground/85">
        {props.plan.name.split(' ')[0]}
      </span>
      <Show when={props.plan.id === 'ollama'}>
        <PeakMark peak={props.peak} />
      </Show>
      <span class="ml-auto flex items-center gap-2 whitespace-nowrap">
        <Show when={props.plan.setup} fallback={<Reading plan={props.plan} />}>
          <span class="font-mono text-[10px] text-muted-foreground/50">{props.plan.setup}</span>
        </Show>
      </span>
    </>
  )
}

/**
 * The rail's row keeps one fixed height. The compact look (a plan's initial over a thin bar) fades out as the rail starts
 * to widen; the full row is laid out at its expanded width all along, so nothing wraps, and fades in once the width
 * transition and its hover delay are done. Collapsing fades the full row out at once.
 */
function RailRow(props: { plan: Plan; peak: Peak; now: number }) {
  const [open, setOpen] = createSignal(false)
  const most = () => binding(props.plan)
  return (
    <Popover onOpenChange={setOpen} open={open()}>
      <PopoverTrigger
        aria-label={`${props.plan.name} usage`}
        class="relative h-9 w-full shrink-0 overflow-hidden rounded-md text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
        data-plan={props.plan.id}
      >
        <span
          class={cn(
            'absolute inset-y-0 left-0 flex w-8 flex-col items-center justify-center gap-1',
            fadeOut,
          )}
        >
          <span class="font-mono text-[11px] text-muted-foreground">
            {props.plan.name.slice(0, 2)}
          </span>
          <Bar class={cn('w-6', most() && tone(most()!.used))} used={most()?.used ?? 0} />
        </span>
        <span class={cn('absolute inset-y-0 left-0 flex w-60 items-center gap-2 px-2', reveal)}>
          <Full peak={props.peak} plan={props.plan} />
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" class="w-80 max-w-[calc(100vw-1rem)] p-3" side="right">
        <Show when={open()}>
          <Card now={props.now} peak={props.peak} plan={props.plan} />
        </Show>
      </PopoverContent>
    </Popover>
  )
}

function PhoneRow(props: { plan: Plan; peak: Peak; now: number }) {
  const [open, setOpen] = createSignal(false)
  return (
    <Popover onOpenChange={setOpen} open={open()}>
      <PopoverTrigger
        aria-label={`${props.plan.name} usage`}
        class="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left outline-none hover:bg-accent/50"
        data-plan={props.plan.id}
      >
        <Full peak={props.peak} plan={props.plan} />
      </PopoverTrigger>
      <PopoverContent align="start" class="w-80 max-w-[calc(100vw-1rem)] p-3" side="top">
        <Show when={open()}>
          <Card now={props.now} peak={props.peak} plan={props.plan} />
        </Show>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The Plans block pinned at the bottom of the project bar: one row per shown subscription with the binding window's bar and
 * every window's percentage, and an amber bolt while Ollama charges twice as much. The collapsed rail shows each plan as
 * its initial over a thin bar; hovering the rail opens the full rows. A row opens its card. With no plan shown there is no
 * block.
 */
function Plans(props: { where: 'rail' | 'phone' }) {
  const { data } = useAction(UsageAction, null, { every: 30_000, onError: () => {} })
  const now = useNow(30_000)
  return (
    <Show when={data()?.plans.length ? data() : undefined}>
      {(usage) => (
        <div
          class="mt-1 flex flex-col gap-px border-t border-border/60 pt-1"
          data-subscriptions={props.where}
        >
          <For each={usage().plans} keyed={(plan) => plan.id}>
            {(plan) => (
              <Show
                when={props.where === 'rail'}
                fallback={<PhoneRow now={now()} peak={usage().peak} plan={plan()} />}
              >
                <RailRow now={now()} peak={usage().peak} plan={plan()} />
              </Show>
            )}
          </For>
        </div>
      )}
    </Show>
  )
}

export default defineWebExtension({
  provides: [provide(BarFooter, Plans)],
})
