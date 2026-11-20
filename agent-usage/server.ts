import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { defineExtension } from '@earendil-works/pi-durable'

type Summary = { id: number; label?: string; inputAt?: number; answerAt?: number }
type Host = {
  conversations(): Summary[]
  doc(kind: string): unknown
  harness(): { snapshot(doc: unknown, id: number, context: unknown): Promise<unknown> }
  resource<T>(key: string, create: () => T): T
}
export type Usage = Record<string, { count: number; lastAt?: number }>

/**
 * The agent each conversation ran as: the definition that configured it (its `ultimate.agent-profile`), else its label
 * for a branch, which runs as `coordinator` without one; null for an agent made on the fly. A conversation's agent
 * never changes, so it is read once per conversation and kept for the life of the process.
 */
async function agentOf(host: Host, summary: Summary) {
  const known = host.resource('agent-usage.agents', () => new Map<number, string | null>())
  if (known.has(summary.id)) return known.get(summary.id)!
  const token = host.doc('ultimate.agent-profile')
  const profile = token
    ? ((await host.harness().snapshot(token, summary.id, context)) as {
        definition?: string
        adhoc?: true
      } | null)
    : null
  const agent = profile?.definition ?? (profile?.adhoc ? null : (summary.label ?? null))
  known.set(summary.id, agent)
  return agent
}

export const actions = {
  async usage(_args: unknown, { host }: { host: Host }): Promise<Usage> {
    const usage: Usage = {}
    for (const summary of host.conversations()) {
      const agent = await agentOf(host, summary)
      if (!agent) continue
      const at = Math.max(summary.inputAt ?? 0, summary.answerAt ?? 0) || undefined
      const entry = (usage[agent] ??= { count: 0 })
      entry.count++
      if (at && (!entry.lastAt || at > entry.lastAt)) entry.lastAt = at
    }
    return usage
  },
}

export default defineExtension({ name: 'agent-usage' })
