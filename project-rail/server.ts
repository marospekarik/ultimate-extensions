import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { defineExtension } from '@earendil-works/pi-durable'
import { basename, join } from 'node:path'
import type { RailOp, RailWarm } from './refs.ts'

const OPS: RailOp[] = ['warm-on', 'warm-off', 'compact-off', 'dream']

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

/** POSTs to the instance as its own UI does; throws with its error when it refuses. */
async function post<T>(url: string, path: string, body: unknown, timeout = 2000): Promise<T> {
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: url },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  const answer = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(answer.error ?? `${path} answered ${response.status}`)
  return answer
}

const call = async <T>(url: string, extension: string, name: string, args: unknown = null) =>
  (await post<{ result: T }>(url, `/api/extensions/${extension}/actions/${name}`, { args })).result

/** One of the instance's actions, as its own UI calls it; undefined when it does not answer. */
async function action<T>(url: string, extension: string, name: string): Promise<T | undefined> {
  try {
    return await call<T>(url, extension, name)
  } catch {
    // An instance that does not answer, or lacks the extension, is shown without that detail.
    return undefined
  }
}

/** A document of the instance, read through codemode's `read` action as `ultimate.doc` does. */
const doc = <T>(url: string, kind: string, conversation: number) =>
  call<T | null>(url, 'codemode', 'read', { op: 'doc', args: [kind, conversation] })

async function ultimateOf(url: string) {
  const id = (await doc<{ ultimate?: number }>(url, 'ultimate.standing-agents', 1))?.ultimate
  if (id === undefined) throw new Error('This project has no @ultimate')
  return id
}

/** The tokens @ultimate's next request carries; undefined when they cannot be read. */
async function contextTokens(url: string) {
  try {
    return (await doc<{ tokens?: number }>(url, 'conversations.context', await ultimateOf(url)))
      ?.tokens
  } catch {
    // An instance without codemode, or without @ultimate yet, shows no context size.
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
  const [status, warm, pause, tokens] = await Promise.all([
    action<{ questions?: { count?: number; newestAt?: number }; busy?: number }>(
      url,
      'status',
      'status',
    ),
    action<WarmState>(url, 'keep-warm', 'state'),
    action<{ paused?: boolean }>(url, 'pause', 'state'),
    contextTokens(url),
  ])
  const count = status?.questions?.count
  const waitingSince = status?.questions?.newestAt
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
    ...(count && waitingSince !== undefined ? { waitingSince } : {}),
    ...(typeof busy === 'number' ? { busy } : {}),
    ...(pause?.paused ? { paused: true } : {}),
    ...(railWarm ? { warm: railWarm } : {}),
    ...(tokens === undefined ? {} : { tokens }),
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
    return Object.entries(
      (settings.remotes ?? {}) as Record<string, Record<string, string>>,
    ).flatMap(([machine, projects]) =>
      Object.entries(projects).map(([name, url]) => ({ machine, name, url })),
    )
  } catch {
    // Unreadable settings mean no remotes are listed.
    return []
  }
}

/** This machine's running projects: a project on another machine belongs to whoever runs it there. */
async function localUrls(host: Host) {
  return new Set([
    host.system().process.url,
    ...(await host.projects()).flatMap((project) => (project.running ? [project.running.url] : [])),
  ])
}

export const actions = {
  /** `{ url, op }`: run one of the ⋯ menu's operations on that local project (see `RailOp`). */
  async manage(args: unknown, { host }: { host: Host }) {
    const { url, op } = (args ?? {}) as { url?: unknown; op?: unknown }
    if (typeof url !== 'string' || !OPS.includes(op as RailOp))
      throw new Error(`Expected { url, op: ${OPS.join(' | ')} }`)
    if (!(await localUrls(host)).has(url))
      throw new Error(`${url} is not a project running on this machine`)
    switch (op as RailOp) {
      case 'warm-on':
        await call(url, 'keep-warm', 'set', { on: true })
        break
      case 'warm-off':
        await call(url, 'keep-warm', 'set', { on: false })
        break
      case 'compact-off':
        await post(url, `/api/conversations/${await ultimateOf(url)}/compact`, {}, 10_000)
        await call(url, 'keep-warm', 'set', { on: false })
        break
      case 'dream':
        await call(url, 'dream', 'start')
        break
    }
    return null
  },

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
    const abbr = abbreviations([
      ...live.map((project) => project.name),
      ...remote.map((r) => r.name),
    ])
    const remoteTiles = remote.map(async (r, i) => ({
      name: r.name,
      folder: r.name,
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
          folder: basename(project.root ?? project.name),
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

export const userActions = ['manage']

export default function projectRail() {
  return defineExtension({ name: 'project-rail' })
}
