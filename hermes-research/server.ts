import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import type { Context } from '@earendil-works/chord/context'
import { defineDoc, defineEntry, defineExtension, defineTask, defineTool, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { ConversationId, Harness } from '@earendil-works/pi-durable'
import { obj, opt, str } from '@earendil-works/pi-schema'
import { RESULT_KIND, RUNS_KIND } from './types.ts'
import type { Live, Result, Run, RunState, Tokens } from './types.ts'

const run = promisify(execFile)

type Host = { ultimateRoot: string; userHome: string; home: string; harness(): Harness }
type Pace = (ms: number, signal?: AbortSignal) => Promise<void>

const PROFILE = 'researcher'
const HERMES = join(homedir(), '.local/bin/hermes')
const STATE_DB = join(homedir(), '.hermes/profiles', PROFILE, 'state.db')
const POLL = 2000
const PREVIEW_LINES = 12
const INLINE_BRIEF = 8000
const REASONING = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

const Runs = defineDoc<{ runs: Run[] }>({
  kind: RUNS_KIND,
  checkpointWhen: () => false,
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({ runs: [] }),
})
export const docs = [Runs]

const ResultEntry = defineEntry<Result>(RESULT_KIND)

const unit = (id: string) => `hermes-research-${id}`
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const exists = (path: string) => stat(path).then(() => true, () => false)

async function active(id: string) {
  const { stdout } = await run('systemctl', ['--user', 'is-active', unit(id)]).catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? '' }))
  return ['active', 'activating', 'deactivating', 'reloading'].includes(stdout.trim())
}

type Stream = { session?: string; exitCode?: number; text?: string; tokens?: Tokens; error?: string }

async function tail(file: string, bytes: number) {
  if (!(await exists(file))) return ''
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    const chunk = Math.min(size, bytes)
    const buffer = Buffer.alloc(chunk)
    await handle.read(buffer, 0, chunk, size - chunk)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

/** The `result` event of a run's stream-json output, once Hermes wrote it. */
async function result(dir: string): Promise<Stream | undefined> {
  const line = (await tail(join(dir, 'out.jsonl'), 4 * 1024 * 1024)).trimEnd().split('\n').at(-1)
  if (!line?.includes('"type": "result"') && !line?.includes('"type":"result"')) return undefined
  const event = JSON.parse(line) as {
    session_id?: string
    exit_code?: number
    text?: string
    error?: string
    tokens?: { input?: number; output?: number; total?: number; cache_read?: number }
  }
  const t = event.tokens ?? {}
  return {
    session: event.session_id || undefined,
    exitCode: event.exit_code,
    text: event.text,
    error: event.error,
    tokens: { input: t.input ?? 0, output: t.output ?? 0, cacheRead: t.cache_read ?? 0, total: t.total ?? 0 },
  }
}

function withDb<T>(read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(STATE_DB, { readOnly: true })
  try {
    return read(db)
  } finally {
    db.close()
  }
}

type Row = { id: string; model: string | null; api_call_count: number; tool_call_count: number }

/** The run's Hermes session row: by id once known, else the newest session started in the run's own folder. */
function sessionRow(db: DatabaseSync, item: Run): Row | undefined {
  const query = item.session
    ? db.prepare('select id, model, api_call_count, tool_call_count from sessions where id = ?')
    : db.prepare('select id, model, api_call_count, tool_call_count from sessions where cwd = ? and started_at >= ? order by started_at desc limit 1')
  return (item.session ? query.get(item.session) : query.get(item.cwd, item.startedAt / 1000 - 5)) as Row | undefined
}

function describe(name: string, args: Record<string, unknown>) {
  const first = (value: unknown) => (Array.isArray(value) ? value[0] : value)
  const target = [args.url, first(args.urls), args.query, args.command, args.path, args.code].find((value) => typeof value === 'string')
  return target ? `${name} ${String(target).split('\n')[0].slice(0, 160)}` : name
}

function live(item: Run): Live | null {
  return withDb((db) => {
    const row = sessionRow(db, item)
    if (!row) return null
    const call = db
      .prepare("select tool_calls from messages where session_id = ? and role = 'assistant' and tool_calls is not null order by id desc limit 1")
      .get(row.id) as { tool_calls: string } | undefined
    let last: string | undefined
    if (call) {
      const calls = JSON.parse(call.tool_calls) as { function?: { name?: string; arguments?: string } }[]
      const fn = calls.at(-1)?.function
      if (fn?.name) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(fn.arguments ?? '{}') as Record<string, unknown>
        } catch {
          args = {}
        }
        last = describe(fn.name, args)
      }
    }
    return {
      ...(row.model ? { model: row.model } : {}),
      apiCalls: row.api_call_count - (item.base?.apiCalls ?? 0),
      tools: row.tool_call_count - (item.base?.tools ?? 0),
      ...(last ? { last } : {}),
    }
  })
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .slice(0, 6)
    .join('-')
    .slice(0, 60) || 'research'

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

async function writeReport(host: Host, item: Run, brief: string, model: string | undefined) {
  const folder = join(host.userHome, '.ultimate', 'reports', basename(host.home))
  await mkdir(folder, { recursive: true })
  const marker = `Hermes run ${item.id}`
  let name = `${day(item.startedAt)}-${slug(item.prompt)}.md`
  const taken = await readFile(join(folder, name), 'utf8').catch(() => undefined)
  if (taken !== undefined && !taken.includes(marker)) name = name.replace(/\.md$/, `-${item.id}.md`)
  const title = item.prompt.split('\n')[0].slice(0, 100)
  const question = item.prompt
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  const header = `# ${title}\n\n${question}\n\nResearched by Hermes ${PROFILE} (${model ?? 'profile default model'}), ${day(item.startedAt)}. ${marker}${item.session ? `, session \`${item.session}\`` : ''}.\n\n---\n\n`
  await writeFile(join(folder, name), header + brief.trim() + '\n')
  return { name, path: join(folder, name) }
}

const preview = (brief: string) => brief.trim().split('\n').slice(0, PREVIEW_LINES).join('\n')

async function update(harness: Harness, id: string, change: (item: Run) => void) {
  await harness.commit(async (tx) => {
    const item = (await tx.doc(Runs, ROOT_CONVERSATION_ID)).runs.find((candidate) => candidate.id === id)
    if (item) change(item)
  }, context)
}

async function find(harness: Harness, id: string, ctx: Context = context) {
  return (await harness.snapshot(Runs, ROOT_CONVERSATION_ID, ctx))?.runs.find((item) => item.id === id)
}

function resultText(item: Run, reportPath?: string, brief?: string) {
  const head = `[hermes_research run ${item.id} ${item.state}]`
  if (item.state !== 'done') return `${head} ${item.error ?? ''}`.trim()
  const stats = `Model ${item.model ?? '?'}, ${item.apiCalls ?? '?'} API calls, ${item.tokens?.total ?? '?'} tokens.`
  const link = `Brief: ${reportPath} (link it as [brief](/.reports/${item.report})). Follow up with hermes_research {resume: "${item.id}"}.`
  const body = brief && brief.length <= INLINE_BRIEF ? `\n\n${brief.trim()}` : `\n\nFirst lines:\n${item.preview ?? ''}\n\nRead the whole brief from the file.`
  return `${head} ${stats}\n${link}${body}`
}

export default async function hermesResearch(host: Host) {
  const { pace } = (await import(join(host.ultimateRoot, 'lib/timers.ts'))) as { pace: Pace }

  const RunTask = defineTask<{ run: string }, { phase: 'launch' } | { phase: 'watch' } | { phase: 'report'; text: string }, null>({
    name: 'hermes-research.run',
    version: 1,
    initial: () => ({ phase: 'launch' }),
    phases: {
      launch: async (task, runtime, ctx) => {
        const item = (await find(host.harness(), task.input.run, ctx))!
        await mkdir(item.dir, { recursive: true })
        const out = join(item.dir, 'out.jsonl')
        if (!(await exists(out)) && !(await active(item.id))) {
          await writeFile(join(item.dir, 'prompt.md'), item.prompt)
          const args = [
            '-p', PROFILE, 'chat', '--query-file', join(item.dir, 'prompt.md'), '--format', 'stream-json',
            ...(item.model ? ['-m', item.model] : []),
            ...(item.reasoning ? ['--reasoning', item.reasoning] : []),
            ...(item.resume && item.session ? ['--resume', item.session] : []),
          ]
          await run('systemd-run', [
            '--user', '--quiet', '--collect', '--unit', unit(item.id),
            `--working-directory=${item.cwd}`,
            '-p', `StandardOutput=file:${out}`,
            '-p', `StandardError=file:${join(item.dir, 'err.log')}`,
            HERMES, ...args,
          ]).catch((error: unknown) => writeFile(join(item.dir, 'err.log'), `Starting Hermes failed: ${message(error)}\n`))
        }
        await runtime.commit(() => ({ status: 'running', checkpoint: { phase: 'watch' } }), ctx)
      },
      watch: async (task, runtime, ctx) => {
        const id = task.input.run
        let ended: Stream | undefined
        for (;;) {
          ended = await result((await find(host.harness(), id, ctx))!.dir)
          if (ended || !(await active(id))) break
          await pace(POLL, runtime.signal)
        }
        ended ??= await result((await find(host.harness(), id, ctx))!.dir)
        const item = (await find(host.harness(), id, ctx))!
        const session = ended?.session ?? item.session
        const row = withDb((db) => sessionRow(db, { ...item, ...(session ? { session } : {}) }))
        const model = row?.model ?? item.model
        const apiCalls = row ? row.api_call_count - (item.base?.apiCalls ?? 0) : undefined
        let state: RunState = ended && ended.exitCode === 0 && ended.text ? 'done' : item.stopping ? 'stopped' : 'failed'
        let error: string | undefined
        let report: { name: string; path: string } | undefined
        if (state === 'done') {
          try {
            report = await writeReport(host, { ...item, ...(session ? { session } : {}) }, ended!.text!, model ?? undefined)
          } catch (failure) {
            state = 'failed'
            error = `Writing the brief failed: ${message(failure)}`
          }
        } else if (state === 'failed') {
          const log = await tail(join(item.dir, 'err.log'), 16 * 1024)
          error = ended?.error || log.trim().split('\n').filter((line) => !/Bitwarden|^Session:|^session_id:|^\s*$/.test(line)).slice(-5).join('\n') || 'Hermes ended without a result'
        } else error = 'Stopped from its card.'
        let text = ''
        await runtime.commit(async (tx) => {
          const stored = (await tx.doc(Runs, ROOT_CONVERSATION_ID)).runs.find((candidate) => candidate.id === id)!
          stored.state = state
          stored.endedAt = Date.now()
          delete stored.stopping
          if (session) stored.session = session
          if (model) stored.model = model
          if (apiCalls !== undefined) stored.apiCalls = apiCalls
          if (ended?.tokens) stored.tokens = ended.tokens
          if (report) {
            stored.report = report.name
            stored.preview = preview(ended!.text!)
          }
          if (error) stored.error = error
          text = resultText(stored, report?.path, ended?.text)
          return { status: 'running', checkpoint: { phase: 'report', text } }
        }, ctx)
      },
      report: async (task, runtime, ctx) => {
        const item = (await find(host.harness(), task.input.run, ctx))!
        const caller = await runtime.conversation(item.conversation as ConversationId, ctx)
        if (caller)
          await caller.submit(
            {
              type: 'input',
              content: task.state.checkpoint.text,
              entry: {
                kind: ResultEntry.kind,
                data: { run: item.id, state: item.state, ...(item.report ? { report: item.report } : {}), ...(item.error ? { error: item.error } : {}) },
              },
              whenBusy: 'steer',
              onAbort: 'keep',
              requestId: `hermes-research:${item.id}`,
            },
            ctx,
          )
        await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: null } }), ctx)
      },
    },
    abort: (task, runtime, ctx) =>
      runtime.commit(async (tx) => {
        const stored = (await tx.doc(Runs, ROOT_CONVERSATION_ID)).runs.find((candidate) => candidate.id === task.input.run)
        if (stored?.state === 'running') {
          stored.state = 'stopped'
          stored.error = 'Its task was aborted; the Hermes process may still run.'
          stored.endedAt = Date.now()
        }
        return { status: 'terminal', outcome: { status: 'aborted' } }
      }, ctx),
  })

  const tool = defineTool({
    name: 'hermes_research',
    replay: 'safe',
    description:
      "Hand a research question to the user's Hermes `researcher` agent (web search, page reading, sourced briefs with confidence tags). Returns at once with a run id; a live card shows the run, the brief goes to the project's reports folder, and the result arrives as an input when the run ends: never poll or wait for it. A brief takes from 20 s to several minutes and costs the user's Ollama Cloud tokens: use it when the answer needs several sources, not for questions about the code. Write one self-contained prompt (Hermes knows nothing of this conversation): the question, the decision it feeds, the scope and the shape you want back. `resume` (a run id) asks a follow-up in that run's Hermes session.",
    parameters: obj({
      prompt: str({ description: 'The self-contained research question' }),
      model: opt(str({ description: "Hermes model id; default: the researcher profile's model" })),
      reasoning: opt(str({ description: `Reasoning effort: ${REASONING.join(', ')}` })),
      resume: opt(str({ description: 'Run id of an earlier hermes_research run to follow up in the same session' })),
    }),
    async execute(args, api, ctx) {
      if (!args.prompt.trim()) throw new Error('prompt must not be empty')
      if (args.reasoning && !REASONING.includes(args.reasoning)) throw new Error(`reasoning must be one of ${REASONING.join(', ')}`)
      if (args.model && !/^[\w.:/-]+$/.test(args.model)) throw new Error('model must be a plain model id')
      let base: Run['base']
      let earlier: Run | undefined
      if (args.resume) {
        earlier = await find(host.harness(), args.resume, ctx)
        if (!earlier) throw new Error(`No hermes_research run ${args.resume} in this project`)
        if (earlier.state === 'running') throw new Error(`Run ${args.resume} is still running; resume it once it ended`)
        if (!earlier.session) throw new Error(`Run ${args.resume} has no Hermes session to resume`)
        const row = withDb((db) => sessionRow(db, earlier!))
        base = { apiCalls: row?.api_call_count ?? 0, tools: row?.tool_call_count ?? 0 }
      }
      const item = await api.commit(async (tx) => {
        const state = await tx.doc(Runs, ROOT_CONVERSATION_ID)
        const known = state.runs.find((candidate) => candidate.conversation === api.conversationId && candidate.call === api.callId)
        if (known) return { ...known }
        const id = randomBytes(4).toString('hex')
        const dir = join(host.home, 'hermes-research', id)
        const created: Run = {
          id,
          conversation: api.conversationId,
          call: api.callId,
          prompt: args.prompt.trim(),
          ...(args.model ? { model: args.model } : {}),
          ...(args.reasoning ? { reasoning: args.reasoning } : {}),
          ...(earlier ? { resume: earlier.id, session: earlier.session, base } : {}),
          dir,
          cwd: earlier?.cwd ?? dir,
          startedAt: Date.now(),
          state: 'running',
        }
        state.runs.push(created)
        await tx.createTask(RunTask, { run: id }, { conversationId: ROOT_CONVERSATION_ID, ownership: { kind: 'conversation' }, background: true })
        return { ...created }
      }, ctx)
      await api.details({ run: item.id }, ctx)
      return {
        output: [
          {
            type: 'text',
            text: `Started Hermes run ${item.id}${item.resume ? ` (follow-up of ${item.resume})` : ''}. Its card shows progress; the result arrives as an input when it ends. Do not poll for it.`,
          },
        ],
        details: { run: item.id },
      }
    },
  })

  return defineExtension({ name: 'hermes-research', tasks: [RunTask], tools: [tool] })
}

type Ctx = { host: Host; signal?: AbortSignal }

const runArg = (args: unknown) => {
  const id = (args as { run?: unknown } | null)?.run
  if (typeof id !== 'string' || !/^[0-9a-f]{8}$/.test(id)) throw new Error('run must be a run id')
  return id
}

export const actions = {
  async live(args: unknown, { host }: Ctx) {
    const item = await find(host.harness(), runArg(args))
    if (!item || item.state !== 'running') return null
    return live(item)
  },
  async stop(args: unknown, { host }: Ctx) {
    const id = runArg(args)
    const item = await find(host.harness(), id)
    if (!item) throw new Error(`No run ${id}`)
    if (item.state !== 'running') return { stopped: false }
    await update(host.harness(), id, (stored) => {
      stored.stopping = true
    })
    try {
      await run('systemctl', ['--user', 'stop', unit(id)])
    } catch (error) {
      await update(host.harness(), id, (stored) => {
        delete stored.stopping
      })
      throw new Error(`Stopping Hermes run ${id} failed: ${message(error)}`)
    }
    return { stopped: true }
  },
}
