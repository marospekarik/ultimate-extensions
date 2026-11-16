import { ArrowUpRightIcon, FlameIcon, FoldersIcon, HouseIcon } from 'lucide-react'
import { useEffect } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn, defineWebExtension, useAction, useNow, useViewport } from '@/sdk'
import { ProjectsAction } from './refs.ts'
import type { RailProject, RailWarm } from './refs.ts'

const local = /^(localhost|127\.0\.0\.1|\[::1\])$/

/**
 * A project on another machine opens in a new tab: its host has no rail, and Ultimate refuses to be framed by another
 * site (`admit` answers 403 to an iframe load), so this tab keeps the rail.
 */
const newTab = (project: RailProject) =>
  project.remote ? { target: '_blank', rel: 'noopener noreferrer' } : {}

/** Claude's long prompt cache lives an hour from @ultimate's last request (keep-warm's `TTL`). */
const TTL = 60 * 60_000

/** Where a tile leads: the tailnet port when this page was opened over the tailnet, else the loopback URL. */
function href(project: RailProject) {
  if (project.remote) return project.url
  if (project.current) return '/'
  if (!local.test(location.hostname) && project.tailnetPort)
    return `https://${location.hostname}:${project.tailnetPort}/`
  return project.url
}

function useProjects() {
  const { data, refetch } = useAction(ProjectsAction, null, { onError: () => {} })
  useEffect(() => {
    // oxlint-disable-next-line typescript/no-floating-promises -- useAction reports failures and resolves undefined rather than rejecting.
    const timer = setInterval(() => void refetch(), 15_000)
    return () => clearInterval(timer)
  }, [refetch])
  return data ?? []
}

/** Tiles by machine, this machine (the current project's) first. */
function byMachine(projects: RailProject[]) {
  const groups = new Map<string, RailProject[]>()
  for (const project of projects) groups.set(project.machine, [...(groups.get(project.machine) ?? []), project])
  return [...groups]
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

type Heat = 'warm' | 'cold' | 'off' | 'failed'

/** Keep-warm at a glance, as its own `warm` chip shows it: amber while warm, dimmed while off, red after a failed ping. */
function heat(warm: RailWarm, now: number): Heat {
  if (warm.error !== undefined) return 'failed'
  if (!warm.on) return 'off'
  return warm.lastRequest !== undefined && warm.lastRequest + TTL > now ? 'warm' : 'cold'
}

function warmLine(warm: RailWarm, now: number) {
  const state = heat(warm, now)
  if (state === 'failed') return `Ping failed: ${warm.error}`
  if (state === 'off') return 'Keep warm off'
  if (state === 'warm') return `Warm until ${clock(warm.lastRequest! + TTL)}`
  return warm.lastRequest === undefined
    ? 'On · cold'
    : `On · cold since ${clock(warm.lastRequest + TTL)}`
}

const heatColor: Record<Heat, string> = {
  warm: 'text-amber-500',
  cold: 'text-muted-foreground',
  off: 'text-muted-foreground/30',
  failed: 'text-red-500',
}

/** The flame in a tile's bottom-right corner; the question badge keeps the top-right one. */
function Flame({ warm, now, className }: { warm?: RailWarm; now: number; className?: string }) {
  if (!warm) return null
  const state = heat(warm, now)
  return (
    <FlameIcon
      aria-label={warmLine(warm, now)}
      className={cn('size-2.5', heatColor[state], className)}
      data-keep-warm={state}
      fill={state === 'warm' || state === 'failed' ? 'currentColor' : 'none'}
    />
  )
}

/** A thin arc turning slowly while agents work; reduced motion gets a still dot. Renders nothing when idle. */
function Spinner({ busy, paused, className }: { busy?: number; paused?: boolean; className?: string }) {
  if (paused)
    return (
      <span aria-label="paused" className={cn('flex size-2.5 items-center justify-center', className)} data-paused>
        <span className="h-2 w-[1.5px] rounded-full bg-muted-foreground/70" />
        <span className="ml-[2px] h-2 w-[1.5px] rounded-full bg-muted-foreground/70" />
      </span>
    )
  if (!busy) return null
  const label = busy === 1 ? 'working · 1 agent' : `working · ${busy} agents`
  return (
    <span aria-label={label} className={cn('flex size-2.5 items-center justify-center', className)} data-working={busy}>
      <svg
        className="size-2.5 animate-spin text-muted-foreground [animation-duration:1.5s] motion-reduce:hidden"
        fill="none"
        viewBox="0 0 10 10"
      >
        <path d="M5 1a4 4 0 0 1 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
      </svg>
      <span className="hidden size-1 rounded-full bg-muted-foreground motion-reduce:block" />
    </span>
  )
}

function Badge({ count, className }: { count?: number; className?: string }) {
  if (!count) return null
  return (
    <span
      className={cn(
        'absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-1 font-mono text-[9px] leading-none font-semibold text-background',
        className,
      )}
    >
      {count}
    </span>
  )
}

/** A row: the 32px tile the collapsed rail shows, then the name and keep-warm line the hover reveals. */
function Row({ project, now }: { project: RailProject; now: number }) {
  return (
    <a
      aria-current={project.current ? 'page' : undefined}
      className={cn(
        'flex w-full shrink-0 items-center gap-2.5 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
        project.current
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
      href={href(project)}
      title={project.warm?.error ?? (project.remote ? `Opens in a new tab (on ${project.remote})` : undefined)}
      {...newTab(project)}
    >
      <span className="relative flex size-8 shrink-0 items-center justify-center font-mono text-[12px]">
        {project.abbr}
        <Badge count={project.waiting} />
        {project.busy || project.paused ? (
          <span className="absolute -bottom-0.5 -left-0.5 flex size-3.5 items-center justify-center rounded-full bg-sidebar">
            <Spinner busy={project.busy} paused={project.paused} />
          </span>
        ) : null}
        {project.warm && (
          <span className="absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-sidebar">
            <Flame now={now} warm={project.warm} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 pr-2 whitespace-nowrap">
        <span className="flex items-center gap-1 text-[12px] text-foreground">
          <span className="truncate">{project.name}</span>
          {project.remote && <ArrowUpRightIcon className="size-3 shrink-0 text-muted-foreground" />}
          {project.waiting ? (
            <span className="ml-auto shrink-0 font-mono text-[10px] text-warning">
              {project.waiting} waiting
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            'block truncate font-mono text-[10px]',
            project.warm && heat(project.warm, now) === 'failed'
              ? 'text-red-500'
              : 'text-muted-foreground',
          )}
        >
          {project.paused ? 'paused · ' : project.busy ? `working · ${project.busy === 1 ? '1 agent' : `${project.busy} agents`} · ` : ''}
          {project.warm ? warmLine(project.warm, now) : 'Keep warm unknown'}
        </span>
      </span>
    </a>
  )
}

/** A machine's heading: a short rule in the collapsed rail, its name once the rail opens. */
function Machine({ name, first }: { name: string; first: boolean }) {
  return (
    <div className="relative mt-1.5 flex h-4 w-full shrink-0 items-center">
      <span
        className={cn(
          'mx-auto h-px w-5 bg-border transition-opacity group-hover/rail:opacity-0 group-has-[:focus-visible]/rail:opacity-0',
          first && 'invisible',
        )}
      />
      <span className="absolute inset-x-1 truncate font-mono text-[9px] tracking-wider text-muted-foreground/70 uppercase opacity-0 transition-opacity select-none group-hover/rail:opacity-100 group-has-[:focus-visible]/rail:opacity-100">
        {name}
      </span>
    </div>
  )
}

/**
 * The rail keeps its 44px column in the layout; on hover (or keyboard focus) its panel widens over the app to show
 * names, machines and keep-warm, and narrows again when the pointer leaves.
 */
function Rail() {
  const projects = useProjects()
  const viewport = useViewport()
  const now = useNow(60_000)
  if (viewport === 'phone') return null
  const groups = byMachine(projects)
  return (
    <nav aria-label="Projects" className="relative w-11 shrink-0">
      <div className="group/rail absolute inset-y-0 left-0 z-40 flex w-11 flex-col gap-1 overflow-x-hidden overflow-y-auto border-r border-border/70 bg-sidebar px-1.5 py-2 transition-[width,box-shadow] duration-150 ease-out hover:w-64 hover:shadow-xl hover:delay-200 has-[:focus-visible]:w-64 has-[:focus-visible]:shadow-xl">
        <a
          aria-label="Home"
          className="flex w-full shrink-0 items-center gap-2.5 rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          href="/"
        >
          <span className="flex size-8 shrink-0 items-center justify-center">
            <HouseIcon className="size-4" />
          </span>
          <span className="text-[12px] whitespace-nowrap">Home</span>
        </a>
        {groups.map(([machine, list], i) => (
          <div className="contents" key={machine}>
            <Machine first={i === 0} name={machine} />
            {list.map((project) => (
              <Row key={project.url} now={now} project={project} />
            ))}
          </div>
        ))}
      </div>
    </nav>
  )
}

/** Phones have no room for a rail: the same list sits behind a title-bar button. */
function PhoneProjects() {
  const projects = useProjects()
  const viewport = useViewport()
  const now = useNow(60_000)
  if (viewport !== 'phone' || projects.length < 2) return null
  const waiting = projects.reduce(
    (sum, project) => sum + (project.current ? 0 : (project.waiting ?? 0)),
    0,
  )
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Projects"
          className="relative flex size-8 items-center justify-center rounded-md text-muted-foreground"
          type="button"
        >
          <FoldersIcon className="size-4" />
          <Badge count={waiting} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        {byMachine(projects).map(([machine, list]) => (
          <div key={machine}>
            <div className="px-2 pt-2 pb-1 font-mono text-[9px] tracking-wider text-muted-foreground/70 uppercase">
              {machine}
            </div>
            {list.map((project) => (
              <a
                className={cn(
                  'flex items-center gap-2 rounded px-2 py-2 text-sm',
                  project.current ? 'bg-accent' : 'hover:bg-accent/50',
                )}
                href={href(project)}
                key={project.url}
                {...newTab(project)}
              >
                <span className="w-5 font-mono text-xs text-muted-foreground">{project.abbr}</span>
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                {project.remote && <ArrowUpRightIcon className="size-3 shrink-0 text-muted-foreground" />}
                {project.waiting ? (
                  <span className="font-mono text-[10px] text-warning">{project.waiting}</span>
                ) : null}
                <Spinner busy={project.busy} paused={project.paused} />
                <span className="flex w-3 justify-center">
                  <Flame className="size-3" now={now} warm={project.warm} />
                </span>
              </a>
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export default defineWebExtension({
  slots: { 'shell.rail': [Rail], 'titlebar.right': [PhoneProjects] },
})
