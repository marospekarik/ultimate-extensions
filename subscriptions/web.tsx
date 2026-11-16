import { KeyRoundIcon, RefreshCwIcon, ZapIcon } from 'lucide-react'
import { useEffect } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn, defineWebExtension, events, useAction, useNow } from '@/sdk'
import { RefreshAction, UsageAction } from './refs.ts'
import type { Credits, Peak, Plan, Today, UsageWindow } from './refs.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR

const percent = (used: number) => `${Math.round(used * 100)}%`
const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const date = (at: number) =>
  new Date(at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }).replaceAll(',', '')

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

/** A window's reset: its time today, or its day first when it is further off, and how long that is. */
function resets(window: UsageWindow, now: number) {
  if (window.resetsAt === undefined) return window.cycle ? `resets ${window.cycle}` : 'no reset time'
  const at = window.resetsAt
  // Past its reset the server shows 0%; say when it reset until a newer reading brings the next window.
  if (at <= now) return `reset ${now - at > DAY ? `${date(at)} ` : ''}${clock(at)} · ${age(at, now)}`
  const day = at - now > DAY ? `${date(at)} ` : ''
  return `resets ${day}${clock(at)} · ${ahead(at, now)}`
}

/** The window that binds: the one used most. */
const binding = (plan: Plan) => plan.windows.reduce<UsageWindow | undefined>((most, window) => (!most || window.used > most.used ? window : most), undefined)

const tone = (used: number) =>
  used > 0.9 ? 'text-error' : used > 0.7 ? 'text-warning' : 'text-muted-foreground'

function Bar({ used, className }: { used: number; className?: string }) {
  return (
    <span className={cn('relative h-1.5 w-8 shrink-0 overflow-hidden rounded-full bg-muted', className)}>
      <span
        className={cn('absolute inset-y-0 left-0 rounded-full', used > 0.9 ? 'bg-error/70' : used > 0.7 ? 'bg-warning/70' : 'bg-current opacity-70')}
        style={{ width: `${Math.min(100, Math.max(0, used * 100))}%` }}
      />
    </span>
  )
}

/** A one-line reading: the windows' percentages, and a bar for the one that binds. */
function Reading({ plan }: { plan: Plan }) {
  const most = binding(plan)
  if (!most)
    return <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">—</span>
  return (
    <>
      <Bar used={most.used} />
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        {plan.windows.map((window) => `${window.label.replace('week', 'wk')} ${percent(window.used)}`).join(' · ')}
      </span>
    </>
  )
}

/** The amber mark Ollama's row carries while usage costs twice as much. The words are in the card. */
function PeakMark({ peak }: { peak: Peak }) {
  if (!peak.on) return null
  return (
    <ZapIcon
      aria-label={`Peak hours until ${peak.until === undefined ? 'later' : clock(peak.until)}: Ollama usage costs twice as much`}
      className="size-3 shrink-0 text-amber-500"
      data-peak
      fill="currentColor"
    />
  )
}

/**
 * Ollama's day in UTC, as the pricing page states it: 12:00–18:00 on weekdays costs twice as much, and weekends are
 * off-peak throughout. The hour now is outlined.
 */
function Strip({ now }: { now: number }) {
  const at = new Date(now)
  const weekday = at.getUTCDay() !== 0 && at.getUTCDay() !== 6
  const hour = at.getUTCHours()
  return (
    <span className="flex w-full gap-px" aria-hidden>
      {Array.from({ length: 24 }, (_, cell) => (
        <span
          className={cn(
            'h-2 flex-1 rounded-[1px]',
            weekday && cell >= 12 && cell < 18 ? 'bg-amber-500/70' : 'bg-muted',
            cell === hour && 'ring-1 ring-foreground/50',
          )}
          key={cell}
        />
      ))}
    </span>
  )
}

function Credits({ credits, now }: { credits: Credits; now: number }) {
  const left = `$${credits.left.toFixed(2)}`
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-14 shrink-0 text-muted-foreground">credits</span>
      <span className="min-w-0 flex-1">
        {credits.total === undefined ? left : `${left} of $${credits.total.toFixed(0)}`}
        {credits.until === undefined ? ' left' : ' left'}
        {credits.until !== undefined && (
          <span className="text-muted-foreground/60"> · resets {date(credits.until)} · {ahead(credits.until, now)}</span>
        )}
      </span>
    </div>
  )
}

/** The last 24 hours: requests, and dollars and tokens where the plan records them. */
function Day({ today }: { today: Today }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-14 shrink-0 text-muted-foreground">24 h</span>
      <span className="min-w-0 flex-1">
        {today.requests.toLocaleString()} requests
        {today.usd !== undefined && ` · $${today.usd.toFixed(2)}`}
        {today.input !== undefined && today.output !== undefined && (
          <span className="text-muted-foreground/60">
            {' '}
            · {tokens(today.input)} in / {tokens(today.output)} out
            {today.cached !== undefined && ` · ${tokens(today.cached)} cached`}
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * One provider's whole story: its windows with resets, what it costs, and what the plan does at a limit. It mounts
 * when its row is opened and asks that provider at once; the stored numbers show until the answer replaces them.
 */
function Card({ plan, peak, now }: { plan: Plan; peak: Peak; now: number }) {
  const usage = useAction(UsageAction, null, { every: 30_000, onError: () => {} })
  const refresh = useAction(RefreshAction, { plan: plan.id }, { enabled: false, onError: () => {} })
  const ask = async () => {
    await refresh.refetch()
    await usage.refetch()
  }
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per opening; the server's 20 s floor guards repeats.
  useEffect(() => void ask(), [])
  return (
    <div className="flex flex-col gap-2.5 font-mono text-[11px]">
      <div className="flex flex-wrap items-baseline gap-x-2 whitespace-nowrap">
        <span className="text-[12px] text-foreground">{plan.name}</span>
        <span className="text-[10px] text-muted-foreground/50">{plan.detail}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/50">
          {plan.at === undefined ? 'not known yet' : `as of ${clock(plan.at)} · ${age(plan.at, now)}`}
        </span>
      </div>
      {plan.windows.map((window) => (
        <div className="flex flex-col gap-0.5" key={window.key}>
          <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-muted-foreground">{window.label}</span>
            <Bar className="w-auto flex-1" used={window.used} />
            <span className={cn('w-8 shrink-0 text-right tabular-nums', tone(window.used))}>
              {percent(window.used)}
            </span>
          </div>
          <div className="pl-14 text-[10px] text-muted-foreground/60">{resets(window, now)}</div>
        </div>
      ))}
      {plan.id === 'claude' && plan.windows.length === 0 && (
        <div className="text-muted-foreground/70">
          No reading yet. Refresh asks Anthropic, and every Claude Code turn brings one.
        </div>
      )}
      {plan.id === 'codex' && plan.setup && (
        <div className="text-muted-foreground/70">
          No ChatGPT login here. Sign in with ChatGPT to see Codex's windows.
        </div>
      )}
      {plan.credits && <Credits credits={plan.credits} now={now} />}
      {plan.today && <Day today={plan.today} />}
      {plan.id === 'ollama' && (
        <div className="flex flex-col gap-1">
          <div className={cn('flex items-center gap-1.5', peak.on ? 'text-amber-500' : 'text-muted-foreground')}>
            {peak.on && <ZapIcon className="size-3" fill="currentColor" />}
            <span>
              {peak.on
                ? `2× cost until ${peak.until === undefined ? 'later' : clock(peak.until)}`
                : peak.from === undefined
                  ? 'off-peak'
                  : `off-peak · 2× from ${clock(peak.from)}`}
            </span>
          </div>
          <Strip now={now} />
          <div className="flex justify-between text-[10px] text-muted-foreground/50">
            <span>00 UTC</span>
            <span>2× 12–18 weekdays · never weekends</span>
          </div>
        </div>
      )}
      {plan.notes.map((note) => (
        <div className="text-[10px] text-muted-foreground/70" key={note}>
          {note}
        </div>
      ))}
      {plan.problem && (
        <div className={cn('text-[10px]', plan.paused ? 'text-muted-foreground/60' : 'text-warning')}>
          {plan.problem}
          {plan.retryAt !== undefined && ` · next try ${clock(plan.retryAt)}`}
        </div>
      )}
      {plan.id === 'ollama' && plan.setup && (
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border/70 px-2 py-1 text-[10px] text-foreground outline-none hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => events.emit('secrets:open', { name: 'OLLAMA_API_KEY' })}
          type="button"
        >
          <KeyRoundIcon className="size-3" />
          Add OLLAMA_API_KEY in Secrets
        </button>
      )}
      <div className="flex items-center justify-between border-t border-border/60 pt-1.5">
        <span className="truncate pr-2 text-[10px] text-muted-foreground/50">
          {plan.windows.length > 1 ? 'account-wide' : ''}
        </span>
        <button
          aria-label="Refresh usage"
          className="flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          disabled={refresh.loading}
          onClick={() => void ask()}
          type="button"
        >
          <RefreshCwIcon className={cn('size-3', refresh.loading && 'animate-spin')} />
          {refresh.loading ? 'asking' : 'refresh'}
        </button>
      </div>
    </div>
  )
}

function Row({ plan, peak, now }: { plan: Plan; peak: Peak; now: number }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="group/row mx-2 flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-md pr-2 pl-2.5 text-left outline-none hover:bg-sidebar-accent/50 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
          data-plan={plan.id}
          type="button"
        >
          <span className="shrink-0 text-[12.5px] text-foreground/85">{plan.name.split(' ')[0]}</span>
          {plan.id === 'ollama' && <PeakMark peak={peak} />}
          <span className="ml-auto flex min-w-0 items-center gap-2">
            {plan.setup ? (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">{plan.setup}</span>
            ) : (
              <Reading plan={plan} />
            )}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3" side="right">
        <Card now={now} peak={peak} plan={plan} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * The Agent sidebar's Plans block: one row per shown subscription, the binding window's bar and every window's
 * percentage, and an amber bolt while Ollama charges twice as much. A row opens its card; the heading's age is the newest
 * reading. With no plan shown there is no block.
 */
function Plans() {
  const { data } = useAction(UsageAction, null, { every: 30_000, onError: () => {} })
  const now = useNow(30_000)
  if (!data?.plans.length) return null
  const newest = Math.max(0, ...data.plans.map((plan) => plan.at ?? 0))
  return (
    <div
      className="mb-1 flex flex-col gap-px border-b border-border/60 pb-1"
      data-sidebar-section="subscriptions"
    >
      <div className="mx-2 flex h-6 items-center gap-1">
        <span className="px-1 section-label">Plans</span>
        <span className="ml-auto pr-1 font-mono text-[10px] text-muted-foreground/40">
          {newest ? age(newest, now) : ''}
        </span>
      </div>
      {data.plans.map((plan) => (
        <Row key={plan.id} now={now} peak={data.peak} plan={plan} />
      ))}
    </div>
  )
}

export default defineWebExtension({
  slots: { 'sidebar.top': [{ component: Plans, order: -10 }] },
})
