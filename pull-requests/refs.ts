/** Pull requests: the project's open GitHub PRs through `gh`. Browser-safe. */
import { actionRef } from '@/sdk/solid'

/** A check rolled up: `none` when the PR reports no checks. */
export type Checks = 'pass' | 'fail' | 'pending' | 'none'

export type Check = { name: string; state: 'pass' | 'fail' | 'pending'; url?: string }

export type PrSummary = {
  number: number
  title: string
  author: string
  head: string
  base: string
  draft: boolean
  checks: Checks
  /** `MERGEABLE`, `CONFLICTING` or `UNKNOWN` while GitHub computes it. */
  mergeable: string
  /** Why Merge is refused now; empty when it is allowed. */
  blockers: string[]
  updatedAt: string
  url: string
}

export type PrList =
  /** `preview`: this server is a preview instance, where commenting, reviewing, merging and closing are off. */
  | { status: 'ok'; repo: string; viewer: string; prs: PrSummary[]; preview: boolean }
  /** No GitHub `origin`, or `gh` missing or logged out: a screen of its own. */
  | { status: 'setup'; reason: string }

export type TimelineItem = {
  kind: 'comment' | 'review' | 'inline'
  author: string
  body: string
  at: string
  /** A review's verdict: APPROVED, CHANGES_REQUESTED, COMMENTED. */
  state?: string
  /** An inline comment's file and line. */
  path?: string
  line?: number
  url?: string
}

export type PrDetail = PrSummary & {
  body: string
  state: string
  headSha: string
  additions: number
  deletions: number
  changedFiles: number
  reviewDecision: string
  checkList: Check[]
  timeline: TimelineItem[]
  /** The author is the `gh` user: GitHub refuses approving or requesting changes on one's own PR. */
  own: boolean
  /** It changes `.ultimate/`, so an Ultimate preview of its head shows what it does. */
  ultimate: boolean
  /**
   * Its author may write to the repository and it comes from no fork: only then is an Ultimate preview offered, since a
   * preview runs the commit's `.ultimate/` code as the user.
   */
  trusted: boolean
}

/**
 * A PR's deployed site preview, when the user setting `pullRequests.sitePreviews["owner/repo"]` names its URL
 * (`https://pr-{n}.example.com`). `ready`: the preview check passed on the PR's head; `building` and `failed`: that
 * check runs or failed; `earlier`: no check on the head but the URL answers, so it is from an earlier commit and
 * later commits did not trigger a build; `none`: no preview.
 */
export type SitePreview =
  | { status: 'off' }
  | {
      status: 'ready' | 'building' | 'failed' | 'earlier' | 'none'
      url: string
      /** The PR's head commit. */
      head: string
      check?: Check
    }

/**
 * A PR run on this machine by the user setting `pullRequests.localRun["owner/repo"]` (`npm run pr:run {n}`), detached in
 * its own process group. `starting`: no URL in its log yet; `running`: its log printed `url`; `stopping`: SIGTERM sent,
 * it is cleaning up; `failed`: it exited by itself, with the last lines of its log.
 */
export type LocalRun = {
  number: number
  /** The PR's head when it started. */
  head: string
  startedAt: string
} & (
  | { status: 'starting' | 'stopping' }
  /** `tailnet`: the same run over `tailscale serve`, when Tailscale is up. */
  | { status: 'running'; url: string; tailnet?: string }
  | { status: 'failed'; error: string }
)
/** `enabled`: the setting names a command for this repository. */
export type LocalRuns = { enabled: boolean; runs: LocalRun[] }

/** A preview server of `instance` (its `refs.ts`): user-started ones carry `label` and `ref`. */
export type InstancePreview = {
  id: string
  url: string
  conversationId?: number
  label?: string
  ref?: string
  running: boolean
  tailnet?: string
}
export const InstanceListAction = actionRef<null, InstancePreview[]>('instance', 'list')
/** User-only: preview a local commit as `label`; resolves once its UI is up. */
export const InstanceStartAction = actionRef<{ ref: string; label: string }, InstancePreview>(
  'instance',
  'start',
)
/** User-only: stop a preview the user started. */
export const InstanceStopAction = actionRef<{ id: string }, null>('instance', 'stop')
/** The `label` of PR `n`'s Ultimate preview. */
export const previewLabel = (n: number) => `PR #${n}`

/** No arguments → the open PRs of the project's GitHub `origin`. */
export const ListAction = actionRef<null, PrList>('pull-requests', 'list')
/** `{ number }` → the PR with its checks, description and comments. */
export const ViewAction = actionRef<{ number: number }, PrDetail>('pull-requests', 'view')
/** `{ number }` → its site preview and whether it is current. */
export const SitePreviewAction = actionRef<{ number: number }, SitePreview>(
  'pull-requests',
  'sitePreview',
)
/** `{ number }` → fetches its head and base into the project's repo; the Review spec `<base>...<head>` of its diff. */
export const FetchAction = actionRef<{ number: number }, { spec: string; head: string }>(
  'pull-requests',
  'fetch',
)
/** User only: `{ number, body }` → a comment on the PR. */
export const CommentAction = actionRef<{ number: number; body: string }, null>(
  'pull-requests',
  'comment',
)
/** User only, others' PRs: `{ number, event, body? }` → a review that approves or requests changes. */
export const ReviewAction = actionRef<
  { number: number; event: 'approve' | 'request-changes'; body?: string },
  null
>('pull-requests', 'review')
/** User only: `{ number, head }` → a merge commit, only with green CI, no conflicts, and `head` still the PR's head. */
export const MergeAction = actionRef<{ number: number; head: string }, null>(
  'pull-requests',
  'merge',
)
/** No arguments → whether PRs can run locally here, and the runs of this host. */
export const LocalRunsAction = actionRef<null, LocalRuns>('pull-requests', 'localRuns')
/** User only, trusted PRs: `{ number }` → starts the `localRun` command for it (restarts a run it has). */
export const RunLocallyAction = actionRef<{ number: number }, LocalRun>(
  'pull-requests',
  'runLocally',
)
/** User only: `{ number }` → SIGTERM to its run, which cleans up; resolves once it is gone. */
export const StopLocalRunAction = actionRef<{ number: number }, null>(
  'pull-requests',
  'stopLocalRun',
)
/** User only: `{ number }` → closes the PR without merging. */
export const CloseAction = actionRef<{ number: number }, null>('pull-requests', 'close')
