/** @jsxImportSource @solidjs/web */
import { KeyRound, LoaderCircle } from '@lucide/solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { Tool, ToolContent, ToolHeader, ToolSection } from '@/components/ai/tool.solid.tsx'
import type { ToolState } from '@/components/ai/tool.solid.tsx'
import { Button } from '@/components/ui/button.solid.tsx'
import { SecretInput } from '@/components/ui/input.solid.tsx'
import {
  actionRef,
  api,
  defineWebExtension,
  docRef,
  errorMessage,
  ROOT,
  useDocOf,
  type SolidEntryProps,
  type SolidToolProps,
} from '@/sdk/solid'
import { REQUESTS_KIND, RESULT_KIND } from './types.ts'
import type { Counts, RequestState, Result, SecretRequest } from './types.ts'

const RequestsDoc = docRef<{ requests: SecretRequest[] }>(REQUESTS_KIND)
/** `{ request, secrets }` → merges the values into the request's dotenv file; user-only. */
const SubmitAction = actionRef<{ request: string; secrets: Record<string, string> }, Counts>('secret-request', 'submit')
/** `{ request }` → closes the request without writing; user-only. */
const CancelAction = actionRef<{ request: string }, null>('secret-request', 'cancel')

const toolState: Record<RequestState, ToolState> = { pending: 'running', saved: 'done', cancelled: 'interrupted' }

function useRequest(id: () => string | undefined) {
  const requests = useDocOf(() => ROOT, RequestsDoc)
  return createMemo(() => {
    const wanted = id()
    return wanted ? requests()?.requests.find((item) => item.id === wanted) : undefined
  })
}

const names = (item: SecretRequest) => item.fields.map((field) => field.name).join(', ')

function Form(props: { request: SecretRequest }) {
  const [values, setValues] = createSignal<Record<string, string>>({})
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const ready = () => !busy() && props.request.fields.every((field) => values()[field.name]?.trim())

  async function run(save: boolean) {
    if (save && !ready()) return
    setBusy(true)
    setError(undefined)
    try {
      if (save) {
        const secrets = Object.fromEntries(props.request.fields.map((field) => [field.name, values()[field.name]!.trim()]))
        await api.action(SubmitAction, { request: props.request.id, secrets }, { conversationId: ROOT })
      } else await api.action(CancelAction, { request: props.request.id }, { conversationId: ROOT })
      setValues({})
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }

  function keys(event: KeyboardEvent) {
    if (event.isComposing || event.key !== 'Enter') return
    event.preventDefault()
    void run(true)
  }

  return (
    <ToolSection class="flex flex-col gap-2.5">
      <For each={props.request.fields}>
        {(field) => (
          <label class="flex min-w-0 flex-col gap-1">
            <span class="font-mono text-[12px] break-all text-foreground">{field.name}</span>
            <Show when={field.description}>
              <span class="font-sans text-[12px] leading-snug text-muted-foreground">{field.description}</span>
            </Show>
            <SecretInput
              aria-label={`Value for ${field.name}`}
              class="gap-1.5"
              disabled={busy()}
              onKeyDown={keys}
              onValueChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
              placeholder="Paste the value"
              value={values()[field.name] ?? ''}
            />
          </label>
        )}
      </For>
      <Show when={error()}>
        <p class="font-mono text-[11px] leading-snug text-error">{error()}</p>
      </Show>
      <div class="flex items-center gap-1.5">
        <Button
          aria-label={`Save ${names(props.request)} to file`}
          class="h-7 gap-1.5 px-2.5 text-[12px]"
          data-agent-confirm="Writes secret values a person typed"
          disabled={!ready()}
          onClick={() => run(true)}
          size="sm"
        >
          <Show when={busy()}>
            <LoaderCircle class="size-3.5 animate-spin" />
          </Show>
          Save
        </Button>
        <Button
          aria-label={`Cancel request for ${names(props.request)}`}
          class="h-7 px-2.5 text-[12px]"
          disabled={busy()}
          onClick={() => run(false)}
          size="sm"
          variant="ghost"
        >
          Cancel
        </Button>
        <span class="ml-auto font-sans text-[11px] text-muted-foreground">never shown to the agent</span>
      </div>
    </ToolSection>
  )
}

export function RequestCall(props: SolidToolProps) {
  const request = useRequest(() => (props.call.details as { request?: string } | undefined)?.request)
  return (
    <Show when={request()} fallback={props.core}>
      {(item) => (
        <Tool defaultOpen={item().state === 'pending'}>
          <ToolHeader
            aria-label={`Toggle secret request ${item().id}`}
            icon={KeyRound}
            meta={<span>{item().state === 'pending' ? 'waiting on you' : item().state}</span>}
            name="secret"
            state={toolState[item().state]}
            title={names(item())}
          />
          <ToolContent>
            <ToolSection label="Why">
              <p class="font-sans text-[13px] leading-relaxed text-foreground/90">{item().purpose}</p>
            </ToolSection>
            <ToolSection label="Written to">
              <p class="font-mono text-[12px] break-all text-foreground/80">{item().path}</p>
            </ToolSection>
            <Show
              when={item().state === 'pending'}
              fallback={
                <ToolSection>
                  <p class="font-sans text-[12px] text-muted-foreground">
                    {item().state === 'saved' && item().counts
                      ? `Saved: ${item().counts!.added} added, ${item().counts!.updated} updated, ${item().counts!.unchanged} unchanged.`
                      : 'Cancelled; nothing was written.'}
                  </p>
                </ToolSection>
              }
            >
              <Form request={item()} />
            </Show>
          </ToolContent>
        </Tool>
      )}
    </Show>
  )
}

export function ResultInput(props: SolidEntryProps) {
  const data = () => props.entry.data as Result | undefined
  const request = useRequest(() => data()?.request)
  return (
    <Show when={data()}>
      {(result) => (
        <div class="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <KeyRound class="size-3 shrink-0 text-brand" />
          <span class="min-w-0 truncate">
            {request() ? names(request()!) : `request ${result().request}`} {result().state}
            <Show when={request()?.state === 'saved'}> · {request()!.path}</Show>
          </span>
        </div>
      )}
    </Show>
  )
}

export default defineWebExtension({
  tools: { request_secret: RequestCall },
  entries: { [RESULT_KIND]: ResultInput },
})
