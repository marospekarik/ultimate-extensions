/**
 * ChatGPT's Codex usage, from the endpoint the Codex CLI's `/status` reads: `GET https://chatgpt.com/backend-api/wham/usage`
 * with the ChatGPT login's access token and its `chatgpt-account-id` (openai/codex, `codex-rs/backend-client`
 * `rate_limit_status_url`; the fields are `codex-backend-openapi-models` `RateLimitStatusPayload`). It answers the plan
 * (`plan_type`) and up to two windows, `rate_limit.primary_window` and `secondary_window`, each with `used_percent`,
 * `limit_window_seconds` and `reset_at` (Unix seconds): a paid plan's 5 hours and week, a free plan's 30 days.
 */
import { retryAfter } from './anthropic.ts'
import type { UsageWindow } from './refs.ts'

/** What a successful reading of the account holds. */
export type Snapshot = { at: number; plan: string; windows: UsageWindow[]; notes: string[] }

export type Result =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; problem: string; limited?: boolean; retryAfter?: number }

const USAGE = 'https://chatgpt.com/backend-api/wham/usage'
/** Where the access token carries the ChatGPT account, as Pi's openai-codex provider reads it. */
const CLAIM = 'https://api.openai.com/auth'

type Window = { used_percent?: number; limit_window_seconds?: number; reset_at?: number } | null

/** A window's length as a short label: `5h`, `week`, `month`, or its hours or days. */
export function label(seconds: number | undefined) {
  if (!seconds) return 'window'
  const hours = Math.round(seconds / 3600)
  if (hours === 168) return 'week'
  if (hours >= 28 * 24 && hours <= 31 * 24) return 'month'
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

/** The windows one answer carries, primary first. */
export function windows(body: Record<string, unknown>): UsageWindow[] {
  const limit = (body.rate_limit ?? {}) as { primary_window?: Window; secondary_window?: Window }
  const found: UsageWindow[] = []
  for (const [key, window] of [
    ['primary', limit.primary_window],
    ['secondary', limit.secondary_window],
  ] as const) {
    if (typeof window?.used_percent !== 'number') continue
    found.push({
      key,
      label: label(window.limit_window_seconds),
      used: Math.min(1, Math.max(0, window.used_percent / 100)),
      ...(typeof window.reset_at === 'number' ? { resetsAt: window.reset_at * 1000 } : {}),
    })
  }
  return found
}

/** What the plan does at its limit, and credit beyond it, as the answer says. */
export function notes(body: Record<string, unknown>): string[] {
  const limit = body.rate_limit as { limit_reached?: boolean } | null | undefined
  const credits = body.credits as { has_credits?: boolean; unlimited?: boolean; balance?: string | null } | null
  const found: string[] = []
  if (limit?.limit_reached) found.push('limit reached — Codex waits for the reset')
  if (credits?.unlimited) found.push('unlimited credits')
  else if (credits?.has_credits && credits.balance) found.push(`${credits.balance} credits beyond the plan`)
  return found
}

/** The ChatGPT account the access token belongs to, read from its claims without verifying them. */
export function account(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))
    const id = payload?.[CLAIM]?.chatgpt_account_id
    return typeof id === 'string' && id ? id : undefined
  } catch {
    // Not a JWT: the request goes without the header and ChatGPT says whether it minds.
    return undefined
  }
}

/** Asks ChatGPT for the account's Codex windows with one access token, used for this request only. */
export async function fetchCodex(token: string, now = Date.now()): Promise<Result> {
  const id = account(token)
  let response: Response
  try {
    response = await fetch(USAGE, {
      headers: {
        authorization: `Bearer ${token}`,
        ...(id ? { 'chatgpt-account-id': id } : {}),
        accept: 'application/json',
        'user-agent': 'codex-cli',
      },
      signal: AbortSignal.timeout(8000),
    })
  } catch (error) {
    return {
      ok: false,
      problem:
        error instanceof Error && error.name === 'TimeoutError' ? 'chatgpt.com did not answer' : 'chatgpt.com unreachable',
    }
  }
  if (response.status === 401) return { ok: false, problem: 'ChatGPT refused the login — sign in with ChatGPT again' }
  if (response.status === 429) {
    const wait = retryAfter(response.headers.get('retry-after'), now)
    return {
      ok: false,
      problem: 'rate limited by ChatGPT',
      limited: true,
      ...(wait === undefined ? {} : { retryAfter: wait }),
    }
  }
  if (!response.ok) return { ok: false, problem: `chatgpt.com answered ${response.status}` }
  let body: Record<string, unknown>
  try {
    body = (await response.json()) as Record<string, unknown>
  } catch {
    // A challenge page or an outage answered with HTML.
    return { ok: false, problem: 'chatgpt.com answered without a usage report' }
  }
  const plan = typeof body.plan_type === 'string' ? body.plan_type : 'unknown'
  return { ok: true, snapshot: { at: now, plan, windows: windows(body), notes: notes(body) } }
}
