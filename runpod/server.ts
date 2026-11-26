/**
 * Runpod pods for the whole machine: a status-line chip with Stop and Terminate, and a phone push (through the `push`
 * extension) when a pod has run for an hour with no input to any Ultimate. Uses Runpod's REST API with the
 * `RUNPOD_API_KEY` secret. Every project's process runs this; only lora-pilot's instance (`ALERT_PROJECT`) sends the push, since that is where
 * the user subscribed.
 */
import { constants } from 'node:fs'
import { open, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineExtension } from '@earendil-works/pi-durable'

const KEY = 'RUNPOD_API_KEY'
const API = 'https://api.runpod.io/v2'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
/** Running this long after the last input, an alert goes out; then again every hour. */
const IDLE = HOUR
/**
 * Only this project's instance sends the alert: the user subscribes to push in its app, and Push cannot say which
 * instance has a subscription. Other projects still record their input and show the chip.
 */
const ALERT_PROJECT = '/home/kiddo/Projects/lora-pilot'
/** A lock holder that has not renewed for this long is gone. */
const STALE = 3 * MINUTE

export const secrets = [
  {
    name: KEY,
    description: 'Runpod API key (Pods read and write), for the pods chip and the idle alert',
    url: 'https://www.runpod.io/console/user/settings',
  },
]

type Pod = { id: string; name: string; status: string; gpu?: string; costPerHr: number; startedAt?: number }
type Pods = { pods: Pod[]; at: number; problem?: string; setup?: 'add key' }
type Host = {
  userHome: string
  home: string
  projectRoot: string
  conversations(): { inputAt?: number }[]
  want(api: { name: string }): { notify(push: unknown): Promise<void>; close(tag: string): Promise<void> } | undefined
  onOpen(run: () => Promise<void>): void
  onClose(run: () => Promise<void>): void
}
type Watch = {
  holder?: { id: string; at: number }
  /** Newest input to any conversation, per Ultimate process (by its home). */
  inputs?: Record<string, number>
  /** When each pod was last alerted. */
  alerted?: Record<string, number>
}

/** Reads the key like the Secrets panel's store does: no symlink, nothing readable by others. */
async function key(userHome: string): Promise<string | undefined> {
  let file
  try {
    file = await open(join(userHome, '.ultimate/secrets.json'), constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    return undefined
  }
  try {
    if ((await file.stat()).mode & 0o077) return undefined
    const value = (JSON.parse(await file.readFile('utf8')) as { secrets?: Record<string, { value?: unknown }> }).secrets?.[KEY]
      ?.value
    return typeof value === 'string' && value ? value : undefined
  } catch {
    return undefined
  } finally {
    await file.close()
  }
}

async function call(userHome: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const token = await key(userHome)
  if (!token) throw new Error('add RUNPOD_API_KEY in ⌘K → Secrets')
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Runpod ${response.status}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

function pod(raw: Record<string, unknown>): Pod {
  const started = typeof raw.startedAt === 'string' ? Date.parse(raw.startedAt) : NaN
  const gpu = (raw.gpu as { id?: unknown } | undefined)?.id
  return {
    id: String(raw.id),
    name: String(raw.name ?? raw.id),
    status: String(raw.status ?? 'UNKNOWN'),
    ...(typeof gpu === 'string' ? { gpu: gpu.replace('NVIDIA GeForce ', '') } : {}),
    costPerHr: num(raw.cost),
    ...(Number.isNaN(started) ? {} : { startedAt: started }),
  }
}

export async function pods(userHome: string): Promise<Pods> {
  if (!(await key(userHome))) return { pods: [], at: Date.now(), setup: 'add key' }
  try {
    const list = (await call(userHome, 'GET', '/pods')) as { pods: Record<string, unknown>[] }
    return { pods: list.pods.map(pod), at: Date.now() }
  } catch (error) {
    return { pods: [], at: Date.now(), problem: error instanceof Error ? error.message : String(error) }
  }
}

/** The id comes from the browser or an agent: only Runpod's own id shape reaches the URL. */
function podId(args: unknown): string {
  const id = (args as { id?: unknown } | null)?.id
  if (typeof id !== 'string' || !/^[a-z0-9]{8,32}$/.test(id)) throw new Error('a pod id is required')
  return id
}

export const actions = {
  pods: (_args: unknown, context: { host: Host }) => pods(context.host.userHome),
  async stop(args: unknown, context: { host: Host }) {
    await call(context.host.userHome, 'POST', `/pods/${podId(args)}/action`, { action: 'stop' })
    return pods(context.host.userHome)
  },
  async terminate(args: unknown, context: { host: Host }) {
    await call(context.host.userHome, 'DELETE', `/pods/${podId(args)}`)
    return pods(context.host.userHome)
  },
}

const watchPath = (userHome: string) => join(userHome, '.ultimate/runpod-watch.json')

async function readWatch(userHome: string): Promise<Watch> {
  try {
    return JSON.parse(await readFile(watchPath(userHome), 'utf8')) as Watch
  } catch {
    return {}
  }
}

async function writeWatch(userHome: string, watch: Watch) {
  const temporary = `${watchPath(userHome)}.${process.pid}`
  await writeFile(temporary, JSON.stringify(watch), { mode: 0o600 })
  await rename(temporary, watchPath(userHome))
}

/** One check: record this process's newest input, and if it holds the lock, push for each pod idle for an hour. */
export async function check(host: Host, now = Date.now()) {
  const watch = await readWatch(host.userHome)
  const input = Math.max(0, ...host.conversations().map((each) => each.inputAt ?? 0))
  watch.inputs = { ...watch.inputs, [host.home]: input }
  const free = host.projectRoot === ALERT_PROJECT && (!watch.holder || watch.holder.id === host.home || now - watch.holder.at > STALE)
  if (free) watch.holder = { id: host.home, at: now }
  const mine = free
  if (mine) {
    const running = (await pods(host.userHome)).pods.filter((each) => each.status === 'RUNNING')
    const last = Math.max(...Object.values(watch.inputs))
    const push = host.want({ name: 'push' })
    watch.alerted ??= {}
    for (const each of running) {
      if (now - last < IDLE || now - (watch.alerted[each.id] ?? 0) < HOUR) continue
      watch.alerted[each.id] = now
      const hours = ((now - (each.startedAt ?? now)) / HOUR).toFixed(1)
      await push?.notify({
        title: `Runpod pod running, no input for ${Math.floor((now - last) / HOUR)}h`,
        body: `${each.name}${each.gpu ? ` (${each.gpu})` : ''} · $${each.costPerHr.toFixed(2)}/h · up ${hours}h. Open the runpod chip to stop it.`,
        tag: `runpod-${each.id}`,
        path: '/',
        urgency: 'high',
      })
    }
    for (const id of Object.keys(watch.alerted)) if (!running.some((each) => each.id === id)) delete watch.alerted[id]
  }
  await writeWatch(host.userHome, watch)
}

export default function runpod(host: Host) {
  let timer: ReturnType<typeof setInterval> | undefined
  host.onClose(async () => clearInterval(timer))
  host.onOpen(async () => {
    clearInterval(timer)
    const tick = () =>
      void check(host).catch(() => {
        // Runpod or the state file unreachable: the next minute tries again.
      })
    tick()
    timer = setInterval(tick, MINUTE)
  })
  return defineExtension({ name: 'runpod' })
}
