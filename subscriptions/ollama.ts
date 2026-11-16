/**
 * Ollama Cloud's own numbers, from `api/balance` and `api/usage` (https://docs.ollama.com/api/balance,
 * https://docs.ollama.com/api/cloud-usage). A legacy Pro or Max plan answers the balance with its session and weekly
 * windows (`included.session|weekly.remaining_percent`), and the usage with request counts only; a credit plan answers
 * with included dollars and the usage with dollars and tokens. Both shapes are read, as the docs describe them.
 */
import { retryAfter } from './anthropic.ts'
import type { Credits, Today, UsageWindow } from './refs.ts'

/** What a successful reading of the account holds. */
export type Snapshot = {
  at: number
  windows: UsageWindow[]
  credits?: Credits
  today?: Today
  notes: string[]
}

export type Result =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; problem: string; limited?: boolean; retryAfter?: number }

const USAGE = 'https://ollama.com/api/usage?range=24h'
const BALANCE = 'https://ollama.com/api/balance'

type Limit = { remaining_percent?: number; resets_at?: string }
type Answer =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; wait?: number; reason?: string }

const unreachable = (error: unknown) =>
  error instanceof Error && error.name === 'TimeoutError' ? 'ollama.com did not answer' : 'ollama.com unreachable'

async function call(url: string, key: string, now: number): Promise<Answer> {
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (response.ok) return { ok: true, body: (await response.json()) as Record<string, unknown> }
    const wait = retryAfter(response.headers.get('retry-after'), now)
    return { ok: false, status: response.status, ...(wait === undefined ? {} : { wait }) }
  } catch (error) {
    return { ok: false, status: 0, reason: unreachable(error) }
  }
}

/** A legacy window's share used, 0–1, from the share Ollama says remains. */
const used = (limit: Limit | undefined) =>
  typeof limit?.remaining_percent === 'number'
    ? Math.min(1, Math.max(0, 1 - limit.remaining_percent / 100))
    : undefined

const reset = (limit: Limit | undefined) => {
  const at = limit?.resets_at ? Date.parse(limit.resets_at) : Number.NaN
  return Number.isFinite(at) ? { resetsAt: at } : {}
}

/** The windows a legacy Pro or Max plan reports in its balance: a session and a week. */
export function windows(balance: Record<string, unknown>): UsageWindow[] {
  const included = (balance.included ?? {}) as { session?: Limit; weekly?: Limit }
  const found: UsageWindow[] = []
  const session = used(included.session)
  if (session !== undefined)
    found.push({ key: 'session', label: '5h', used: session, cycle: 'every 5 h', ...reset(included.session) })
  const weekly = used(included.weekly)
  if (weekly !== undefined)
    found.push({ key: 'weekly', label: 'week', used: weekly, cycle: 'every 7 days', ...reset(included.weekly) })
  return found
}

/** A credit plan's included dollars, and purchased credit on any plan. */
function money(balance: Record<string, unknown>): { credits?: Credits; notes: string[] } {
  const included = (balance.included ?? {}) as {
    balance_usd?: number
    allowance_usd?: number
    period?: { until?: string }
  }
  const purchased = (balance.purchased ?? {}) as { balance_usd?: number }
  const notes =
    typeof purchased.balance_usd === 'number' && purchased.balance_usd > 0
      ? [`plus $${purchased.balance_usd.toFixed(2)} purchased credit`]
      : []
  if (typeof included.balance_usd !== 'number') return { notes }
  const until = included.period?.until ? Date.parse(included.period.until) : Number.NaN
  return {
    credits: {
      left: included.balance_usd,
      ...(typeof included.allowance_usd === 'number' ? { total: included.allowance_usd } : {}),
      ...(Number.isFinite(until) ? { until } : {}),
    },
    notes,
  }
}

/** The last 24 hours: requests always; dollars and tokens only where the plan records them (not on legacy plans). */
function day(usage: Record<string, unknown>): Today | undefined {
  const totals = (usage.totals ?? {}) as Record<string, number | undefined>
  if (typeof totals.request_count !== 'number') return undefined
  const optional = (name: 'usd' | 'input' | 'cached' | 'output', value: number | undefined) =>
    typeof value === 'number' ? { [name]: value } : {}
  return {
    requests: totals.request_count,
    ...optional('usd', totals.usage_usd),
    ...optional('input', totals.input_tokens),
    ...optional('cached', totals.cached_input_tokens),
    ...optional('output', totals.output_tokens),
  }
}

function failed(answer: Extract<Answer, { ok: false }>): Extract<Result, { ok: false }> {
  if (answer.status === 401) return { ok: false, problem: 'key rejected — paste a current one' }
  if (answer.status === 429)
    return {
      ok: false,
      problem: 'rate limited by ollama.com',
      limited: true,
      ...(answer.wait === undefined ? {} : { retryAfter: answer.wait }),
    }
  return { ok: false, problem: answer.reason ?? `ollama.com answered ${answer.status}` }
}

/** Asks Ollama for the account's balance (the windows or credits) and last day, and says why when it cannot. */
export async function fetchOllama(key: string, now = Date.now()): Promise<Result> {
  const [balance, usage] = await Promise.all([call(BALANCE, key, now), call(USAGE, key, now)])
  // The balance carries the plan's limits; without it there is nothing to show but the day, so it decides.
  if (!balance.ok) return failed(balance)
  const found = windows(balance.body)
  const paid = money(balance.body)
  const spent = usage.ok ? day(usage.body) : undefined
  return {
    ok: true,
    snapshot: {
      at: now,
      windows: found,
      ...(paid.credits ? { credits: paid.credits } : {}),
      ...(spent ? { today: spent } : {}),
      notes: [
        ...paid.notes,
        ...(found.length || paid.credits ? [] : ['the balance named no windows or credits']),
        ...(usage.ok ? [] : ['last 24 h unavailable']),
      ],
    },
  }
}
