import { randomBytes } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { defineDoc, defineEntry, defineExtension, defineTool, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { ConversationId, Harness } from '@earendil-works/pi-durable'
import { arr, map, obj, opt, str } from '@earendil-works/pi-schema'
import { REQUESTS_KIND, RESULT_KIND } from './types.ts'
import type { Counts, Result, SecretRequest } from './types.ts'

type Host = { userHome: string; harness(): Harness }

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const MAX_VALUE = 16 * 1024

const Requests = defineDoc<{ requests: SecretRequest[] }>({
  kind: REQUESTS_KIND,
  checkpointWhen: () => false,
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({ requests: [] }),
})
export const docs = [Requests]

const ResultEntry = defineEntry<Result>(RESULT_KIND)

const assignment = (name: string) => new RegExp(`^(\\s*(?:export\\s+)?${name}\\s*=\\s*)(.*)$`)
const anyAssignment = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/

function closes(text: string, quote: string) {
  for (let i = 1, escaped = false; i < text.length; i++) {
    if (escaped) escaped = false
    else if (quote === '"' && text[i] === '\\') escaped = true
    else if (text[i] === quote) return true
  }
  return false
}

function checkShape(content: string, names: string[]) {
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const value = anyAssignment.exec(line)?.[1] ?? ''
    if ((value[0] === "'" || value[0] === '"') && !closes(value, value[0]))
      throw new Error('The dotenv file has a multi-line quoted value; it cannot be merged safely.')
  }
  for (const name of names)
    if (lines.filter((line) => assignment(name).test(line)).length > 1)
      throw new Error(`The dotenv file assigns ${name} more than once; remove the duplicate and ask again.`)
}

function encode(value: string) {
  if (!value.includes("'")) return `'${value}'`
  if (!value.includes('"') && !/\\[nr]/.test(value)) return `"${value}"`
  if (value === value.trim() && !value.includes('#')) return value
  throw new Error('A value cannot be written as a single dotenv assignment.')
}

function trailingComment(rest: string) {
  let quote: string | null = null
  for (let i = 0, escaped = false; i < rest.length; i++) {
    const char = rest[i]!
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && quote === '"') escaped = true
    else if (char === "'" || char === '"') quote = quote === char ? null : (quote ?? char)
    else if (char === '#' && quote === null && i > 0 && /\s/.test(rest[i - 1]!)) {
      let start = i
      while (start > 0 && /\s/.test(rest[start - 1]!)) start--
      return rest.slice(start)
    }
  }
  return ''
}

/** Merges `values` into dotenv `content`, keeping every other line, comment and the line endings. */
export function merge(content: string, values: Record<string, string>): { content: string } & Counts {
  const names = Object.keys(values)
  checkShape(content, names)
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const endsWithEol = content.endsWith('\n')
  const lines = content ? content.split(/\r?\n/) : []
  if (endsWithEol) lines.pop()
  const missing = new Set(names)
  let updated = 0
  let unchanged = 0
  const merged = lines.map((line) => {
    for (const name of names) {
      const match = assignment(name).exec(line)
      if (!match) continue
      missing.delete(name)
      const next = `${match[1]}${encode(values[name]!)}${trailingComment(match[2] ?? '')}`
      if (next === line) unchanged++
      else updated++
      return next
    }
    return line
  })
  for (const name of missing) merged.push(`${name}=${encode(values[name]!)}`)
  const text = merged.join(eol)
  return {
    content: text ? `${text}${endsWithEol || missing.size ? eol : ''}` : '',
    added: missing.size,
    updated,
    unchanged,
  }
}

async function target(userHome: string, cwd: string, path: string) {
  const home = await realpath(userHome)
  const absolute = resolve(cwd, path.replace(/^~(?=\/|$)/, userHome))
  if (!isAbsolute(absolute) || !(absolute + sep).startsWith(home + sep) || absolute === home)
    throw new Error(`path must be a file inside ${home}: absolute, ~/… or relative to the working directory, not the home folder or another folder itself (example: ~/.ultimate/secrets/my-app.env)`)
  if (absolute.startsWith(join(home, '.ultimate') + sep) && /secrets\.json$/.test(absolute))
    throw new Error("path must not be Ultimate's own secrets file; use the Secrets panel for that")
  const parent = dirname(absolute)
  let real = parent
  for (let at = parent; ; at = dirname(at)) {
    const found = await realpath(at).catch(() => undefined)
    if (found) {
      real = join(found, parent.slice(at.length))
      break
    }
  }
  if (!(real + sep).startsWith(home + sep)) throw new Error('path must not lead outside the home folder through a symlink')
  return join(real, absolute.slice(parent.length + 1))
}

async function write(path: string, values: Record<string, string>): Promise<Counts> {
  const stat = await lstat(path).catch(() => undefined)
  if (stat?.isSymbolicLink()) throw new Error(`${path} is a symlink; point the request at the real file`)
  if (stat && !stat.isFile()) throw new Error(`${path} is not a file`)
  const current = stat ? await readFile(path, 'utf8') : ''
  const { content, ...counts } = merge(current, values)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try {
    await file.writeFile(content)
    await file.sync()
  } finally {
    await file.close()
  }
  try {
    if ((stat ? await readFile(path, 'utf8') : '') !== current)
      throw new Error(`${path} changed while saving; nothing was written, save again`)
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  return counts
}

const find = async (harness: Harness, id: string) =>
  (await harness.snapshot(Requests, ROOT_CONVERSATION_ID, context))?.requests.find((item) => item.id === id)

function resultText(item: SecretRequest) {
  const names = item.fields.map((field) => field.name).join(', ')
  if (item.state === 'cancelled') return `[request_secret ${item.id} cancelled] The user cancelled the request for ${names}. Do not ask them to paste it into chat.`
  const { added, updated, unchanged } = item.counts!
  return (
    `[request_secret ${item.id} saved] Wrote ${names} to ${item.path} (added ${added}, updated ${updated}, unchanged ${unchanged}). ` +
    `Load it where a command needs it: \`set -a; . ${item.path}; set +a; <command>\`, or let the app read its own dotenv. ` +
    'Never print, cat, grep or echo the file or the variables.'
  )
}

async function settle(host: Host, id: string, change: (item: SecretRequest) => void) {
  let settled: SecretRequest | undefined
  await host.harness().commit(async (tx) => {
    const item = (await tx.doc(Requests, ROOT_CONVERSATION_ID)).requests.find((candidate) => candidate.id === id)
    if (!item) throw new Error('Unknown secret request')
    if (item.state !== 'pending') throw new Error('This request is no longer open')
    change(item)
    settled = JSON.parse(JSON.stringify(item)) as SecretRequest
  }, context)
  const caller = await host.harness().conversation(settled!.conversation as ConversationId, context)
  await caller?.submit(
    {
      type: 'input',
      content: resultText(settled!),
      entry: { kind: ResultEntry.kind, data: { request: id, state: settled!.state as Result['state'] } },
      whenBusy: 'steer',
      onAbort: 'keep',
      requestId: `secret-request:${id}`,
    },
    context,
  )
}

const requestArg = (args: unknown) => {
  const id = (args as { request?: unknown } | null)?.request
  if (typeof id !== 'string' || !/^[0-9a-f]{8}$/.test(id)) throw new Error('request must be a request id')
  return id
}

type Ctx = { host: Host }

export const userActions = ['submit', 'cancel']
export const actions = {
  async submit(args: unknown, { host }: Ctx) {
    const id = requestArg(args)
    const secrets = (args as { secrets?: unknown }).secrets
    if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) throw new Error('Expected values')
    const item = await find(host.harness(), id)
    if (!item) throw new Error('Unknown secret request')
    if (item.state !== 'pending') throw new Error('This request is no longer open')
    const values = secrets as Record<string, unknown>
    const names = item.fields.map((field) => field.name)
    if (Object.keys(values).sort().join('\0') !== [...names].sort().join('\0')) throw new Error('Fill in every key')
    for (const name of names) {
      const value = values[name]
      if (typeof value !== 'string' || !value || Buffer.byteLength(value) > MAX_VALUE || /[\0\r\n]/.test(value))
        throw new Error(`${name} must be one line, not empty, at most 16 KiB`)
    }
    const counts = await write(item.path, values as Record<string, string>)
    await settle(host, id, (stored) => {
      stored.state = 'saved'
      stored.counts = counts
    })
    return counts
  },
  async cancel(args: unknown, { host }: Ctx) {
    await settle(host, requestArg(args), (stored) => {
      stored.state = 'cancelled'
    })
    return null
  },
}

export default function secretRequest(host: Host) {
  const tool = defineTool({
    name: 'request_secret',
    replay: 'safe',
    description:
      'Ask the user for credentials of an external service or integration (API keys, tokens) without them pasting values into chat. ' +
      'Shows a masked form in the transcript; the values go from the browser straight into the dotenv file `path` (0600, other lines kept) and never reach you, the transcript or Ultimate Secrets. ' +
      '`path` rule: absolute, `~/…` or relative to the working directory, inside the home folder, and a file, not a folder (example: `~/my-app/.env`). ' +
      'Returns at once; the result (path, names, counts, never values) arrives as an input when the user saves or cancels: do not poll or wait. ' +
      'The request lives in the `secret-request.requests` document of root conversation 1 (not the calling conversation). `cancel_secret_request` closes your own pending one. ' +
      'Batch every key you know you need into one call. Read docs or `.env.example` for the names, never an existing secret-bearing file. ' +
      'Afterwards load the file where a command needs it (`set -a; . <path>; set +a; <command>`) and never print, cat or grep it. ' +
      "For keys Ultimate itself reads (an MCP server's `${NAME}`, an extension's declared secret) send the user to the Secrets panel (⌘K → Secrets) instead. " +
      'An MCP server can read this file only through a wrapper command such as `sh -c \'set -a; . <path>; exec <server>\'`.',
    parameters: obj({
      names: arr(str({ pattern: NAME.source }), { minItems: 1, maxItems: 20, uniqueItems: true, description: 'Environment variable names to ask for' }),
      purpose: str({ minLength: 1, maxLength: 200, description: 'One line telling the user why these are needed' }),
      path: str({ minLength: 1, description: 'Dotenv file to merge them into: absolute, ~/…, or relative to the working directory; must be inside the home folder and name a file, not a folder (example: ~/my-app/.env)' }),
      describe: opt(map(str({ maxLength: 200 }), { description: 'Optional one-line description per name: what the key is and where to get it' })),
    }),
    async execute(args, api, ctx) {
      for (const name of Object.keys(args.describe ?? {}))
        if (!args.names.includes(name)) throw new Error(`describe names ${name}, which is not requested`)
      const path = await target(host.userHome, api.env?.cwd ?? host.userHome, args.path.trim())
      const existing = await lstat(path).catch(() => undefined)
      if (existing?.isSymbolicLink()) throw new Error(`${path} is a symlink; point the request at the real file`)
      if (existing?.isFile()) checkShape(await readFile(path, 'utf8'), args.names)
      const item = await api.commit(async (tx) => {
        const state = await tx.doc(Requests, ROOT_CONVERSATION_ID)
        const known = state.requests.find((candidate) => candidate.conversation === api.conversationId && candidate.call === api.callId)
        if (known) return JSON.parse(JSON.stringify(known)) as SecretRequest
        const created: SecretRequest = {
          id: randomBytes(4).toString('hex'),
          conversation: api.conversationId,
          call: api.callId,
          purpose: args.purpose.trim(),
          path,
          fields: args.names.map((name) => ({ name, ...(args.describe?.[name] ? { description: args.describe[name]!.trim() } : {}) })),
          state: 'pending',
          at: Date.now(),
        }
        state.requests.push(created)
        return JSON.parse(JSON.stringify(created)) as SecretRequest
      }, ctx)
      await api.details({ request: item.id }, ctx)
      return {
        output: [
          {
            type: 'text',
            text: `Asked the user for ${args.names.join(', ')} (request ${item.id}), to be written to ${path}. The result arrives as an input when they save or cancel; do not poll, and do not ask them to paste values into chat.`,
          },
        ],
        details: { request: item.id },
      }
    },
  })
  const cancel = defineTool({
    name: 'cancel_secret_request',
    replay: 'safe',
    description:
      'Close a pending `request_secret` request of this conversation (for example a duplicate) without writing anything. The user still saves or cancels through the card; this is for clearing requests you no longer need.',
    parameters: obj({ request: str({ pattern: '^[0-9a-f]{8}$', description: 'Request id from request_secret' }) }),
    async execute(args, api) {
      const item = await find(host.harness(), args.request)
      if (!item || item.conversation !== api.conversationId) throw new Error('Unknown secret request of this conversation')
      await settle(host, args.request, (stored) => {
        stored.state = 'cancelled'
      })
      return { output: [{ type: 'text', text: `Request ${args.request} cancelled.` }] }
    },
  })
  return defineExtension({ name: 'secret-request', tools: [tool, cancel] })
}
