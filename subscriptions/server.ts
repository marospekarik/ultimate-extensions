/**
 * Keeps the account's subscription usage current for the whole machine. Claude's numbers come from the responses
 * Ultimate already stores and, between turns, from Anthropic's usage endpoint with the `claude` CLI's login; ChatGPT's
 * Codex windows from the endpoint the Codex CLI's `/status` reads, with Pi's ChatGPT login; Ollama's from its API with
 * the key the user added once. The `subscriptions.plans` setting picks which are shown and polled.
 */
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { defineExtension } from '@earendil-works/pi-durable'
import type { CommitPublication, Harness } from '@earendil-works/pi-durable'
import { credentialsPath, fetchClaude, notes, report, windows } from './anthropic.ts'
import { fetchCodex } from './codex.ts'
import { fetchOllama } from './ollama.ts'
import { peak } from './peak.ts'
import { change, read } from './store.ts'
import type { Stored } from './store.ts'
import { secret } from './secret.ts'
import type { Plan, Usage, UsageWindow } from './refs.ts'

const KEY = 'OLLAMA_API_KEY'
/** Pi's ChatGPT login, the one voice transcribes with and Codex models run on. */
const LOGIN = 'openai-codex'
const MINUTE = 60_000
/** Ollama allows 10 requests a minute per account, shared by every key and device; a reading every five is plenty. */
const POLL = 5 * MINUTE
/** A click never asks sooner than this. */
const FLOOR = 20_000
/**
 * Claude's reading, from either source, is renewed in the background once it is this old. Anthropic's usage endpoint
 * answers about five requests per access token before it 429s for a quarter hour or more
 * (https://github.com/anthropics/claude-code/issues/31637; here on 2026-11-13 after a few card openings in 25 min), and
 * every Claude Code turn brings a free reading, so the endpoint only covers long quiet stretches.
 */
const CLAUDE_POLL = 30 * MINUTE
/** Opening Claude's card asks the endpoint only when the newest reading or attempt is older than this. */
const CLAUDE_FRESH = 5 * MINUTE
/** The longest wait after a 429 that names no `Retry-After`. */
const BACKOFF_MAX = 60 * MINUTE
export const secrets = [
  {
    name: KEY,
    description: 'Ollama Cloud API key, for cloud usage, balance and credits',
    url: 'https://ollama.com/settings/keys',
  },
]

type Host = {
  userHome: string
  harness(): Harness
  onOpen(run: () => Promise<void>): void
  onClose(run: () => Promise<void>): void
  /** The project's `.ultimate/settings.json`, or nothing while the project's setup is not trusted. */
  projectSettings(): Promise<Record<string, unknown>>
  /** Pi's logins: `getAuth` hands back the ChatGPT login's access token, refreshed by Pi under its store lock. */
  modelRuntime: {
    getProviderAuthStatus(provider: string): { configured: boolean }
    getAuth(provider: string): Promise<{ auth: { apiKey?: string } } | undefined>
  }
}

type PlanId = Plan['id']
/** Every plan, in sidebar order when the setting does not name one. */
const PLANS: PlanId[] = ['claude', 'ollama', 'codex']

async function userSettings(userHome: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(join(userHome, '.ultimate/settings.json'), 'utf8')) as Record<string, unknown>
  } catch {
    // No file, or one the host reports itself: the setting is simply not given here.
    return {}
  }
}

/** `subscriptions.plans`, the project's over the user's; undefined when neither names it. */
async function chosen(host: Host): Promise<PlanId[] | undefined> {
  let plans: PlanId[] | undefined
  for (const layer of [await userSettings(host.userHome), await host.projectSettings()]) {
    const value = (layer.subscriptions as { plans?: unknown } | undefined)?.plans
    if (Array.isArray(value)) plans = PLANS.filter((id) => value.includes(id)).toSorted((a, b) => value.indexOf(a) - value.indexOf(b))
  }
  return plans
}

/** Which credentials this machine has: Ollama's key and Pi's ChatGPT login. */
async function credentials(host: Host) {
  return {
    keyed: (await secret(host.userHome, KEY)) !== undefined,
    login: host.modelRuntime.getProviderAuthStatus(LOGIN).configured,
  }
}

/** The plans shown and polled: those the setting names, else those with a credential (or a reading) here. */
async function visible(host: Host, state: Stored, found: { keyed: boolean; login: boolean }): Promise<PlanId[]> {
  const named = await chosen(host)
  if (named) return named
  const claude = state.claude !== undefined || (await access(credentialsPath(host.userHome)).then(() => true, () => false))
  return PLANS.filter((id) => (id === 'claude' ? claude : id === 'ollama' ? found.keyed : found.login))
}

let fetching: Promise<void> | undefined
let askedAt = 0
/** Reads and writes of the shared file run one at a time, so an older report can never land after a newer one. */
let writing: Promise<unknown> = Promise.resolve()

function record(host: Host, apply: (state: Stored) => void): Promise<unknown> {
  writing = writing
    .then(() => change(host.userHome, apply))
    .catch(() => {
      // A lost write costs nothing: the next response or reading carries newer numbers.
    })
  return writing
}

/**
 * After a 429: the provider's `Retry-After`, or a backoff that doubles from the last wait. Anthropic's usage endpoint
 * answers its 429s with `Retry-After: 0` (seen 2026-11-13), which would never back off, so 0 counts as no header.
 */
const backoff = (retryAfter: number | undefined, last: { wait?: number } | undefined, first: number) =>
  retryAfter || (last?.wait ? Math.min(BACKOFF_MAX, last.wait * 2) : first)

type Failed = { ok: false; problem: string; limited?: boolean; retryAfter?: number }

/** Stores a polled plan's answer: a newer good reading replaces the stored one, a failure keeps it with its reason. */
function keep<P extends 'ollama' | 'codex'>(
  host: Host,
  plan: P,
  result: { ok: true; snapshot: NonNullable<Stored[P]> } | Failed,
) {
  const problem = `${plan}Problem` as const
  return record(host, (state) => {
    if (result.ok) {
      // Every project's process polls; a slower answer must not replace a newer one another process stored.
      if ((state[plan]?.at ?? 0) > result.snapshot.at) return
      state[plan] = result.snapshot
      delete state[problem]
      return
    }
    const wait = result.limited ? backoff(result.retryAfter, state[problem], MINUTE) : undefined
    state[problem] = {
      at: Date.now(),
      problem: result.problem,
      ...(wait === undefined ? {} : { until: Date.now() + wait, wait }),
    }
  })
}

/**
 * Asks Ollama now (at most once every 20 s, and not while a 429's wait runs) and keeps the last good reading when the
 * request fails.
 */
function ask(host: Host): Promise<void> {
  if (fetching) return fetching
  if (Date.now() - askedAt < FLOOR) return Promise.resolve()
  fetching = (async () => {
    const key = await secret(host.userHome, KEY)
    if (!key) return
    const until = (await read(host.userHome)).ollamaProblem?.until
    if (until !== undefined && Date.now() < until) return
    askedAt = Date.now()
    await keep(host, 'ollama', await fetchOllama(key))
  })()
    .catch(() => {
      // An unreachable endpoint is shown by what is stored: the card keeps the last reading and its age.
    })
    .finally(() => {
      fetching = undefined
    })
  return fetching
}

let codexFetching: Promise<void> | undefined
let codexAskedAt = 0

/**
 * Asks ChatGPT for the Codex windows like Ollama: at most once every 20 s, not while a 429's wait runs. The login's
 * access token comes from Pi, as voice gets it, for this one request; it is never returned, logged or stored here.
 */
function askCodex(host: Host): Promise<void> {
  if (codexFetching) return codexFetching
  if (Date.now() - codexAskedAt < FLOOR) return Promise.resolve()
  codexFetching = (async () => {
    if (!host.modelRuntime.getProviderAuthStatus(LOGIN).configured) return
    const until = (await read(host.userHome)).codexProblem?.until
    if (until !== undefined && Date.now() < until) return
    codexAskedAt = Date.now()
    const token = await host.modelRuntime.getAuth(LOGIN).then(
      (found) => found?.auth.apiKey,
      () => undefined,
    )
    await keep(
      host,
      'codex',
      token ? await fetchCodex(token) : { ok: false, problem: 'ChatGPT login unreadable — sign in with ChatGPT again' },
    )
  })()
    .catch(() => {
      // An unreachable endpoint is shown by what is stored: the card keeps the last reading and its age.
    })
    .finally(() => {
      codexFetching = undefined
    })
  return codexFetching
}

let claudeFetching: Promise<void> | undefined

/**
 * Asks Anthropic's usage endpoint when Claude's newest reading or attempt, from either source and any process, is older
 * than the poll (or, on a click, than five minutes). Every process on the machine shares the stored reading, so a fresh
 * turn or another project's request spares this one; a 429's wait holds for clicks too.
 */
function askClaude(host: Host, click: boolean): Promise<void> {
  if (claudeFetching) return claudeFetching
  claudeFetching = (async () => {
    const state = await read(host.userHome)
    const now = Date.now()
    const problem = state.claudeProblem
    if (problem?.until !== undefined && now < problem.until) return
    if (now - Math.max(state.claude?.at ?? 0, problem?.at ?? 0) < (click ? CLAUDE_FRESH : CLAUDE_POLL)) return
    const result = await fetchClaude(host.userHome)
    await record(host, (state) => {
      if (result.ok) {
        if (!state.claude || result.at > state.claude.at)
          state.claude = { at: result.at, info: result.info }
        delete state.claudeProblem
        return
      }
      const wait = result.limited ? backoff(result.retryAfter, state.claudeProblem, CLAUDE_POLL) : undefined
      state.claudeProblem = {
        at: Date.now(),
        problem: result.problem,
        ...(wait === undefined ? {} : { until: Date.now() + wait, wait }),
      }
    })
  })()
    .catch(() => {
      // A failed read or write keeps the stored reading; the next tick asks again.
    })
    .finally(() => {
      claudeFetching = undefined
    })
  return claudeFetching
}

/**
 * Asks each shown plan whose reading is older than the poll, or every shown one when `due`; only plans the setting shows
 * are ever polled.
 */
function poll(host: Host, state: Stored, shown: PlanId[], due = false) {
  const stale = (at: number | undefined) => due || Date.now() - (at ?? 0) > POLL
  if (shown.includes('ollama') && stale(state.ollama?.at)) void ask(host)
  if (shown.includes('codex') && stale(state.codex?.at)) void askCodex(host)
}

/** The shown plans as they stand now. */
async function plans(host: Host): Promise<Usage> {
  const state = await read(host.userHome)
  const found = await credentials(host)
  const shown = await visible(host, state, found)
  // A reading older than the poll interval is refreshed in the background; the card shows what is known meanwhile.
  poll(host, state, shown)
  return assemble(state, shown, found)
}

/**
 * A window whose reset has passed starts again from nothing. The stored share is from before it: Claude's only moves
 * with the next response, Ollama's with the next poll, so until then it shows 0%, not the old number.
 */
function settle(found: UsageWindow[], now: number): UsageWindow[] {
  return found.map((window) =>
    window.resetsAt !== undefined && window.resetsAt <= now ? { ...window, used: 0 } : window,
  )
}

/**
 * A stored problem as the card says it. A 429 (it carries a `wait`) is the usage endpoint declining to be asked so often,
 * not the plan running out, so it reads as a pause of the check rather than a fault.
 */
const said = (problem: { problem: string; wait?: number }) =>
  problem.wait === undefined ? { problem: problem.problem } : { problem: 'usage check paused', paused: true }

/** The stored readings as the plans the UI shows, in the setting's order, with Ollama's peak window at this moment. */
export function assemble(
  state: Stored,
  shown: PlanId[],
  { keyed, login }: { keyed: boolean; login: boolean },
  now = Date.now(),
): Usage {
  const claude: Plan = {
    id: 'claude',
    name: 'Claude Pro',
    detail: 'subscription',
    windows: state.claude ? settle(windows(state.claude.info), now) : [],
    notes: state.claude ? notes(state.claude.info) : [],
    ...(state.claude ? { at: state.claude.at } : {}),
    // A problem older than the reading is over: a turn or another process brought newer numbers since.
    ...(state.claudeProblem && state.claudeProblem.at > (state.claude?.at ?? 0) ? said(state.claudeProblem) : {}),
    ...(state.claudeProblem?.until !== undefined && state.claudeProblem.until > now
      ? { retryAt: state.claudeProblem.until }
      : {}),
  }
  const ollama: Plan = {
    id: 'ollama',
    name: 'Ollama Cloud',
    detail: 'subscription',
    windows: settle(state.ollama?.windows ?? [], now),
    notes: state.ollama?.notes ?? [],
    ...(state.ollama ? { at: state.ollama.at } : {}),
    ...(state.ollama?.credits ? { credits: state.ollama.credits } : {}),
    ...(state.ollama?.today ? { today: state.ollama.today } : {}),
    ...(keyed && state.ollamaProblem && state.ollamaProblem.at > (state.ollama?.at ?? 0)
      ? said(state.ollamaProblem)
      : {}),
    ...(state.ollamaProblem?.until !== undefined && state.ollamaProblem.until > now
      ? { retryAt: state.ollamaProblem.until }
      : {}),
    ...(keyed ? {} : { setup: 'add key' }),
  }
  const codex: Plan = {
    id: 'codex',
    name: 'ChatGPT · Codex',
    // ChatGPT's own word for the plan: `free`, `plus`, `pro`, `team`…
    detail: state.codex ? `${state.codex.plan} plan` : 'subscription',
    windows: settle(state.codex?.windows ?? [], now),
    notes: state.codex?.notes ?? [],
    ...(state.codex ? { at: state.codex.at } : {}),
    ...(login && state.codexProblem && state.codexProblem.at > (state.codex?.at ?? 0) ? said(state.codexProblem) : {}),
    ...(state.codexProblem?.until !== undefined && state.codexProblem.until > now
      ? { retryAt: state.codexProblem.until }
      : {}),
    ...(login ? {} : { setup: 'sign in' }),
  }
  const all = { claude, ollama, codex }
  return { plans: shown.map((id) => all[id]), peak: peak(now) }
}

export const actions = {
  async usage(_args: unknown, context: { host: Host }) {
    return plans(context.host)
  },
  /** Opening a plan's card asks that plan's provider; the floor and a 429's wait still hold. Hidden plans are not asked. */
  async refresh(args: { plan?: PlanId } | null, context: { host: Host }) {
    const host = context.host
    const shown = await visible(host, await read(host.userHome), await credentials(host))
    const asked = (id: PlanId) => shown.includes(id) && (args?.plan === undefined || args.plan === id)
    await Promise.all([
      asked('ollama') ? ask(host) : undefined,
      asked('claude') ? askClaude(host, true) : undefined,
      asked('codex') ? askCodex(host) : undefined,
    ])
    return plans(host)
  },
}

export default function subscriptions(host: Host) {
  let stop: (() => void) | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let claudeTimer: ReturnType<typeof setInterval> | undefined
  let epoch = 0

  const halt = () => {
    epoch++
    clearInterval(timer)
    clearInterval(claudeTimer)
    timer = undefined
    claudeTimer = undefined
    stop?.()
    stop = undefined
  }

  host.onClose(async () => halt())
  host.onOpen(async () => {
    halt()
    const opened = epoch
    // Anthropic's report rides on every Claude Code response, so a commit is a free update; the poll covers the rest.
    const observation = host.harness().observeCommits({
      advance(publication: CommitPublication) {
        for (const written of publication.changes) {
          if (written.type !== 'entry' || written.value.kind !== 'pi.assistant') continue
          const found = report(written.value)
          if (!found) continue
          void record(host, (state) => {
            if (!state.claude || found.at > state.claude.at) state.claude = found
          })
        }
      },
      end() {},
    })
    if (opened !== epoch) {
      observation.detach()
      return
    }
    stop = () => observation.detach()
    const tick = () =>
      void (async () => {
        const state = await read(host.userHome)
        poll(host, state, await visible(host, state, await credentials(host)), true)
      })().catch(() => {
        // Unreadable settings or secrets: the next tick tries again.
      })
    tick()
    timer = setInterval(tick, POLL)
    // Checks every minute whether Claude's reading is old enough to ask again, while its row is shown.
    const claudeShown = async () =>
      (await visible(host, await read(host.userHome), await credentials(host))).includes('claude')
    const minute = () =>
      void claudeShown().then(
        (shown) => (shown ? askClaude(host, false) : undefined),
        () => undefined,
      )
    minute()
    claudeTimer = setInterval(minute, MINUTE)
  })
  return defineExtension({ name: 'subscriptions' })
}
