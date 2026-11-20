import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { apply } from '@earendil-works/chord/delta'
import { defineExtension } from '@earendil-works/pi-durable'

type Summary = { id: number; label?: string; inputAt?: number; answerAt?: number }
type Host = {
  home: string
  chapter: { name: string }
  conversations(): Summary[]
  doc(kind: string): unknown
  harness(): { snapshot(doc: unknown, id: number, context: unknown): Promise<unknown> }
  resource<T>(key: string, create: () => T): T
}
type Run = { agent: string; at?: number }
export type Usage = Record<string, { count: number; lastAt?: number }>

const FIRST_CHAPTER = 'the-beginning'

const agentFrom = (profile: { definition?: string; adhoc?: true } | undefined, label?: string) =>
  profile?.definition ?? (profile?.adhoc ? null : (label ?? null))

/**
 * The agent each conversation of the active chapter ran as: the definition that configured it (its
 * `ultimate.agent-profile`), else its label for a branch, which runs as `coordinator` without one; null for an agent
 * made on the fly. A conversation's agent never changes, so it is read once and kept for the life of the process.
 */
async function activeRuns(host: Host): Promise<Run[]> {
  const known = host.resource('agent-usage.agents', () => new Map<number, string | null>())
  const token = host.doc('ultimate.agent-profile')
  const runs: Run[] = []
  for (const summary of host.conversations()) {
    if (!known.has(summary.id)) {
      const profile = token
        ? ((await host.harness().snapshot(token, summary.id, context)) as Parameters<
            typeof agentFrom
          >[0])
        : undefined
      known.set(summary.id, agentFrom(profile ?? undefined, summary.label))
    }
    const agent = known.get(summary.id)
    if (agent)
      runs.push({ agent, at: Math.max(summary.inputAt ?? 0, summary.answerAt ?? 0) || undefined })
  }
  return runs
}

/**
 * The same for a closed chapter, read from its database (closed chapters never change, so once per process). Pi
 * Durable's SQLite layout, as `extensions/codemode/chapters.ts` reads it: the latest revision of a conversation's
 * document is its newest base with the deltas after it applied.
 */
function closedRuns(database: string): Run[] {
  const db = new DatabaseSync(database, { readOnly: true })
  try {
    const latest = (kind: string) => {
      const values = new Map<number, Record<string, unknown>>()
      for (const row of db
        .prepare(
          `SELECT d.owner_id AS owner, r.kind, r.content FROM documents d JOIN document_revisions r ON r.document_id = d.id
           WHERE d.kind = ? AND d.scope_kind = 'conversation' AND d.family = 0 AND d.retired_at IS NULL
           ORDER BY d.owner_id, d.created_at, r.seq`,
        )
        .iterate(JSON.stringify(kind))) {
        const owner = Number(row.owner)
        const content = JSON.parse(String(row.content))
        values.set(owner, row.kind === 'base' ? content : apply(values.get(owner) ?? {}, content))
      }
      return values
    }
    const profiles = latest('ultimate.agent-profile')
    const metadata = latest('ultimate.metadata')
    const runs: Run[] = []
    for (const row of db.prepare('SELECT id FROM conversations').all()) {
      const id = Number(row.id)
      const meta = metadata.get(id) ?? {}
      const agent = agentFrom(profiles.get(id), meta.label as string | undefined)
      if (!agent) continue
      const at = Math.max(Number(meta.inputAt ?? 0), Number(meta.answerAt ?? 0)) || undefined
      runs.push({ agent, at })
    }
    return runs
  } finally {
    db.close()
  }
}

async function chapterRuns(host: Host): Promise<Run[]> {
  const cache = host.resource('agent-usage.chapters', () => new Map<string, Run[]>())
  let chapters: { name: string }[] = [{ name: FIRST_CHAPTER }]
  try {
    chapters = JSON.parse(await readFile(join(host.home, 'chapters.json'), 'utf8')).chapters
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const runs: Run[] = []
  for (const { name } of chapters) {
    if (name === host.chapter.name) continue
    if (!cache.has(name)) {
      const dir = name === FIRST_CHAPTER ? host.home : join(host.home, 'chapters', name)
      cache.set(name, closedRuns(join(dir, 'state.sqlite')))
    }
    runs.push(...cache.get(name)!)
  }
  return runs
}

export const actions = {
  async usage(_args: unknown, { host }: { host: Host }): Promise<Usage> {
    const usage: Usage = {}
    for (const { agent, at } of [...(await chapterRuns(host)), ...(await activeRuns(host))]) {
      const entry = (usage[agent] ??= { count: 0 })
      entry.count++
      if (at && (!entry.lastAt || at > entry.lastAt)) entry.lastAt = at
    }
    return usage
  },
}

export default defineExtension({ name: 'agent-usage' })
