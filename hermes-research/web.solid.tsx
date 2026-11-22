/** @jsxImportSource @solidjs/web */
import { FileText, Search, Square } from '@lucide/solid'
import { createMemo, Show } from 'solid-js'
import { Markdown } from '@/components/markdown/markdown.solid.tsx'
import { Tool, ToolContent, ToolHeader, ToolSection } from '@/components/ai/tool.solid.tsx'
import type { ToolState } from '@/components/ai/tool.solid.tsx'
import { Button } from '@/components/ui/button.solid.tsx'
import {
  actionRef,
  api,
  docRef,
  defineWebExtension,
  formatDuration,
  formatTokens,
  keepLast,
  ROOT,
  useAction,
  useDocOf,
  useNow,
  type SolidEntryProps,
  type SolidToolProps,
} from '@/sdk/solid'
import { RESULT_KIND, RUNS_KIND } from './types.ts'
import type { Live, Result, Run, RunState } from './types.ts'

const RunsDoc = docRef<{ runs: Run[] }>(RUNS_KIND)
/** `{ run }` → the running run's live progress from Hermes' session store; null once it ended. */
const LiveAction = actionRef<{ run: string }, Live | null>('hermes-research', 'live')
/** `{ run }` → stops a running run. */
const StopAction = actionRef<{ run: string }, { stopped: boolean }>('hermes-research', 'stop')

const toolState: Record<RunState, ToolState> = {
  running: 'running',
  done: 'done',
  failed: 'error',
  stopped: 'interrupted',
}

function useRun(id: () => string | undefined) {
  const runs = useDocOf(() => ROOT, RunsDoc)
  return createMemo(() => {
    const wanted = id()
    return wanted ? runs()?.runs.find((item) => item.id === wanted) : undefined
  })
}

function LiveLine(props: { run: Run }) {
  const live = useAction(LiveAction, { run: props.run.id }, { every: 2000, onError: keepLast })
  return (
    <>
      <span>{live.data()?.model ?? props.run.model ?? 'profile model'}</span>
      <span>{live.data()?.apiCalls ?? 0} calls</span>
    </>
  )
}

function LastTool(props: { run: Run }) {
  const live = useAction(LiveAction, { run: props.run.id }, { every: 2000, onError: keepLast })
  return (
    <ToolSection label="Now">
      <p class="truncate text-foreground/80" title={live.data()?.last}>
        {live.data()?.last ?? 'thinking…'}
        <Show when={live.data()}>{(data) => <span class="text-muted-foreground"> · {data().tools} tools</span>}</Show>
      </p>
    </ToolSection>
  )
}

function Elapsed(props: { run: Run }) {
  const now = useNow(1000, () => props.run.state === 'running')
  return <span>{formatDuration((props.run.endedAt ?? now()) - props.run.startedAt)}</span>
}

function StopButton(props: { run: Run }) {
  return (
    <Button
      aria-label={`Stop Hermes run ${props.run.id}`}
      class="flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 data-pending:opacity-40"
      data-agent-confirm="Stops the Hermes research run; its brief is lost"
      disabled={props.run.stopping}
      onClick={() => api.action(StopAction, { run: props.run.id }, { conversationId: ROOT })}
      size={null}
      title="Stop this Hermes run"
      type="button"
      variant={null}
    >
      <Square class="size-3" />
      {props.run.stopping ? 'stopping' : 'stop'}
    </Button>
  )
}

export function HermesCall(props: SolidToolProps) {
  const id = () => (props.call.details as { run?: string } | undefined)?.run
  const run = useRun(id)
  const prompt = () => (typeof props.call.args.prompt === 'string' ? props.call.args.prompt : '')
  return (
    <Show when={run()} fallback={props.core}>
      {(item) => (
        <Tool defaultOpen>
          <ToolHeader
            action={item().state === 'running' ? <StopButton run={item()} /> : undefined}
            aria-label={`Toggle Hermes run ${item().id}`}
            icon={Search}
            meta={
              <>
                <span>researcher</span>
                <Show
                  fallback={
                    <>
                      <span>{item().model ?? 'profile model'}</span>
                      <Show when={item().apiCalls !== undefined}>
                        <span>{item().apiCalls} calls</span>
                      </Show>
                      <Show when={item().tokens}>{(tokens) => <span>{formatTokens(tokens().total)} tok</span>}</Show>
                    </>
                  }
                  when={item().state === 'running'}
                >
                  <LiveLine run={item()} />
                </Show>
                <Elapsed run={item()} />
              </>
            }
            name="hermes"
            state={toolState[item().state]}
            title={
              <>
                <Show when={item().resume}>
                  <span class="text-foreground/70">follow-up </span>
                </Show>
                {prompt().split('\n')[0]}
              </>
            }
          />
          <ToolContent>
            <ToolSection label={item().resume ? `Follow-up of ${item().resume}` : 'Question'}>
              <p class="line-clamp-3 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/90">{item().prompt}</p>
            </ToolSection>
            <Show when={item().state === 'running'}>
              <LastTool run={item()} />
            </Show>
            <Show when={item().state === 'done' && item().report}>
              {(report) => (
                <ToolSection label="Brief">
                  <div class="relative max-h-56 overflow-hidden font-sans text-[13px] leading-relaxed">
                    <Markdown text={(item().preview ?? '').replace(/(\S)\n(?=\S)/g, '$1  \n')} />
                    <div class="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />
                  </div>
                  <div class="flex items-center gap-1.5 pt-1 font-sans text-[12px]">
                    <FileText class="size-3 text-brand" />
                    <Markdown text={`[Open the full brief](/.reports/${report()})`} />
                    <span class="text-muted-foreground">· run {item().id}</span>
                  </div>
                </ToolSection>
              )}
            </Show>
            <Show when={item().state !== 'done' && item().state !== 'running' && item().error}>
              {(error) => (
                <ToolSection label={item().state === 'stopped' ? 'Stopped' : 'Error'}>
                  <pre class={item().state === 'failed' ? 'whitespace-pre-wrap text-error' : 'whitespace-pre-wrap text-muted-foreground'}>{error()}</pre>
                </ToolSection>
              )}
            </Show>
          </ToolContent>
        </Tool>
      )}
    </Show>
  )
}

export function ResultInput(props: SolidEntryProps) {
  const data = () => props.entry.data as Result | undefined
  const run = useRun(() => data()?.run)
  return (
    <Show when={data()}>
      {(result) => (
        <div class="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <Search class="size-3 shrink-0 text-brand" />
          <span class="shrink-0">hermes run {result().run} {result().state}</span>
          <Show when={run()?.tokens}>{(tokens) => <span class="shrink-0">· {formatTokens(tokens().total)} tok</span>}</Show>
          <Show when={result().report}>
            {(report) => (
              <span class="min-w-0 truncate">
                · <Markdown class="inline-block" text={`[${report()}](/.reports/${report()})`} />
              </span>
            )}
          </Show>
        </div>
      )}
    </Show>
  )
}

export default defineWebExtension({
  tools: { hermes_research: HermesCall },
  entries: { [RESULT_KIND]: ResultInput },
  compact: {
    when: (conversation, docs) =>
      (docs['ultimate.standing-agents'] as Record<string, number> | null | undefined)?.ultimate === conversation.id,
    tools: ['hermes_research'],
    docs: ['ultimate.standing-agents'],
    thread: (row) => row.calls.some((call) => call.name === 'hermes_research') || row.entry.kind === RESULT_KIND,
  },
})
