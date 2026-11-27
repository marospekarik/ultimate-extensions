/** @jsxImportSource @solidjs/web */
import {
  ArrowUpRightIcon,
  Ellipsis,
  FlameIcon,
  FoldersIcon,
  FoldVerticalIcon,
  HouseIcon,
  MoonIcon,
} from '@lucide/solid'
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.solid.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.solid.tsx'
import {
  api,
  cn,
  defineWebExtension,
  errorMessage,
  notify,
  useAction,
  useNow,
  useViewport,
} from '@/sdk/solid'
import { Footer } from './footer.solid.tsx'
import { ManageAction, ProjectsAction } from './refs.ts'
import type { RailOp, RailProject, RailWarm } from './refs.ts'

/**
 * Every folder gets its own hue: Ultimate keeps brand purple, the others are spread evenly round the rest of the wheel
 * in name order, so the colours differ and stay put for as long as the project set does.
 */
const BRAND_HUE = 300
function hues(folders: string[]) {
  const others = [...new Set(folders)].filter((f) => f !== 'ultimate').toSorted()
  const map = new Map<string, number>([['ultimate', BRAND_HUE]])
  others.forEach((f, k) => map.set(f, (BRAND_HUE + ((k + 1) * 360) / (others.length + 1)) % 360))
  return map
}

function Tint(props: { hue?: number; current: boolean; class?: string }) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'absolute inset-0 bg-[oklch(0.88_0.07_var(--h))] dark:bg-[oklch(0.42_0.07_var(--h))]',
        props.current ? 'ring-2 ring-foreground/70' : 'opacity-80',
        props.class,
      )}
      data-project-hue={props.hue}
      style={{ '--h': `${props.hue ?? 0}` }}
    />
  )
}

const local = /^(localhost|127\.0\.0\.1|\[::1\])$/

/**
 * A project on another machine opens in a new tab: its host has no rail, and Ultimate refuses to be framed by another
 * site (`admit` answers 403 to an iframe load), so this tab keeps the rail.
 */
const target = (project: RailProject) => (project.remote ? '_blank' : undefined)
const rel = (project: RailProject) => (project.remote ? 'noopener noreferrer' : undefined)

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

/** How long a repeat tap on the tile being opened is ignored; after that it navigates again (a stopped load). */
const REPEAT_IGNORED_MS = 15_000

const [leaving, setLeaving] = createSignal<{ url: string; at: number }>()

/**
 * The tile tapped last: it pulses until the next page replaces this one, and a repeat tap does not restart the load.
 * Coming back through the back/forward cache clears it.
 */
function useLeaving() {
  const listeners = new AbortController()
  addEventListener('pageshow', () => setLeaving(undefined), { signal: listeners.signal })
  onCleanup(() => listeners.abort())
  return {
    is: (project: RailProject) => leaving()?.url === project.url,
    open: (project: RailProject) => (event: MouseEvent) => {
      if (project.remote || project.current) return
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return
      const last = leaving()
      if (last?.url === project.url && Date.now() - last.at < REPEAT_IGNORED_MS)
        return event.preventDefault()
      setLeaving({ url: project.url, at: Date.now() })
    },
  }
}

function useProjects() {
  const { data, refetch } = useAction(ProjectsAction, null, { every: 15_000, onError: () => {} })
  return { projects: () => data() ?? [], refetch }
}

/** @ultimate's context as the user reads it: 950, 18K, 125K, 1.2M. */
function tokens(count: number) {
  if (count < 1000) return String(count)
  if (count < 999_500) return `${Math.round(count / 1000)}K`
  return `${(count / 1_000_000).toFixed(1)}M`
}

/**
 * The ⋯ menu of a project on this machine: keep-warm on or off, compact then off, and Dream. An item stays pending
 * until that project answered; the rail then reads again so the flame and size follow.
 */
function ProjectMenu(props: { project: RailProject; refetch: () => unknown; class?: string }) {
  const run = (op: string) =>
    api
      .action(ManageAction, { url: props.project.url, op: op as RailOp })
      .then(() => props.refetch())
      .catch((error: unknown) =>
        notify({ level: 'error', message: `${props.project.name}: ${errorMessage(error)}` }),
      )
  return (
    <DropdownMenu modal={false} onAction={run}>
      <DropdownMenuTrigger
        aria-label={`Actions for ${props.project.name}`}
        class={cn(
          'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-open:bg-accent data-open:text-foreground',
          props.class,
        )}
      >
        <Ellipsis aria-hidden="true" class="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="min-w-52">
        <Show when={props.project.warm}>
          {(warm) => (
            <DropdownMenuItem class="text-[12.5px]" value={warm().on ? 'warm-off' : 'warm-on'}>
              <FlameIcon aria-hidden="true" />
              {warm().on ? 'Turn warm off' : 'Turn warm on'}
            </DropdownMenuItem>
          )}
        </Show>
        <DropdownMenuItem class="text-[12.5px]" value="compact-off">
          <FoldVerticalIcon aria-hidden="true" />
          Compact and turn warm off
        </DropdownMenuItem>
        <DropdownMenuItem class="text-[12.5px]" value="dream">
          <MoonIcon aria-hidden="true" />
          Dream
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Tiles by machine, this machine first (the server lists it first, sorted by name). */
function byMachine(projects: RailProject[]) {
  const groups = new Map<string, RailProject[]>()
  for (const project of projects)
    groups.set(project.machine, [...(groups.get(project.machine) ?? []), project])
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
function Flame(props: { warm?: RailWarm; now: number; class?: string }) {
  return (
    <Show when={props.warm}>
      {(warm) => {
        const state = () => heat(warm(), props.now)
        return (
          <FlameIcon
            aria-label={warmLine(warm(), props.now)}
            class={cn('size-2.5', heatColor[state()], props.class)}
            data-keep-warm={state()}
            fill={state() === 'warm' || state() === 'failed' ? 'currentColor' : 'none'}
          />
        )
      }}
    </Show>
  )
}

/** A thin arc turning slowly while agents work; reduced motion gets a still dot. Renders nothing when idle. */
function Spinner(props: { busy?: number; paused?: boolean; class?: string }) {
  return (
    <Show
      when={!props.paused}
      fallback={
        <span
          aria-label="paused"
          class={cn('flex size-2.5 items-center justify-center', props.class)}
          data-paused
        >
          <span class="h-2 w-[1.5px] rounded-full bg-muted-foreground/70" />
          <span class="ml-[2px] h-2 w-[1.5px] rounded-full bg-muted-foreground/70" />
        </span>
      }
    >
      <Show when={props.busy}>
        {(busy) => (
          <span
            aria-label={busy() === 1 ? 'working · 1 agent' : `working · ${busy()} agents`}
            class={cn('flex size-2.5 items-center justify-center', props.class)}
            data-working={busy()}
          >
            <svg
              class="size-2.5 animate-spin text-muted-foreground [animation-duration:1.5s] motion-reduce:hidden"
              fill="none"
              viewBox="0 0 10 10"
            >
              <path
                d="M5 1a4 4 0 0 1 4 4"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.2"
              />
            </svg>
            <span class="hidden size-1 rounded-full bg-muted-foreground motion-reduce:block" />
          </span>
        )}
      </Show>
    </Show>
  )
}

const DAY = 24 * 60 * 60_000

const stale = (project: RailProject, now: number) =>
  project.waitingSince !== undefined && now - project.waitingSince > DAY

/** "3 waiting · newest 2 days ago"; the age follows the rail's clock. */
function waitingHint(project: RailProject, now: number) {
  if (!project.waiting) return undefined
  if (project.waitingSince === undefined) return `${project.waiting} waiting`
  const minutes = Math.max(0, Math.floor((now - project.waitingSince) / 60_000))
  const age =
    minutes < 60
      ? 'just now'
      : minutes < 1440
        ? `${Math.floor(minutes / 60)} h ago`
        : `${Math.floor(minutes / 1440)} ${minutes < 2880 ? 'day' : 'days'} ago`
  return `${project.waiting} waiting · newest ${age}`
}

function Badge(props: { count?: number; class?: string; stale?: boolean; hint?: string }) {
  return (
    <Show when={props.count}>
      <span
        aria-label={props.hint}
        class={cn(
          'absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 font-mono text-[9px] leading-none font-semibold',
          props.stale
            ? 'bg-warning/40 text-neutral-900 dark:text-neutral-50'
            : 'bg-warning text-background',
          props.class,
        )}
        title={props.hint}
      >
        {props.count}
      </span>
    </Show>
  )
}

/**
 * A row: the 32px tile with @ultimate's context size under it, which the collapsed rail shows, then the name, keep-warm
 * line and ⋯ menu the hover reveals.
 */
function Row(props: {
  project: RailProject
  now: number
  hues: Map<string, number>
  leaving: ReturnType<typeof useLeaving>
  refetch: () => unknown
}) {
  const project = () => props.project
  return (
    <div class="flex w-full shrink-0 items-center gap-1">
      <a
        aria-busy={props.leaving.is(project()) ? 'true' : undefined}
        aria-current={project().current ? 'page' : undefined}
        class={cn(
          'flex min-w-0 flex-1 items-start gap-2.5 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
          project().current
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )}
        href={href(project())}
        onClick={props.leaving.open(project())}
        rel={rel(project())}
        target={target(project())}
        title={
          project().warm?.error ??
          (project().remote ? `Opens in a new tab (on ${project().remote})` : undefined)
        }
      >
        <span class="flex w-8 shrink-0 flex-col items-center">
          <span class="relative flex size-8 shrink-0 items-center justify-center font-mono text-[12px]">
            <Tint
              class={cn(
                'rounded-md',
                props.leaving.is(project()) && 'animate-pulse ring-2 ring-foreground/40',
              )}
              current={project().current}
              hue={props.hues.get(project().folder)}
            />
            <span class="relative font-semibold text-neutral-900 dark:text-neutral-50">
              {project().abbr}
            </span>
            <Badge
              count={project().waiting}
              hint={waitingHint(project(), props.now)}
              stale={stale(project(), props.now)}
            />
            <Show when={project().busy || project().paused}>
              <span class="absolute -bottom-0.5 -left-0.5 flex size-3.5 items-center justify-center rounded-full bg-sidebar">
                <Spinner busy={project().busy} paused={project().paused} />
              </span>
            </Show>
            <Show when={project().warm}>
              <span class="absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-sidebar">
                <Flame now={props.now} warm={project().warm} />
              </span>
            </Show>
          </span>
          <span
            class="h-3 font-mono text-[9px] leading-3 text-muted-foreground tabular-nums"
            title={
              project().tokens === undefined
                ? undefined
                : `@ultimate context: ${project().tokens!.toLocaleString()} tokens`
            }
          >
            {project().tokens === undefined ? '' : tokens(project().tokens!)}
          </span>
        </span>
        <span class="min-w-0 flex-1 self-center pr-1 whitespace-nowrap">
          <span class="flex items-center gap-1 text-[12px] text-foreground">
            <span class="truncate">{project().name}</span>
            <Show when={project().remote}>
              <ArrowUpRightIcon class="size-3 shrink-0 text-muted-foreground" />
            </Show>
            <Show when={project().waiting}>
              <span
                class={cn(
                  'ml-auto shrink-0 font-mono text-[10px] text-warning',
                  stale(project(), props.now) && 'opacity-50',
                )}
                title={waitingHint(project(), props.now)}
              >
                {project().waiting} waiting
              </span>
            </Show>
          </span>
          <span
            class={cn(
              'block truncate font-mono text-[10px]',
              project().warm && heat(project().warm!, props.now) === 'failed'
                ? 'text-red-500'
                : 'text-muted-foreground',
            )}
          >
            {project().paused
              ? 'paused · '
              : project().busy
                ? `working · ${project().busy === 1 ? '1 agent' : `${project().busy} agents`} · `
                : ''}
            {project().warm ? warmLine(project().warm!, props.now) : 'Keep warm unknown'}
          </span>
        </span>
      </a>
      <Show when={!project().remote}>
        <ProjectMenu
          class="hidden group-hover/rail:grid group-has-data-open/rail:grid group-has-[:focus-visible]/rail:grid"
          project={project()}
          refetch={props.refetch}
        />
      </Show>
    </div>
  )
}

/** A machine's heading: a short rule in the collapsed rail, its name once the rail opens. */
function Machine(props: { name: string; first: boolean }) {
  return (
    <div class="relative mt-1.5 flex h-4 w-full shrink-0 items-center">
      <span
        class={cn(
          'mx-auto h-px w-5 bg-border transition-opacity group-hover/rail:opacity-0 group-has-[:focus-visible]/rail:opacity-0',
          props.first && 'invisible',
        )}
      />
      <span class="absolute inset-x-1 truncate font-mono text-[9px] tracking-wider text-muted-foreground/70 uppercase opacity-0 transition-opacity select-none group-hover/rail:opacity-100 group-has-[:focus-visible]/rail:opacity-100">
        {props.name}
      </span>
    </div>
  )
}

/**
 * The rail keeps its 44px column in the layout; on hover (or keyboard focus) its panel widens over the app to show
 * names, machines and keep-warm, and narrows again when the pointer leaves.
 */
function Rail() {
  const { projects, refetch } = useProjects()
  const viewport = useViewport()
  const now = useNow(60_000)
  const leaving = useLeaving()
  const groups = createMemo(() => byMachine(projects()))
  const hueOf = createMemo(() => hues(projects().map((project) => project.folder)))
  return (
    <Show when={viewport() !== 'phone'}>
      <nav aria-label="Projects" class="relative w-11 shrink-0">
        <div class="group/rail absolute inset-y-0 left-0 z-40 flex w-11 flex-col gap-1 overflow-x-hidden overflow-y-auto border-r border-border/70 bg-sidebar px-1.5 py-2 transition-[width,box-shadow] duration-150 ease-out hover:w-64 hover:shadow-xl hover:delay-200 has-[:focus-visible]:w-64 has-[:focus-visible]:shadow-xl has-data-open:w-64 has-data-open:shadow-xl">
          <a
            aria-label="Home"
            class="flex w-full shrink-0 items-center gap-2.5 rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            href="/"
          >
            <span class="flex size-8 shrink-0 items-center justify-center">
              <HouseIcon class="size-4" />
            </span>
            <span class="text-[12px] whitespace-nowrap">Home</span>
          </a>
          <For each={groups()} keyed={(group) => group[0]}>
            {(group, i) => (
              <div class="contents">
                <Machine first={i() === 0} name={group()[0]} />
                <For each={group()[1]} keyed={(project) => project.url}>
                  {(project) => (
                    <Row
                      hues={hueOf()}
                      leaving={leaving}
                      now={now()}
                      project={project()}
                      refetch={refetch}
                    />
                  )}
                </For>
              </div>
            )}
          </For>
          <div class="mt-auto flex shrink-0 flex-col">
            <Footer where="rail" />
          </div>
        </div>
      </nav>
    </Show>
  )
}

/** Phones have no room for a rail: the same list sits behind a title-bar button. */
function PhoneProjects() {
  const { projects, refetch } = useProjects()
  const viewport = useViewport()
  const now = useNow(60_000)
  const leaving = useLeaving()
  const hueOf = createMemo(() => hues(projects().map((project) => project.folder)))
  const waiting = () =>
    projects().reduce((sum, project) => sum + (project.current ? 0 : (project.waiting ?? 0)), 0)
  return (
    <Show when={viewport() === 'phone' && projects().length >= 2}>
      <Popover>
        <PopoverTrigger
          aria-label="Projects"
          class="relative flex size-8 items-center justify-center rounded-md text-muted-foreground"
        >
          <FoldersIcon class="size-4" />
          <Badge count={waiting()} />
        </PopoverTrigger>
        <PopoverContent align="end" class="w-72 p-1">
          <For each={byMachine(projects())} keyed={(group) => group[0]}>
            {(group) => (
              <div>
                <div class="px-2 pt-2 pb-1 font-mono text-[9px] tracking-wider text-muted-foreground/70 uppercase">
                  {group()[0]}
                </div>
                <For each={group()[1]} keyed={(project) => project.url}>
                  {(project) => (
                    <div class="flex items-center">
                      <a
                        aria-busy={leaving.is(project()) ? 'true' : undefined}
                        class={cn(
                          'flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-2 text-sm',
                          project().current ? 'bg-accent' : 'hover:bg-accent/50',
                          leaving.is(project()) && 'animate-pulse bg-accent/50',
                        )}
                        href={href(project())}
                        onClick={leaving.open(project())}
                        rel={rel(project())}
                        target={target(project())}
                      >
                        <span class="relative flex size-6 shrink-0 items-center justify-center font-mono text-xs font-semibold">
                          <Tint
                            class="rounded"
                            current={project().current}
                            hue={hueOf().get(project().folder)}
                          />
                          <span class="relative text-neutral-900 dark:text-neutral-50">
                            {project().abbr}
                          </span>
                        </span>
                        <span class="min-w-0 flex-1 truncate">{project().name}</span>
                        <Show when={project().tokens !== undefined}>
                          <span class="font-mono text-[10px] text-muted-foreground tabular-nums">
                            {tokens(project().tokens!)}
                          </span>
                        </Show>
                        <Show when={project().remote}>
                          <ArrowUpRightIcon class="size-3 shrink-0 text-muted-foreground" />
                        </Show>
                        <Show when={project().waiting}>
                          <span
                            class={cn(
                              'font-mono text-[10px] text-warning',
                              stale(project(), now()) && 'opacity-50',
                            )}
                            title={waitingHint(project(), now())}
                          >
                            {project().waiting}
                          </span>
                        </Show>
                        <Spinner busy={project().busy} paused={project().paused} />
                        <span class="flex w-3 justify-center">
                          <Flame class="size-3" now={now()} warm={project().warm} />
                        </span>
                      </a>
                      <Show when={!project().remote} fallback={<span class="w-9 shrink-0" />}>
                        <ProjectMenu class="size-9" project={project()} refetch={refetch} />
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
          <Footer where="phone" />
        </PopoverContent>
      </Popover>
    </Show>
  )
}

export default defineWebExtension({
  slots: { 'shell.rail': [Rail], 'titlebar.right': [PhoneProjects] },
})
