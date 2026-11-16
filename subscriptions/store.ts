/**
 * What the extension knows, in one file under the user home: the account's windows are the same whichever project asks,
 * and every running project on this machine writes here, so the newest reading wins. Writes are read-modify-write with
 * the change applied only forwards and an atomic rename, like `extensions/health`'s store: two projects writing at once
 * lose at most one reading, and the next turn replaces it.
 */
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RateLimitInfo } from './anthropic.ts'
import type { Snapshot as CodexSnapshot } from './codex.ts'
import type { Snapshot } from './ollama.ts'

export type Stored = {
  /** Claude's newest reading, from a response's diagnostic or the usage endpoint, whichever is newer. */
  claude?: { at: number; info: RateLimitInfo }
  /**
   * Why the last usage-endpoint request failed, and when. After a 429, `until` is when Anthropic may be asked again
   * (its `Retry-After`, or a backoff that doubles from `wait`); every process on the machine honours it.
   */
  claudeProblem?: { at: number; problem: string; until?: number; wait?: number }
  /** Ollama's last good reading; a failure leaves it in place. */
  ollama?: Snapshot
  /** Why the last Ollama request failed, and when; after a 429, `until` and `wait` as for Claude. */
  ollamaProblem?: { at: number; problem: string; until?: number; wait?: number }
  /** ChatGPT's last good Codex reading; a failure leaves it in place. */
  codex?: CodexSnapshot
  /** Why the last ChatGPT request failed, and when; after a 429, `until` and `wait` as for Claude. */
  codexProblem?: { at: number; problem: string; until?: number; wait?: number }
}

export const statePath = (userHome: string) => join(userHome, '.ultimate/subscriptions.json')

export async function read(userHome: string): Promise<Stored> {
  try {
    const parsed = JSON.parse(await readFile(statePath(userHome), 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Stored) : {}
  } catch {
    // No file yet, or one this version cannot read: nothing is known, which every reader handles.
    return {}
  }
}

/** Applies one change and writes the file atomically; returns the change's result. */
export async function change<T>(userHome: string, apply: (state: Stored) => T): Promise<T> {
  const state = await read(userHome)
  const result = apply(state)
  const path = statePath(userHome)
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 })
  await rename(temporary, path)
  return result
}
