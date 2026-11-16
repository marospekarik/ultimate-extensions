/**
 * Claude Pro's numbers, as Anthropic reports them, from two sources. Every Claude Code turn ends with a
 * `rate_limit_event`, and pi-claude-code attaches its `rate_limit_info` to the response as a `claude-code.rate-limit`
 * diagnostic (`@earendil-works/pi-claude-code/ARCHITECTURE.md`, "Usage-credit guard"): free, but only as new as the
 * last turn here. Between turns, and for usage from the user's other Claude clients, the extension asks the endpoint
 * the `claude` CLI's `/usage` reads, `GET https://api.anthropic.com/api/oauth/usage`, with the CLI login's OAuth token.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EntryRecord } from '@earendil-works/pi-durable'
import type { UsageWindow } from './refs.ts'

type Window = { utilization?: number; resetsAt?: number; status?: string }

/** The parts of `rate_limit_info` this extension reads; the rest is Anthropic's to change. */
export type RateLimitInfo = {
  unifiedWindows?: Record<string, Window>
  overageStatus?: string
  overageDisabledReason?: string
  isUsingOverage?: boolean
}

const labels: Record<string, string> = {
  five_hour: '5h',
  seven_day: 'week',
  seven_day_opus: 'week Opus',
  seven_day_sonnet: 'week Sonnet',
}

/** A short label for one of Anthropic's window keys; an unknown one keeps its own words. */
export function label(key: string) {
  if (labels[key]) return labels[key]
  if (key.endsWith('_opus')) return 'week Opus'
  if (key.endsWith('_sonnet')) return 'week Sonnet'
  return key.replaceAll('_', ' ')
}

/** The windows one report carries, in Anthropic's order: session first, then weeks. */
export function windows(info: RateLimitInfo): UsageWindow[] {
  const order = (key: string) => (key === 'five_hour' ? 0 : 1)
  return Object.entries(info.unifiedWindows ?? {})
    .filter(([, window]) => typeof window?.utilization === 'number')
    .toSorted(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([key, window]) => ({
      key,
      label: label(key),
      used: Math.min(1, Math.max(0, window.utilization!)),
      ...(typeof window.resetsAt === 'number' ? { resetsAt: window.resetsAt * 1000 } : {}),
    }))
}

/** What the plan does at its limit, which the report also says. */
export function notes(info: RateLimitInfo): string[] {
  if (info.isUsingOverage) return ['usage credits on — over the plan, this bills']
  if (info.overageDisabledReason === 'org_level_disabled')
    return ['usage credits off — at the limit the run stops']
  if (info.overageStatus === 'rejected') return ['usage credits off — at the limit the run stops']
  return []
}

/** One window of the usage endpoint: `utilization` in percent, `resets_at` as an ISO time. */
type Bucket = { utilization?: number | null; resets_at?: string | null }

/**
 * The usage endpoint's answer in the diagnostic's shape, so both sources are stored and shown alike. Its window keys
 * are the diagnostic's (`five_hour`, `seven_day`, `seven_day_opus`…); every other key, and windows that are null, are
 * left out.
 */
export function fromUsage(body: Record<string, unknown>): RateLimitInfo {
  const unifiedWindows: Record<string, Window> = {}
  for (const [key, value] of Object.entries(body)) {
    if (key !== 'five_hour' && !key.startsWith('seven_day')) continue
    const bucket = value as Bucket | null
    if (typeof bucket?.utilization !== 'number') continue
    const reset = bucket.resets_at ? Date.parse(bucket.resets_at) : Number.NaN
    unifiedWindows[key] = {
      utilization: bucket.utilization / 100,
      ...(Number.isFinite(reset) ? { resetsAt: Math.round(reset / 1000) } : {}),
    }
  }
  const extra = body.extra_usage as { is_enabled?: boolean } | null | undefined
  return { unifiedWindows, ...(extra?.is_enabled === false ? { overageStatus: 'rejected' } : {}) }
}

export type Fetched =
  | { ok: true; at: number; info: RateLimitInfo }
  | { ok: false; problem: string; limited?: boolean; retryAfter?: number }

const USAGE = 'https://api.anthropic.com/api/oauth/usage'

/** The CLI keeps its login here on Linux; CLAUDE_CONFIG_DIR moves it, as it moves the CLI's. */
export const credentialsPath = (userHome: string) =>
  join(process.env.CLAUDE_CONFIG_DIR ?? join(userHome, '.claude'), '.credentials.json')
const EXPIRED = 'login expired — open Claude Code once to refresh its login'

/** `Retry-After` in ms, from seconds or an HTTP date. */
export function retryAfter(header: string | null, now: number) {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(header)
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined
}

/**
 * Asks Anthropic for the account's windows with the `claude` CLI's login. The token is read for this one request and
 * never returned, logged or stored. An expired token is not refreshed here: a refresh rotates the CLI's login, which
 * the CLI owns, so the card asks the user to open Claude Code instead.
 */
export async function fetchClaude(userHome: string, now = Date.now()): Promise<Fetched> {
  const path = credentialsPath(userHome)
  let login: { accessToken?: string; expiresAt?: number } | undefined
  try {
    login = (JSON.parse(await readFile(path, 'utf8')) as { claudeAiOauth?: typeof login })
      .claudeAiOauth
  } catch {
    // No readable login: the card says so and keeps what the responses reported.
    return { ok: false, problem: 'no Claude Code login on this machine' }
  }
  if (!login?.accessToken) return { ok: false, problem: 'no Claude Code login on this machine' }
  if (typeof login.expiresAt === 'number' && login.expiresAt <= now)
    return { ok: false, problem: EXPIRED }
  let response: Response
  try {
    response = await fetch(USAGE, {
      headers: {
        authorization: `Bearer ${login.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    })
  } catch (error) {
    return {
      ok: false,
      problem:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'api.anthropic.com did not answer'
          : 'api.anthropic.com unreachable',
    }
  }
  if (response.status === 401) return { ok: false, problem: EXPIRED }
  if (response.status === 429) {
    const wait = retryAfter(response.headers.get('retry-after'), now)
    return {
      ok: false,
      problem: 'rate limited by Anthropic',
      limited: true,
      ...(wait === undefined ? {} : { retryAfter: wait }),
    }
  }
  if (!response.ok) return { ok: false, problem: `api.anthropic.com answered ${response.status}` }
  const info = fromUsage((await response.json()) as Record<string, unknown>)
  if (!Object.keys(info.unifiedWindows ?? {}).length)
    return { ok: false, problem: 'usage report had no windows' }
  return { ok: true, at: now, info }
}

/** The newest rate-limit report a stored response carries, and when Anthropic sent it. */
export function report(entry: EntryRecord): { at: number; info: RateLimitInfo } | undefined {
  let found: { at: number; info: RateLimitInfo } | undefined
  for (const message of entry.model ?? []) {
    for (const diagnostic of 'diagnostics' in message ? (message.diagnostics ?? []) : []) {
      if (diagnostic.type !== 'claude-code.rate-limit' || !diagnostic.details) continue
      const info = diagnostic.details as RateLimitInfo
      if (!info.unifiedWindows) continue
      if (!found || diagnostic.timestamp > found.at) found = { at: diagnostic.timestamp, info }
    }
  }
  return found
}
