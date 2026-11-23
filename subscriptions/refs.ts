/** Subscription usage: Claude Pro's, ChatGPT Codex's and Ollama Cloud's windows, credits and peak hours. Browser-safe. */
import { actionRef } from '@/sdk/solid'

/** One usage window a provider reports, such as a 5-hour session or a week. */
export type UsageWindow = {
  /** The provider's own key, `five_hour` or `session`. */
  key: string
  /** Short label: `5h`, `week`, `week Opus`. */
  label: string
  /** Share used, 0–1. */
  used: number
  /** When it resets (ms), when the provider says exactly. */
  resetsAt?: number
  /** How often it resets, when it does not say exactly (`every 5 h`). */
  cycle?: string
}

/** Included credit left on a plan that counts dollars, such as Ollama's month. */
export type Credits = { left: number; total?: number; until?: number }

/** What a provider recorded for the last 24 hours; Ollama's legacy plans record only the requests. */
export type Today = { requests: number; usd?: number; input?: number; cached?: number; output?: number }

export type Plan = {
  id: 'claude' | 'codex' | 'ollama'
  name: string
  /** What the plan is, under the name. */
  detail: string
  windows: UsageWindow[]
  /** When these numbers were true (ms); absent while nothing is known. */
  at?: number
  notes: string[]
  credits?: Credits
  today?: Today
  /** Why there are no numbers, when that is known: no key, a rejected key, an unreachable endpoint. */
  problem?: string
  /** The problem is a 429's pause of the usage check, not a fault: the card shows it muted. */
  paused?: boolean
  /** After a 429, when the provider may be asked again (ms). */
  retryAt?: number
  /** What the row says instead of a reading while the plan has no credential here: `add key`, `sign in`. */
  setup?: string
}

/** Ollama's peak window: usage costs twice as much inside it. */
export type Peak = { on: boolean; until?: number; from?: number }

/** The plans the `subscriptions.plans` setting shows (or, without it, those with a credential here), in sidebar order. */
export type Usage = { plans: Plan[]; peak: Peak }

/** The shown plans as they stand now; asks for nothing when nothing new is known. */
export const UsageAction = actionRef<null, Usage>('subscriptions', 'usage')

/**
 * Asks the provider again (one plan, or every shown one without one), then returns the shown plans. Ollama and ChatGPT
 * at most every 20 s, Claude only when its newest reading is five minutes old, and none while a 429's wait runs.
 */
export const RefreshAction = actionRef<{ plan?: Plan['id'] } | null, Usage>('subscriptions', 'refresh')
