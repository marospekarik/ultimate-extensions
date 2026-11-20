import type { ReactNode } from 'react'
import { actionRef, defineWebExtension, definePoint, keepLast, provide, useAction } from '@/sdk'

type Usage = Record<string, { count: number; lastAt?: number }>

/** No arguments → how many conversations of this project ran as each agent, and when each was last active. */
const UsageAction = actionRef<null, Usage>('agent-usage', 'usage')

const AgentMark = definePoint<{ name: string }, ReactNode>('subagents.mark')

const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

function Count({ name }: { name: string }) {
  const { data } = useAction(UsageAction, null, { every: 60_000, focus: true, onError: keepLast })
  if (!data) return null
  const count = data[name]?.count ?? 0
  const lastAt = data[name]?.lastAt
  const most = Math.max(1, ...Object.values(data).map((entry) => entry.count))
  const opacity = count === 0 ? 0.3 : 0.4 + 0.5 * (Math.log1p(count) / Math.log1p(most))
  const title =
    count === 0
      ? `${name}: never run in this project`
      : `${name}: ${count} run${count === 1 ? '' : 's'} in this project${lastAt ? ` · last ${day.format(lastAt)}` : ''}`
  return (
    <span
      aria-label={title}
      className="font-mono text-[10.5px] text-muted-foreground tabular-nums"
      style={{ opacity }}
      title={title}
    >
      {count}
    </span>
  )
}

export default defineWebExtension({
  provides: [provide(AgentMark, (input) => <Count name={input.name} />)],
})
