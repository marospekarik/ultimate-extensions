import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { defineExtension } from '@earendil-works/pi-durable'
import { basename, join } from 'node:path'
import type { RailWarm } from './refs.ts'

type Project = {
  name: string
  root?: string
  current: boolean
  running?: { url: string }
}
type Host = {
  userHome: string
  projects(): Promise<Project[]>
  system(): { process: { url: string } }
  onOpen(run: () => Promise<void>): void
  onClose(run: () => Promise<void>): void
}

/** How often every other local project's page is asked for, so a stale bundle rebuilds before a click. */
const PREBUILD_EVERY = 3 * 60_000
/** A rebuild takes about 15 s; a project slower than this is skipped until the next sweep. */
const PREBUILD_TIMEOUT = 120_000

/**
 * Asks each running local project for `/`, one at a time: a fresh one answers in milliseconds, a stale one rebuilds.
 * Every project loads this extension, so only the one with the lowest URL sweeps, and the machine runs one build at a time.
 */
export async function prebuild(host: Host, log: (line: string) => void = () => {}) {
  const own = host.system().process.url
  const urls = (await host.projects())
    .map((project) => (project.current ? own : project.running?.url))
    .filter((url): url is string => url?.startsWith('http://127.0.0.1:') === true)
    .toSorted()
  if (urls[0] !== own) return
  for (const url of urls) {
    const started = Date.now()
    try {
      const response = await fetch(`${url}/`, { signal: AbortSignal.timeout(PREBUILD_TIMEOUT) })
      await response.arrayBuffer()
      if (Date.now() - started > 1000 || !response.ok)
        log(`${url} ${response.status} ${Date.now() - started} ms`)
    } catch (error) {
      log(`${url} failed after ${Date.now() - started} ms: ${String(error)}`)
    }
  }
}

/** Initials of a hyphenated name (`my-app` → `ma`), else its first two letters; a clash takes the next letters. */
export function abbreviations(names: string[]): string[] {
  const taken = new Set<string>()
  return names.map((name) => {
    const clean = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
    const words = clean.split(' ')
    const flat = clean.replaceAll(' ', '')
    const options = [
      ...(words.length > 1 ? [words[0][0] + words[1][0]] : []),
      ...Array.from({ length: Math.max(flat.length - 1, 1) }, (_, i) => flat.slice(i, i + 2)),
    ]
    const abbr = options.find((option) => !taken.has(option)) ?? flat.slice(0, 1) + taken.size
    taken.add(abbr)
    return abbr.padEnd(2, '·')
  })
}

/** One of the instance's actions, as its own UI calls it; undefined when it does not answer. */
async function action<T>(url: string, extension: string, name: string): Promise<T | undefined> {
  try {
    const response = await fetch(`${url}/api/extensions/${extension}/actions/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ args: null }),
      signal: AbortSignal.timeout(2000),
    })
    return ((await response.json()) as { result?: T }).result
  } catch {
    // An instance that does not answer, or lacks the extension, is shown without that detail.
    return undefined
  }
}

type WarmState = {
  on: boolean
  lastRequest?: number
  nextAt?: number
  last?: { at: number; error?: string }
}

/** Its open questions and its keep-warm state, each absent when it could not be read. */
async function details(url: string) {
  const [status, warm, pause] = await Promise.all([
    action<{ questions?: { count?: number }; busy?: number }>(url, 'status', 'status'),
    action<WarmState>(url, 'keep-warm', 'state'),
    action<{ paused?: boolean }>(url, 'pause', 'state'),
  ])
  const count = status?.questions?.count
  const busy = status?.busy
  const failing =
    warm?.last?.error !== undefined &&
    (warm.lastRequest === undefined || warm.last.at >= warm.lastRequest)
  const railWarm: RailWarm | undefined =
    warm && typeof warm.on === 'boolean'
      ? {
          on: warm.on,
          ...(warm.lastRequest === undefined ? {} : { lastRequest: warm.lastRequest }),
          ...(warm.nextAt === undefined ? {} : { nextAt: warm.nextAt }),
          ...(failing ? { error: warm.last!.error } : {}),
        }
      : undefined
  return {
    ...(count === undefined ? {} : { waiting: count }),
    ...(typeof busy === 'number' ? { busy } : {}),
    ...(pause?.paused ? { paused: true } : {}),
    ...(railWarm ? { warm: railWarm } : {}),
  }
}

async function ports(userHome: string): Promise<Record<string, { port: number }>> {
  try {
    const registry = JSON.parse(await readFile(join(userHome, '.ultimate/tailscale.json'), 'utf8'))
    return registry.ports ?? {}
  } catch {
    // No registry means Tailscale never ran here: tiles have only loopback URLs.
    return {}
  }
}

/** Projects hosted on other machines: `remotes` in the user settings maps machine → project → URL. */
async function remotes(userHome: string) {
  try {
    const settings = JSON.parse(await readFile(join(userHome, '.ultimate/settings.json'), 'utf8'))
    return Object.entries((settings.remotes ?? {}) as Record<string, Record<string, string>>).flatMap(
      ([machine, projects]) => Object.entries(projects).map(([name, url]) => ({ machine, name, url })),
    )
  } catch {
    // Unreadable settings mean no remotes are listed.
    return []
  }
}

export const actions = {
  async projects(_args: unknown, { host }: { host: Host }) {
    const [all, registry, remote] = await Promise.all([
      host.projects(),
      ports(host.userHome),
      remotes(host.userHome),
    ])
    const here = hostname()
    const hosted = new Set(remote.map((r) => r.name))
    const live = all
      .filter((project) => !hosted.has(project.name))
      .map((project) =>
        project.current ? { ...project, running: { url: host.system().process.url } } : project,
      )
      .filter((project) => project.running)
      .toSorted((a, b) => a.name.localeCompare(b.name))
    const abbr = abbreviations([...live.map((project) => project.name), ...remote.map((r) => r.name)])
    const remoteTiles = remote.map(async (r, i) => ({
      name: r.name,
      abbr: abbr[live.length + i],
      current: false,
      url: r.url,
      machine: r.machine,
      remote: r.machine,
      ...(await details(r.url)),
    }))
    return Promise.all([
      ...live.map(async (project, i) => {
        const url = project.running!.url
        const port = project.root ? registry[project.root]?.port : undefined
        return {
          name: project.name || basename(project.root ?? ''),
          abbr: abbr[i],
          current: project.current,
          url,
          machine: here,
          ...(port ? { tailnetPort: port } : {}),
          ...(await details(url)),
        }
      }),
      ...remoteTiles,
    ])
  },
}

export default function projectRail(host: Host) {
  let timer: ReturnType<typeof setInterval> | undefined
  let sweeping = false
  const sweep = () => {
    if (sweeping) return
    sweeping = true
    void prebuild(host, (line) => console.log(`[project-rail] prebuild ${line}`))
      .catch((error) => console.error(`[project-rail] prebuild: ${String(error)}`))
      .finally(() => (sweeping = false))
  }
  host.onClose(async () => clearInterval(timer))
  host.onOpen(async () => {
    clearInterval(timer)
    sweep()
    timer = setInterval(sweep, PREBUILD_EVERY)
  })
  return defineExtension({ name: 'project-rail' })
}
