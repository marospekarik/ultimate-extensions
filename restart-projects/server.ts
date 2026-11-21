import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { defineExtension, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'

const run = promisify(execFile)

type Project = { name: string; root: string; current?: boolean; running?: { pid: number; url: string } }
type Host = {
  ultimateRoot: string
  projects(): Promise<Project[]>
  system(): { process: { url: string } }
  harness(): any
}
type Row = {
  name: string
  unit: string | null
  status: 'ok' | 'fallback' | 'failed' | 'skipped'
  before: number | null
  after: number | null
  reason?: string
  error?: string
}

const IN_PLACE_DEADLINE = 90_000
const FALLBACK_DEADLINE = 120_000
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The generation the project serves: the first `system` event of its event stream, read until the stream answers or the signal aborts. */
async function servedGeneration(url: string, signal: AbortSignal, minimum: number, pace: Pace): Promise<number> {
  for (;;) {
    signal.throwIfAborted()
    const stream = new AbortController()
    const both = AbortSignal.any([signal, stream.signal])
    try {
      const response = await fetch(`${url}/api/events`, { headers: { origin: url }, signal: both })
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let text = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        const found = /event: system\r?\ndata: (.*)\r?\n/.exec(text)
        if (!found) continue
        const generation = (JSON.parse(found[1]) as { build: { generation: number } }).build.generation
        if (generation >= minimum) return generation
        text = text.slice(found.index + found[0].length)
      }
    } catch (error) {
      signal.throwIfAborted()
      // A refused or reset connection is the swap itself: pace and reconnect until the deadline.
      void error
      await pace(500, signal)
    } finally {
      stream.abort()
    }
  }
}
type Pace = (ms: number, signal?: AbortSignal) => Promise<void>

async function unitOf(pid: number): Promise<string> {
  const cgroup = await readFile(`/proc/${pid}/cgroup`, 'utf8')
  const unit = cgroup.trim().split('\n').at(-1)!.split('/').at(-1)!
  if (!unit.startsWith('ultimate@') || !unit.endsWith('.service')) throw new Error(`pid ${pid} is not in an ultimate unit: ${unit}`)
  return unit
}

async function runsThisClone(pid: number, root: string): Promise<boolean> {
  const cmdline = await readFile(`/proc/${pid}/cmdline`, 'utf8')
  return cmdline.split('\0').includes(join(root, 'bin/ultimate.ts'))
}

const systemctl = (...args: string[]) => run('systemctl', ['--user', ...args])

/** Why the in-place swap cannot pick up what changed since the unit started; undefined when it can. */
async function forcedReason(unit: string, root: string): Promise<string | undefined> {
  const { stdout } = await systemctl('show', '--timestamp=unix', '-p', 'ActiveEnterTimestamp', '-p', 'NeedDaemonReload', '-p', 'FragmentPath', unit)
  const props = Object.fromEntries(stdout.trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
  if (props.NeedDaemonReload === 'yes') {
    await systemctl('daemon-reload')
    return 'the unit file changed on disk (daemon-reload needed)'
  }
  const started = Number(props.ActiveEnterTimestamp.replace('@', '')) * 1000
  const bin = await readdir(join(root, 'bin'), { withFileTypes: true })
  const mtimes = await Promise.all(bin.filter((entry) => entry.isFile()).map(async (entry) => (await stat(join(root, 'bin', entry.name))).mtimeMs))
  if (mtimes.some((mtime) => mtime > started)) return 'bin/ changed since the supervisor started'
  const fragment = props.FragmentPath || join(homedir(), '.config/systemd/user/ultimate@.service')
  if ((await stat(fragment)).mtimeMs > started) return 'the unit file changed since the supervisor started'
  return undefined
}

async function restartOne(host: Host, project: Project, own: string, pace: Pace, outer: AbortSignal): Promise<Row | undefined> {
  const running = project.running
  if (project.current || !running || running.url === own) return undefined
  const row: Row = { name: project.name, unit: null, status: 'ok', before: null, after: null }
  try {
    if (!(await runsThisClone(running.pid, host.ultimateRoot))) return undefined
    row.unit = await unitOf(running.pid)
    row.before = await servedGeneration(running.url, AbortSignal.any([outer, AbortSignal.timeout(30_000)]), 0, pace)
    let reason = await forcedReason(row.unit, host.ultimateRoot)
    if (!reason) {
      try {
        const response = await fetch(`${running.url}/api/restart`, {
          method: 'POST',
          headers: { origin: running.url, 'content-type': 'application/json' },
          body: '{}',
          signal: AbortSignal.any([outer, AbortSignal.timeout(IN_PLACE_DEADLINE)]),
        })
        const body = (await response.json()) as { ok: boolean; generation?: number; error?: string }
        if (!response.ok || !body.ok || body.generation === undefined) throw new Error(body.error ?? `HTTP ${response.status}`)
        row.after = await servedGeneration(running.url, AbortSignal.any([outer, AbortSignal.timeout(IN_PLACE_DEADLINE)]), body.generation, pace)
        return row
      } catch (error) {
        outer.throwIfAborted()
        reason = `in-place restart failed: ${message(error)}`
      }
    }
    row.status = 'fallback'
    row.reason = reason
    await systemctl('restart', row.unit)
    const until = AbortSignal.any([outer, AbortSignal.timeout(FALLBACK_DEADLINE)])
    for (;;) {
      const now = (await host.projects()).find((candidate) => candidate.root === project.root)
      if (now?.running && now.running.pid !== running.pid) {
        row.after = await servedGeneration(now.running.url, until, 1, pace)
        return row
      }
      await pace(1000, until)
    }
  } catch (error) {
    outer.throwIfAborted()
    row.status = 'failed'
    row.error = message(error)
    return row
  }
}

let installed: { task: any } | undefined

export default async function restartProjects(host: Host) {
  const { defineEffect } = await import(join(host.ultimateRoot, 'lib/effect.ts'))
  const { pace } = (await import(join(host.ultimateRoot, 'lib/timers.ts'))) as { pace: Pace }

  const task = defineEffect('restart-projects.restart', async (_input: unknown, { signal }: { signal: AbortSignal }) => {
    const own = host.system().process.url
    const rows: Row[] = []
    for (const project of await host.projects()) {
      const row = await restartOne(host, project, own, pace, signal)
      if (row) rows.push(row)
    }
    return rows
  })
  installed = { task }
  return defineExtension({ name: 'restart-projects', tasks: [task] })
}

export const actions = {
  async restart(_args: unknown, { host }: { host: Host }) {
    const { effectResult } = await import(join(host.ultimateRoot, 'lib/effect.ts'))
    const posting = await host.harness().commit(
      (tx: any) => tx.createTask(installed!.task, { run: randomUUID() }, { conversationId: ROOT_CONVERSATION_ID, ownership: { kind: 'conversation' } }),
      BACKGROUND_CONTEXT,
    )
    return { rows: await effectResult(host.harness(), posting, BACKGROUND_CONTEXT) }
  },
}
