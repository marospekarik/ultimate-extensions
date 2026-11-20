import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CircleDotIcon,
  EyeIcon,
  FileDiffIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  LaptopIcon,
  MinusIcon,
  PlayIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { MessageResponse } from '@/components/ai/message'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  api,
  cn,
  Conversation,
  defineWebExtension,
  Dock,
  errorMessage,
  formatAgo,
  Header,
  Provided,
  StatusLine,
  useAction,
  useExtensionUiState,
  useNow,
  useUiState,
  useUltimate,
  useViewport,
} from '@/sdk'
import {
  CloseAction,
  CommentAction,
  FetchAction,
  InstanceListAction,
  InstanceStartAction,
  InstanceStopAction,
  ListAction,
  LocalRunsAction,
  MergeAction,
  previewLabel,
  ReviewAction,
  RunLocallyAction,
  SitePreviewAction,
  StopLocalRunAction,
  ViewAction,
} from './refs.ts'
import type {
  Check,
  Checks,
  InstancePreview,
  PrDetail,
  PrSummary,
  SitePreview,
  TimelineItem,
} from './refs.ts'
import { PrMark } from './ui.tsx'

const SURFACE = 'pull-requests'

const useSelected = () => useExtensionUiState<number | null>('selected', null)
/** The head each PR had when its diff was last opened in Review, by `<repo>#<number>`: what Merge pins. */
const useReviewed = () => useExtensionUiState<Record<string, string>>('reviewed', {})

const ago = (at: string, now: number) => formatAgo(Date.parse(at), now, { ago: true })

// ── Small parts ──

function ChecksIcon({ state, className }: { state: Checks | Check['state']; className?: string }) {
  const props = { className: cn('size-3.5 shrink-0', className) }
  if (state === 'pass')
    return <CheckIcon {...props} className={cn(props.className, 'text-success')} />
  if (state === 'fail') return <XIcon {...props} className={cn(props.className, 'text-error')} />
  if (state === 'pending')
    return <CircleDotIcon {...props} className={cn(props.className, 'text-warning')} />
  return <MinusIcon {...props} className={cn(props.className, 'text-muted-foreground/60')} />
}

const checksLabel: Record<Checks, string> = {
  pass: 'CI passed',
  fail: 'CI failed',
  pending: 'CI running',
  none: 'no CI checks',
}

function Tag({ children, tone }: { children: ReactNode; tone?: 'error' | 'warning' | 'success' }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-sm border px-1 font-mono text-[10.5px] leading-[1.5]',
        tone === 'error' && 'border-error/40 text-error',
        tone === 'warning' && 'border-warning/40 text-warning',
        tone === 'success' && 'border-success/40 text-success',
        !tone && 'border-border/70 text-muted-foreground',
      )}
    >
      {children}
    </span>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 py-10 text-center font-mono text-[11.5px] text-muted-foreground/70">
      {children}
    </p>
  )
}

// ── The list ──

/** The Ultimate previews of PRs that run now, for a mark in the list. */
function usePreviewed() {
  const list = useAction(InstanceListAction, null, { every: 15_000, onError: () => {} })
  return new Set(
    (list.data ?? []).filter((item) => item.running && item.label).map((item) => item.label!),
  )
}

function List({
  prs,
  viewer,
  selected,
  onSelect,
  className,
}: {
  prs: PrSummary[]
  viewer: string
  selected: number | null
  onSelect: (n: number) => void
  className?: string
}) {
  const previewed = usePreviewed()
  const local = useAction(LocalRunsAction, null, { every: 15_000, onError: () => {} })
  const runningLocally = new Set(
    (local.data?.runs ?? []).filter((run) => run.status !== 'failed').map((run) => run.number),
  )
  const now = useNow(60_000)
  if (prs.length === 0)
    return (
      <nav className={cn('bg-sidebar', className)}>
        <Quiet>No open pull requests.</Quiet>
      </nav>
    )
  return (
    <nav className={cn('min-h-0 overflow-y-auto bg-sidebar py-1', className)}>
      {prs.map((pr) => (
        <button
          className={cn(
            'block w-full px-3 py-2 text-left hover:bg-accent/60 pointer-coarse:py-3',
            pr.number === selected && 'bg-accent text-foreground',
          )}
          key={pr.number}
          onClick={() => onSelect(pr.number)}
          title={pr.title}
          type="button"
        >
          <span className="flex items-start gap-2">
            <ChecksIcon className="mt-[3px]" state={pr.checks} />
            <span className="line-clamp-2 min-w-0 flex-1 text-[12.5px] leading-snug">
              {pr.title}
            </span>
          </span>
          <span className="mt-1 flex items-center gap-1.5 pl-[22px] font-mono text-[10.5px] text-muted-foreground">
            <span>#{pr.number}</span>
            <span className="min-w-0 truncate">{pr.author === viewer ? 'you' : pr.author}</span>
            <span className="shrink-0 text-muted-foreground/60">· {ago(pr.updatedAt, now)}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <Provided input={{ number: pr.number, place: 'row' }} point={PrMark}>
                {(mark) => mark}
              </Provided>
              {runningLocally.has(pr.number) && <Tag>running</Tag>}
              {previewed.has(previewLabel(pr.number)) && <Tag>preview</Tag>}
              {pr.draft && <Tag>draft</Tag>}
              {pr.mergeable === 'CONFLICTING' && <Tag tone="error">conflicts</Tag>}
              {pr.blockers.length === 0 && <Tag tone="success">ready</Tag>}
            </span>
          </span>
        </button>
      ))}
    </nav>
  )
}

// ── The PR ──

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 font-mono text-[10.5px] tracking-wider text-muted-foreground/80 uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

const verdict: Record<string, { label: string; tone?: 'error' | 'success' }> = {
  APPROVED: { label: 'approved', tone: 'success' },
  CHANGES_REQUESTED: { label: 'changes requested', tone: 'error' },
  COMMENTED: { label: 'reviewed' },
  DISMISSED: { label: 'dismissed' },
}

function Timeline({ items, viewer }: { items: TimelineItem[]; viewer: string }) {
  const now = useNow(60_000)
  if (items.length === 0)
    return <p className="font-mono text-[11.5px] text-muted-foreground/70">No comments yet.</p>
  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li className="rounded-md border border-border/70 bg-card" key={`${item.at}-${index}`}>
          <div className="flex items-center gap-1.5 border-b border-border/50 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
            <span className="text-foreground/85">
              {item.author === viewer ? 'you' : item.author}
            </span>
            {item.kind === 'review' && item.state && (
              <Tag tone={verdict[item.state]?.tone}>{verdict[item.state]?.label ?? item.state}</Tag>
            )}
            {item.kind === 'inline' && item.path && (
              <span className="min-w-0 truncate" title={item.path}>
                on {item.path}
                {item.line ? `:${item.line}` : ''}
              </span>
            )}
            <span className="ml-auto shrink-0 text-muted-foreground/60">{ago(item.at, now)}</span>
          </div>
          {item.body.trim() && (
            <div className="px-3 py-2 text-[13px]">
              <MessageResponse>{item.body}</MessageResponse>
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

function MergeDialog({
  pr,
  pinned,
  open,
  onOpenChange,
  onMerged,
}: {
  pr: PrDetail
  pinned: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onMerged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const head = pinned ?? pr.headSha
  const moved = pinned !== undefined && pinned !== pr.headSha
  const blocked = moved || pr.blockers.length > 0
  return (
    <Dialog
      onOpenChange={(next) => {
        if (busy) return
        setError(null)
        onOpenChange(next)
      }}
      open={open}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Merge PR #{pr.number}?</DialogTitle>
          <DialogDescription className="text-[13px]">{pr.title}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[11.5px]">
          <dt className="text-muted-foreground/70">commit</dt>
          <dd>
            {head.slice(0, 7)}{' '}
            <span className="text-muted-foreground">
              {pinned ? '(the head you opened in Review)' : '(the head shown; diff not opened)'}
            </span>
          </dd>
          <dt className="text-muted-foreground/70">into</dt>
          <dd>
            {pr.base} <span className="text-muted-foreground">as a merge commit</span>
          </dd>
          <dt className="text-muted-foreground/70">checks</dt>
          <dd className="flex items-center gap-1.5">
            <ChecksIcon state={pr.checks} />
            {checksLabel[pr.checks]}
          </dd>
        </dl>
        {moved && (
          <p className="text-[12.5px] text-warning">
            New commits since you opened the diff ({pinned.slice(0, 7)} → {pr.headSha.slice(0, 7)}).
            Open the diff again to review them.
          </p>
        )}
        {pr.blockers.map((blocker) => (
          <p className="text-[12.5px] text-error" key={blocker}>
            {blocker}
          </p>
        ))}
        {error && <p className="text-[12.5px] text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button disabled={busy} onClick={() => onOpenChange(false)} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={busy || blocked}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await api.action(MergeAction, { number: pr.number, head })
                onMerged()
              } catch (caught) {
                setError(errorMessage(caught))
              } finally {
                setBusy(false)
              }
            }}
            size="sm"
          >
            <GitMergeIcon />
            {busy ? 'Merging…' : 'Merge'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CloseDialog({
  pr,
  open,
  onOpenChange,
  onClosed,
}: {
  pr: PrDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Dialog onOpenChange={(next) => !busy && onOpenChange(next)} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Close PR #{pr.number} without merging?</DialogTitle>
          <DialogDescription className="text-[13px]">{pr.title}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-[12.5px] text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button disabled={busy} onClick={() => onOpenChange(false)} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await api.action(CloseAction, { number: pr.number })
                onClosed()
              } catch (caught) {
                setError(errorMessage(caught))
              } finally {
                setBusy(false)
              }
            }}
            size="sm"
            variant="destructive"
          >
            {busy ? 'Closing…' : 'Close PR'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Composer({ pr, onSent }: { pr: PrDetail; onSent: () => void }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const send = (what: string, call: () => Promise<unknown>) => async () => {
    setBusy(what)
    setError(null)
    try {
      await call()
      setBody('')
      onSent()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }
  const text = body.trim()
  return (
    <div className="mt-3 space-y-2">
      <textarea
        aria-label="Comment"
        className="block min-h-20 w-full resize-y rounded-md border border-border/70 bg-background px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground/60 focus:border-brand/50"
        onChange={(event) => setBody(event.target.value)}
        placeholder={
          pr.own
            ? 'Comment on GitHub…'
            : 'Comment, or a note with your approval or requested changes…'
        }
        value={body}
      />
      {error && <p className="text-[12.5px] text-error">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {!pr.own && (
          <>
            <Button
              disabled={busy !== null || !text}
              onClick={send('changes', () =>
                api.action(ReviewAction, {
                  number: pr.number,
                  event: 'request-changes',
                  body: text,
                }),
              )}
              size="sm"
              variant="outline"
            >
              {busy === 'changes' ? 'Sending…' : 'Request changes'}
            </Button>
            <Button
              disabled={busy !== null}
              onClick={send('approve', () =>
                api.action(ReviewAction, {
                  number: pr.number,
                  event: 'approve',
                  ...(text && { body: text }),
                }),
              )}
              size="sm"
              variant="outline"
            >
              <CheckIcon />
              {busy === 'approve' ? 'Approving…' : 'Approve'}
            </Button>
          </>
        )}
        <Button
          disabled={busy !== null || !text}
          onClick={send('comment', () =>
            api.action(CommentAction, { number: pr.number, body: text }),
          )}
          size="sm"
          variant="secondary"
        >
          {busy === 'comment' ? 'Posting…' : 'Comment'}
        </Button>
      </div>
    </div>
  )
}

/** The site preview's state for the PR's head, under the action buttons like the diff note. */
function SitePreviewNote({ site }: { site: Exclude<SitePreview, { status: 'off' }> }) {
  const sha = site.head.slice(0, 7)
  const check = site.check?.url ? (
    <a
      className="underline underline-offset-2"
      href={site.check.url}
      rel="noreferrer"
      target="_blank"
    >
      {site.status === 'failed' ? 'see the run' : 'the run'}
    </a>
  ) : null
  if (site.status === 'ready')
    return (
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <CheckIcon className="size-3.5 text-success" />
        Site preview built for {sha}, the current head.
      </p>
    )
  if (site.status === 'building')
    return (
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <CircleDotIcon className="size-3.5 text-warning" />
        Site preview is building for {sha}; the page may still show an earlier build. {check}
      </p>
    )
  if (site.status === 'failed')
    return (
      <p className="flex items-center gap-1.5 text-error">
        <XIcon className="size-3.5" />
        The site preview failed to build for {sha}: {check}
      </p>
    )
  if (site.status === 'earlier')
    return (
      <p className="text-muted-foreground">
        Site preview is from an earlier commit: the commits since did not change the site.
      </p>
    )
  return <p className="text-muted-foreground/70">No site preview for this PR.</p>
}

/** How many Ultimate previews of PRs may run at once; starting one more stops the one opened least recently. */
const PREVIEW_CAP = 2
const isPrPreview = (item: InstancePreview) => item.running && /^PR #\d+$/.test(item.label ?? '')

/**
 * An Ultimate preview of the PR's head for PRs that change `.ultimate/`: `button` starts it, `note` says what runs and
 * offers its link (the `instance` link renderer shows it in the frame here, or opens its tailnet address elsewhere),
 * Stop, and Restart when the PR moved on.
 */
function useUltimatePreview(number: number, pr: PrDetail | undefined, inPreview: boolean) {
  const list = useAction(InstanceListAction, null, { every: 5000, onError: () => {} })
  /** When each running PR preview was last started or opened, by preview id: the cap stops the oldest. */
  const [opened, setOpened] = useExtensionUiState<Record<string, number>>('previewOpened', {})
  const [busy, setBusy] = useState<'starting' | 'stopping' | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!pr || !pr.ultimate || inPreview) return { button: null, note: null }
  const running = (list.data ?? []).filter(isPrPreview)
  const label = previewLabel(pr.number)
  const mine = running.find((item) => item.label === label)
  const touch = (id: string) =>
    setOpened((previous) => ({
      ...Object.fromEntries(
        Object.entries(previous).filter(([key]) => running.some((item) => item.id === key)),
      ),
      [id]: Date.now(),
    }))
  const act = (what: 'starting' | 'stopping', call: () => Promise<unknown>) => async () => {
    setBusy(what)
    setError(null)
    try {
      await call()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
      void list.refetch()
    }
  }
  const start = act('starting', async () => {
    // `instance` never fetches: bring the PR's head in first.
    const { head } = await api.action(FetchAction, { number })
    if (mine) await api.action(InstanceStopAction, { id: mine.id })
    const others = running
      .filter((item) => item.label !== label)
      .toSorted((a, b) => (opened[a.id] ?? 0) - (opened[b.id] ?? 0))
    for (const item of others.slice(0, Math.max(0, others.length - PREVIEW_CAP + 1)))
      await api.action(InstanceStopAction, { id: item.id })
    const started = await api.action(InstanceStartAction, { ref: head, label })
    touch(started.id)
  })
  const stop = act('stopping', () => api.action(InstanceStopAction, { id: mine!.id }))
  const sha = (ref?: string) => ref?.slice(0, 7) ?? '?'
  const link = 'underline underline-offset-2 disabled:opacity-50'
  const button =
    pr.trusted && !mine ? (
      <Button
        disabled={busy !== null}
        onClick={start}
        size="sm"
        title="Runs this PR's .ultimate/ changes in a separate Ultimate. It stops after an hour with no page open."
        variant="outline"
      >
        <PlayIcon />
        {busy === 'starting' ? 'Starting…' : 'Ultimate preview'}
      </Button>
    ) : null
  const note = (
    <>
      {!pr.trusted && (
        <p className="text-muted-foreground/70">
          No Ultimate preview: it would run this PR&apos;s .ultimate/ code as you, so it is offered
          only for PRs from people with write access, never from forks.
        </p>
      )}
      {busy === 'starting' && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <CircleDotIcon className="size-3.5 animate-pulse text-warning" />
          Starting an Ultimate preview of {sha(pr.headSha)}; it takes about half a minute.
        </p>
      )}
      {mine && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
          <CheckIcon className="size-3.5 text-success" />
          <span>Ultimate preview of {sha(mine.ref)}:</span>
          <span className="[&_p]:m-0" onClickCapture={() => touch(mine.id)}>
            <MessageResponse>{`[${label}](${mine.url}/)`}</MessageResponse>
          </span>
          <span>·</span>
          <button className={link} disabled={busy !== null} onClick={stop} type="button">
            {busy === 'stopping' ? 'Stopping…' : 'Stop'}
          </button>
        </div>
      )}
      {mine && mine.ref !== pr.headSha && (
        <p className="text-warning">
          New commits since the preview started ({sha(mine.ref)} → {sha(pr.headSha)}).{' '}
          <button className={link} disabled={busy !== null} onClick={start} type="button">
            {busy === 'starting' ? 'Restarting…' : 'Restart it'}
          </button>
        </p>
      )}
      {error && <p className="text-error">{error}</p>}
    </>
  )
  return { button, note }
}

/** Whether this page is on this machine: a local run listens on its localhost only. */
const onThisMachine = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)

/**
 * A local run of the PR's head with the user's `pullRequests.localRun` command: `button` starts it, `note` links it
 * while it runs, with Stop, and Restart when the PR moved on.
 */
function useLocalRun(number: number, pr: PrDetail | undefined) {
  const runs = useAction(LocalRunsAction, null, { every: 3000, onError: () => {} })
  const [busy, setBusy] = useState<'starting' | 'stopping' | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!pr || !runs.data?.enabled) return { button: null, note: null }
  const mine = runs.data.runs.find((run) => run.number === number)
  const act = (what: 'starting' | 'stopping', call: () => Promise<unknown>) => async () => {
    setBusy(what)
    setError(null)
    try {
      await call()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
      void runs.refetch()
    }
  }
  const start = act('starting', () => api.action(RunLocallyAction, { number }))
  const stop = act('stopping', () => api.action(StopLocalRunAction, { number }))
  const sha = (ref: string) => ref.slice(0, 7)
  const link = 'underline underline-offset-2 disabled:opacity-50'
  const live = mine && mine.status !== 'failed'
  // Off this machine the localhost address does not open: link the run's tailnet address when it has one.
  const address =
    mine?.status === 'running' ? (onThisMachine ? mine.url : (mine.tailnet ?? mine.url)) : undefined
  const button =
    pr.trusted && !live ? (
      <Button
        disabled={busy !== null}
        onClick={start}
        size="sm"
        title="Runs this PR's head on this machine with mocked providers, in a temporary worktree removed on Stop."
        variant="outline"
      >
        <LaptopIcon />
        {busy === 'starting' ? 'Starting…' : 'Run locally'}
      </Button>
    ) : null
  const stopButton = (
    <button
      className={link}
      disabled={busy !== null || mine?.status === 'stopping'}
      onClick={stop}
      type="button"
    >
      {busy === 'stopping' || mine?.status === 'stopping' ? 'Stopping…' : 'Stop'}
    </button>
  )
  const note = (
    <>
      {!pr.trusted && (
        <p className="text-muted-foreground/70">
          No local run: it would run this PR&apos;s code as you, so it is offered only for PRs from
          people with write access, never from forks.
        </p>
      )}
      {mine?.status === 'starting' && (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
          <CircleDotIcon className="size-3.5 animate-pulse text-warning" />
          <span>Starting {sha(mine.head)} locally…</span>
          <span>·</span>
          {stopButton}
        </p>
      )}
      {mine?.status === 'running' && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
          <CheckIcon className="size-3.5 text-success" />
          <span>
            Running at{' '}
            <a
              className="underline underline-offset-2"
              href={address}
              rel="noreferrer"
              target="_blank"
            >
              {address}
            </a>{' '}
            (commit {sha(mine.head)})
          </span>
          <span>·</span>
          {stopButton}
        </div>
      )}
      {mine?.status === 'stopping' && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <CircleDotIcon className="size-3.5 animate-pulse text-warning" />
          Stopping the local run and removing its worktree…
        </p>
      )}
      {mine?.status === 'running' && address === mine.url && !onThisMachine && (
        <p className="text-muted-foreground">
          The local run is reachable only on this machine: open it in a browser here.
        </p>
      )}
      {live && mine.head !== pr.headSha && (
        <p className="text-warning">
          New commits since the local run started ({sha(mine.head)} → {sha(pr.headSha)}).{' '}
          <button className={link} disabled={busy !== null} onClick={start} type="button">
            {busy === 'starting' ? 'Restarting…' : 'Restart it'}
          </button>
        </p>
      )}
      {mine?.status === 'failed' && (
        <p className="text-error">
          The local run of {sha(mine.head)} stopped: {mine.error}
        </p>
      )}
      {error && <p className="text-error">{error}</p>}
    </>
  )
  return { button, note }
}

function Detail({
  number,
  repo,
  viewer,
  preview,
  onDone,
}: {
  number: number
  repo: string
  viewer: string
  preview: boolean
  onDone: (message: string) => void
}) {
  const view = useAction(ViewAction, { number }, { every: 60_000, focus: true })
  const siteAction = useAction(SitePreviewAction, { number }, { every: 60_000, focus: true })
  const site = siteAction.data?.status === 'off' ? undefined : siteAction.data
  const ultimatePreview = useUltimatePreview(
    number,
    view.data?.number === number ? view.data : undefined,
    preview,
  )
  const localRun = useLocalRun(number, view.data?.number === number ? view.data : undefined)
  const [reviewed, setReviewed] = useReviewed()
  const [, setReviewSpec] = useUiState<string>('ext.review.spec', 'uncommitted')
  const { showSurface } = useUltimate()
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'merge' | 'close' | null>(null)
  const pr = view.data?.number === number ? view.data : undefined
  if (!pr)
    return view.error ? (
      <p className="font-mono text-[12px] text-error">{view.error.message}</p>
    ) : (
      <p className="font-mono text-[12px] text-muted-foreground">loading…</p>
    )
  const key = `${repo}#${pr.number}`
  const pinned = reviewed[key]
  const openDiff = async () => {
    setOpening(true)
    setOpenError(null)
    try {
      const { spec, head } = await api.action(FetchAction, { number: pr.number })
      setReviewed((previous) => ({ ...previous, [key]: head }))
      setReviewSpec(spec)
      showSurface('review')
    } catch (caught) {
      setOpenError(errorMessage(caught))
    } finally {
      setOpening(false)
    }
  }
  const forget = () =>
    setReviewed((previous) => {
      const rest = { ...previous }
      delete rest[key]
      return rest
    })
  return (
    <>
      <div className="flex items-start gap-2">
        <h1 className="min-w-0 flex-1 text-[17px] leading-snug font-semibold">{pr.title}</h1>
        <a
          className="mt-1 flex shrink-0 items-center gap-0.5 font-mono text-[11.5px] text-muted-foreground hover:text-foreground"
          href={pr.url}
          rel="noreferrer"
          target="_blank"
          title="Open on GitHub"
        >
          #{pr.number}
          <ArrowUpRightIcon className="size-3" />
        </a>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
        <span className="text-foreground/85">{pr.own ? 'you' : pr.author}</span>
        <span className="min-w-0 truncate" title={`${pr.head} → ${pr.base}`}>
          {pr.head} → {pr.base}
        </span>
        <span>
          <span className="text-diff-add">+{pr.additions}</span>{' '}
          <span className="text-diff-del">−{pr.deletions}</span> · {pr.changedFiles} files
        </span>
        {pr.draft && <Tag>draft</Tag>}
        {pr.reviewDecision && verdict[pr.reviewDecision] && (
          <Tag tone={verdict[pr.reviewDecision].tone}>{verdict[pr.reviewDecision].label}</Tag>
        )}
      </div>
      <Provided input={{ number: pr.number, place: 'detail' }} point={PrMark}>
        {(mark) => mark}
      </Provided>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button disabled={opening} onClick={openDiff} size="sm" variant="outline">
          <FileDiffIcon />
          {opening ? 'Fetching…' : 'Review diff'}
        </Button>
        {site && site.status !== 'none' && site.status !== 'failed' && (
          <Button asChild size="sm" variant="outline">
            <a href={site.url} rel="noreferrer" target="_blank" title={site.url}>
              <EyeIcon />
              Preview site
            </a>
          </Button>
        )}
        {localRun.button}
        {ultimatePreview.button}
        <Button
          disabled={
            preview || pr.blockers.length > 0 || (pinned !== undefined && pinned !== pr.headSha)
          }
          onClick={() => setDialog('merge')}
          size="sm"
          title={preview ? 'Off in a preview' : undefined}
        >
          <GitMergeIcon />
          Merge
        </Button>
        <Button
          className="ml-auto text-muted-foreground"
          disabled={preview}
          onClick={() => setDialog('close')}
          size="sm"
          title={preview ? 'Off in a preview' : undefined}
          variant="ghost"
        >
          Close PR
        </Button>
      </div>
      {openError && <p className="mt-2 text-[12.5px] text-error">{openError}</p>}
      <div className="mt-3 space-y-1 text-[12.5px]">
        {preview && (
          <p className="text-muted-foreground">
            This is a preview: merging, closing, commenting and reviewing are off here.
          </p>
        )}
        {site && <SitePreviewNote site={site} />}
        {localRun.note}
        {ultimatePreview.note}
        {pinned === pr.headSha && (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <CheckIcon className="size-3.5 text-success" />
            You opened the diff at {pr.headSha.slice(0, 7)}, the current head.
          </p>
        )}
        {pinned !== undefined && pinned !== pr.headSha && (
          <p className="text-warning">
            New commits since you opened the diff ({pinned.slice(0, 7)} → {pr.headSha.slice(0, 7)}):
            review the diff again before merging.{' '}
            <button className="underline underline-offset-2" onClick={forget} type="button">
              Forget
            </button>
          </p>
        )}
        {pr.blockers.map((blocker) => (
          <p className="text-muted-foreground" key={blocker}>
            Merge waits: {blocker}
          </p>
        ))}
      </div>

      <Section title="Checks">
        {pr.checkList.length === 0 ? (
          <p className="font-mono text-[11.5px] text-muted-foreground/70">No checks reported.</p>
        ) : (
          <ul className="space-y-1">
            {pr.checkList.map((check) => (
              <li className="flex items-center gap-2 text-[12.5px]" key={check.name}>
                <ChecksIcon state={check.state} />
                {check.url ? (
                  <a className="hover:underline" href={check.url} rel="noreferrer" target="_blank">
                    {check.name}
                  </a>
                ) : (
                  check.name
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Description">
        {pr.body.trim() ? (
          <div className="text-[13.5px]">
            <MessageResponse>{pr.body}</MessageResponse>
          </div>
        ) : (
          <p className="font-mono text-[11.5px] text-muted-foreground/70">No description.</p>
        )}
      </Section>

      <Section title={`Conversation (${pr.timeline.length})`}>
        <Timeline items={pr.timeline} viewer={viewer} />
        {!preview && <Composer onSent={() => void view.refetch()} pr={pr} />}
      </Section>

      <MergeDialog
        onMerged={() => {
          setDialog(null)
          forget()
          onDone(
            `Merged #${pr.number} into ${pr.base}. Local ${pr.base} follows within five minutes when Ultimate opened the PR.`,
          )
        }}
        onOpenChange={(open) => setDialog(open ? 'merge' : null)}
        open={dialog === 'merge'}
        pinned={pinned}
        pr={pr}
      />
      <CloseDialog
        onClosed={() => {
          setDialog(null)
          forget()
          onDone(`Closed #${pr.number}.`)
        }}
        onOpenChange={(open) => setDialog(open ? 'close' : null)}
        open={dialog === 'close'}
        pr={pr}
      />
    </>
  )
}

// ── The surface ──

function PullRequests() {
  const list = useAction(ListAction, null, { every: 60_000, focus: true })
  const [selected, setSelected] = useSelected()
  const [done, setDone] = useState<string | null>(null)
  const viewport = useViewport()
  const phone = viewport === 'phone'
  const data = list.data
  const prs = data?.status === 'ok' ? data.prs : []
  const number = selected !== null && prs.some((pr) => pr.number === selected) ? selected : null
  const select = (n: number | null) => {
    setDone(null)
    setSelected(n)
  }
  const detail =
    data?.status === 'ok' && number !== null ? (
      <Detail
        key={number}
        number={number}
        onDone={(message) => {
          setDone(message)
          setSelected(null)
          void list.refetch()
        }}
        preview={data.preview}
        repo={data.repo}
        viewer={data.viewer}
      />
    ) : done ? (
      <p className="flex items-center gap-2 text-[13px]">
        <CheckIcon className="size-4 text-success" />
        {done}
      </p>
    ) : (
      <Quiet>{prs.length ? 'Pick a pull request.' : ''}</Quiet>
    )
  const showList = !phone || number === null
  return (
    <>
      <Header>
        {phone && number !== null && (
          <Button
            aria-label="All pull requests"
            className="size-7 shrink-0 text-muted-foreground pointer-coarse:size-9"
            onClick={() => select(null)}
            size="icon"
            variant="ghost"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
        )}
        <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
          <GitPullRequestIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="max-md:hidden">PRs</span>
          {data?.status === 'ok' && (
            <span className="truncate font-mono text-[11.5px] font-normal text-muted-foreground">
              {data.repo} · {prs.length} open
            </span>
          )}
          {data?.status === 'ok' && data.preview && <Tag tone="warning">preview</Tag>}
        </span>
        <Button
          aria-label="Reload"
          className="ml-auto pointer-coarse:size-11"
          onClick={() => void list.refetch()}
          size="icon-xs"
          variant="ghost"
        >
          <RefreshCwIcon className={cn(list.loading && 'animate-spin')} />
        </Button>
      </Header>
      <div className="flex min-h-0 flex-1">
        {data?.status === 'setup' ? (
          <Quiet>{data.reason}</Quiet>
        ) : list.error && !data ? (
          <Quiet>{list.error.message}</Quiet>
        ) : !data ? (
          <Quiet>loading…</Quiet>
        ) : (
          <>
            {showList && (
              <List
                className={phone ? 'flex-1' : 'w-80 shrink-0 border-r border-border/70'}
                onSelect={select}
                prs={prs}
                selected={number}
                viewer={data.viewer}
              />
            )}
            {(!phone || number !== null) && (
              <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5 max-md:px-4 max-md:py-4">
                <div className="mx-auto max-w-3xl">{detail}</div>
              </main>
            )}
          </>
        )}
        {viewport === 'desktop' && (
          <Dock>
            <Conversation variant="dock" />
          </Dock>
        )}
      </div>
      <StatusLine />
    </>
  )
}

// ── Elsewhere: the status line count and PR links in messages ──

function OpenCount() {
  const list = useAction(ListAction, null, { every: 5 * 60_000 })
  const { showSurface } = useUltimate()
  const data = list.data
  if (data?.status !== 'ok' || data.prs.length === 0) return null
  const ready = data.prs.filter((pr) => pr.blockers.length === 0).length
  return (
    <button
      className="-mx-1 flex cursor-pointer items-center gap-1.5 rounded-sm px-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={() => showSurface(SURFACE)}
      title={`${data.prs.length} open pull requests on ${data.repo}, ${ready} ready to merge`}
      type="button"
    >
      <GitPullRequestIcon className="size-3" />
      {data.prs.length} PRs
      {ready > 0 && <span className="text-success">· {ready} ready</span>}
    </button>
  )
}

const prLink = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\/?(?:[?#].*)?$/

/** A link to one of this repository's PRs opens it here; ⌘- or Ctrl-click still opens GitHub. */
function Link({ href, children, core }: { href: string; children: ReactNode; core: ReactNode }) {
  const match = prLink.exec(href)
  const list = useAction(ListAction, null, { enabled: match !== null })
  const [, setSelected] = useSelected()
  const { showSurface } = useUltimate()
  const n = Number(match?.[2])
  // Only open PRs of this repository: a merged or closed one, or another repository's, stays a GitHub link.
  if (
    !match ||
    list.data?.status !== 'ok' ||
    list.data.repo !== match[1] ||
    !list.data.prs.some((pr) => pr.number === n)
  )
    return core
  return (
    <a
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) return
        event.preventDefault()
        setSelected(n)
        showSurface(SURFACE)
      }}
      rel="noreferrer"
      target="_blank"
      title={`Open PR #${n} in PRs (⌘-click: GitHub)`}
    >
      {children}
    </a>
  )
}

export default defineWebExtension({
  surfaces: [
    {
      id: SURFACE,
      title: 'PRs',
      icon: GitPullRequestIcon,
      description: "The project's open GitHub PRs: diff, CI, comments, merge",
      order: 55,
      component: PullRequests,
    },
  ],
  commands: [
    {
      id: 'pull-requests.open',
      title: 'Open PRs',
      run: (context) => context.showSurface(SURFACE),
    },
  ],
  slots: { 'statusline.right': [OpenCount] },
  link: Link,
})
