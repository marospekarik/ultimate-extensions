/** @jsxImportSource @solidjs/web */
import { createMemo, Show } from 'solid-js'
import { actionRef, keepLast, useAction } from '@/sdk/solid'

type Usage = Record<string, { count: number; lastAt?: number }>

/** No arguments → how many conversations of this project ran as each agent, and when each was last active. */
const UsageAction = actionRef<null, Usage>('agent-usage', 'usage')

const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export function Count(props: { name: string }) {
  const { data } = useAction(UsageAction, null, { every: 60_000, focus: true, onError: keepLast })
  const mark = createMemo(() => {
    const usage = data()
    if (!usage) return undefined
    const count = usage[props.name]?.count ?? 0
    const lastAt = usage[props.name]?.lastAt
    const most = Math.max(1, ...Object.values(usage).map((entry) => entry.count))
    const opacity = count === 0 ? 0.3 : 0.4 + 0.5 * (Math.log1p(count) / Math.log1p(most))
    const title =
      count === 0
        ? `${props.name}: never run in this project`
        : `${props.name}: ${count} run${count === 1 ? '' : 's'} in this project${lastAt ? ` · last ${day.format(lastAt)}` : ''}`
    return { count, opacity, title }
  })
  return (
    <Show when={mark()}>
      {(shown) => (
        <span
          aria-label={shown().title}
          class="font-mono text-[10.5px] text-muted-foreground tabular-nums"
          style={{ opacity: shown().opacity }}
          title={shown().title}
        >
          {shown().count}
        </span>
      )}
    </Show>
  )
}
