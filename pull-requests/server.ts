import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineExtension } from '@earendil-works/pi-durable'
import type {
  Check,
  Checks,
  PrDetail,
  PrList,
  PrSummary,
  SitePreview,
  TimelineItem,
} from './refs.ts'

/**
 * The project's open GitHub pull requests through `gh`, as the logged-in `gh` user. Reading and fetching are open to
 * agents; commenting, reviewing, merging and closing are `userActions`, so only the UI calls them. Merge re-reads the
 * PR first and refuses unless CI passed, GitHub reports it mergeable, and its head is the commit the user reviewed;
 * `--match-head-commit` makes GitHub refuse too if the head moves in between.
 */
export default defineExtension({ name: 'pull-requests' })

type Ctx = {
  host: { projectRoot: string; userHome: string }
  exec(
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ): Promise<{ stdout: string; stderr: string }>
}

/**
 * A preview instance (`instance start`) has this set. Its PRs tab reads the same GitHub repository, so everything that
 * acts on GitHub is off there: the preview is for looking.
 */
const inPreview = () => Boolean(process.env.ULTIMATE_INSTANCE_OWNER)
function notInPreview() {
  if (inPreview()) throw new Error('This is a preview: act on PRs from the main Ultimate.')
}

const run = async (ctx: Ctx, command: string, args: string[]) =>
  (await ctx.exec(command, args, { cwd: ctx.host.projectRoot, timeout: 30_000 })).stdout.trim()

const failure = (error: unknown) => {
  const text = (error as { stderr?: string }).stderr?.trim() || String(error)
  return text.split('\n').slice(-3).join(' ').slice(0, 400)
}

/** `owner/name` of the project's `origin` on GitHub, or why there is none. */
async function repoOf(ctx: Ctx): Promise<{ repo: string } | { reason: string }> {
  const url = await run(ctx, 'git', ['remote', 'get-url', 'origin']).catch(() => '')
  // An SSH host alias such as `github.com-work` (from ~/.ssh/config) still names GitHub.
  const match = /github\.com[\w.-]*[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url)
  if (!match)
    return {
      reason: url ? `origin is not on GitHub: ${url}` : 'This project has no origin remote.',
    }
  return { repo: `${match[1]}/${match[2]}` }
}

let viewer: string | undefined
async function viewerOf(ctx: Ctx) {
  viewer ??= await run(ctx, 'gh', ['api', 'user', '--jq', '.login'])
  return viewer
}

async function context(ctx: Ctx) {
  const found = await repoOf(ctx)
  if ('reason' in found) throw new Error(found.reason)
  return { repo: found.repo, viewer: await viewerOf(ctx) }
}

type RawCheck = {
  __typename?: string
  name?: string
  context?: string
  status?: string
  conclusion?: string
  state?: string
  detailsUrl?: string
  targetUrl?: string
}

function check(raw: RawCheck): Check {
  const name = raw.name ?? raw.context ?? 'check'
  const url = raw.detailsUrl ?? raw.targetUrl
  let state: Check['state']
  if (raw.__typename === 'StatusContext' || raw.state)
    state =
      raw.state === 'SUCCESS'
        ? 'pass'
        : raw.state === 'PENDING' || raw.state === 'EXPECTED'
          ? 'pending'
          : 'fail'
  else if (raw.status !== 'COMPLETED') state = 'pending'
  else state = ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(raw.conclusion ?? '') ? 'pass' : 'fail'
  return { name, state, ...(url && { url }) }
}

function rollup(checks: Check[]): Checks {
  if (checks.length === 0) return 'none'
  if (checks.some((c) => c.state === 'fail')) return 'fail'
  if (checks.some((c) => c.state === 'pending')) return 'pending'
  return 'pass'
}

type RawPr = {
  number: number
  title: string
  author: { login: string }
  headRefName: string
  baseRefName: string
  isDraft: boolean
  mergeable: string
  state?: string
  statusCheckRollup: RawCheck[] | null
  updatedAt: string
  url: string
}

/** Why Merge is refused now: the strict rule, no override. */
function blockers(pr: RawPr, checks: Check[]): string[] {
  const out: string[] = []
  if (pr.state && pr.state !== 'OPEN') out.push(`The PR is ${pr.state.toLowerCase()}.`)
  if (pr.isDraft) out.push('It is a draft.')
  if (pr.mergeable === 'CONFLICTING') out.push('It has merge conflicts with its base.')
  if (pr.mergeable === 'UNKNOWN') out.push('GitHub is still checking whether it merges cleanly.')
  const state = rollup(checks)
  if (state === 'none') out.push('No CI checks reported yet.')
  if (state === 'pending') out.push('CI is still running.')
  if (state === 'fail')
    out.push(
      `CI failed: ${checks
        .filter((c) => c.state === 'fail')
        .map((c) => c.name)
        .join(', ')}.`,
    )
  return out
}

function summary(pr: RawPr): PrSummary {
  const checks = (pr.statusCheckRollup ?? []).map(check)
  return {
    number: pr.number,
    title: pr.title,
    author: pr.author.login,
    head: pr.headRefName,
    base: pr.baseRefName,
    draft: pr.isDraft,
    checks: rollup(checks),
    mergeable: pr.mergeable,
    blockers: blockers(pr, checks),
    updatedAt: pr.updatedAt,
    url: pr.url,
  }
}

const summaryFields =
  'number,title,author,headRefName,baseRefName,isDraft,mergeable,statusCheckRollup,updatedAt,url'

function number(args: unknown) {
  const value = (args as { number?: unknown } | null)?.number
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error('Expected { number }: a PR number')
  return value
}

function text(value: unknown, what: string, required = true) {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || (required && !value.trim())) throw new Error(`${what} is empty`)
  if (value.length > 20_000) throw new Error(`${what} is over 20,000 characters`)
  return value.trim() || undefined
}

type RawDetail = RawPr & {
  body: string
  state: string
  headRefOid: string
  additions: number
  deletions: number
  changedFiles: number
  reviewDecision: string
  isCrossRepository: boolean
  comments: { author: { login: string }; body: string; createdAt: string; url: string }[]
  reviews: { author: { login: string }; body: string; state: string; submittedAt: string }[]
}

/** Logins that may write to a repository, by `<repo>/<login>`, for this process: permissions rarely change. */
const writers = new Map<string, boolean>()
async function canWrite(ctx: Ctx, repo: string, login: string) {
  const key = `${repo}/${login}`
  if (!writers.has(key)) {
    const permission = await run(ctx, 'gh', [
      'api',
      `repos/${repo}/collaborators/${login}/permission`,
      '--jq',
      '.permission',
    ]).catch(() => undefined)
    // A failed lookup counts as no access this time and is asked again next time.
    if (permission === undefined) return false
    writers.set(key, ['admin', 'maintain', 'write'].includes(permission))
  }
  return writers.get(key)!
}

async function detail(ctx: Ctx, n: number): Promise<PrDetail> {
  const { repo, viewer } = await context(ctx)
  const [raw, files, inline] = await Promise.all([
    run(ctx, 'gh', [
      'pr',
      'view',
      String(n),
      '-R',
      repo,
      '--json',
      `${summaryFields},body,state,headRefOid,additions,deletions,changedFiles,reviewDecision,isCrossRepository,comments,reviews`,
    ]).then((out) => JSON.parse(out) as RawDetail),
    run(ctx, 'gh', [
      'api',
      '--paginate',
      `repos/${repo}/pulls/${n}/files?per_page=100`,
      '--jq',
      '.[].filename',
    ]).then((out) => out.split('\n')),
    run(ctx, 'gh', [
      'api',
      `repos/${repo}/pulls/${n}/comments?per_page=100`,
      '--jq',
      '[.[] | {author: .user.login, body, at: .created_at, path, line: (.line // .original_line), url: .html_url}]',
    ]).then((out) => JSON.parse(out || '[]') as TimelineItem[]),
  ])
  const checks = (raw.statusCheckRollup ?? []).map(check)
  const timeline: TimelineItem[] = [
    ...raw.comments.map((c) => ({
      kind: 'comment' as const,
      author: c.author.login,
      body: c.body,
      at: c.createdAt,
      url: c.url,
    })),
    // A COMMENTED review without a body only holds inline comments, which are listed on their own.
    ...raw.reviews
      .filter((r) => r.body.trim() || r.state !== 'COMMENTED')
      .map((r) => ({
        kind: 'review' as const,
        author: r.author.login,
        body: r.body,
        at: r.submittedAt,
        state: r.state,
      })),
    ...inline.map((c) => ({ ...c, kind: 'inline' as const })),
  ].toSorted((a, b) => a.at.localeCompare(b.at))
  return {
    ...summary(raw),
    blockers: blockers(raw, checks),
    body: raw.body,
    state: raw.state,
    headSha: raw.headRefOid,
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
    reviewDecision: raw.reviewDecision,
    checkList: checks,
    timeline,
    own: raw.author.login === viewer,
    ultimate: files.some((file) => file.startsWith('.ultimate/')),
    trusted: !raw.isCrossRepository && (await canWrite(ctx, repo, raw.author.login)),
  }
}

/** The site preview URL template for `repo` from the user's settings, or undefined. */
async function previewTemplate(ctx: Ctx, repo: string) {
  try {
    const settings = JSON.parse(
      await readFile(join(ctx.host.userHome, '.ultimate/settings.json'), 'utf8'),
    ) as { pullRequests?: { sitePreviews?: Record<string, unknown> } }
    const template = settings.pullRequests?.sitePreviews?.[repo]
    return typeof template === 'string' && template.includes('{n}') ? template : undefined
  } catch {
    return undefined
  }
}

/** Whether the preview answers: any status below 400 counts, redirects included. */
async function answers(url: string) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    })
    return response.status < 400
  } catch {
    return false
  }
}

export const userActions = ['comment', 'review', 'merge', 'close']
export const pollActions = ['list', 'view', 'sitePreview']

export const actions = {
  async list(_args: unknown, ctx: Ctx): Promise<PrList> {
    const found = await repoOf(ctx)
    if ('reason' in found) return { status: 'setup', reason: found.reason }
    let me: string
    try {
      me = await viewerOf(ctx)
    } catch (error) {
      return { status: 'setup', reason: `gh is missing or logged out: ${failure(error)}` }
    }
    const out = await run(ctx, 'gh', [
      'pr',
      'list',
      '-R',
      found.repo,
      '--state',
      'open',
      '--limit',
      '50',
      '--json',
      summaryFields,
    ])
    return {
      status: 'ok',
      repo: found.repo,
      viewer: me,
      prs: (JSON.parse(out) as RawPr[]).map(summary),
      preview: inPreview(),
    }
  },

  view: (args: unknown, ctx: Ctx) => detail(ctx, number(args)),

  async sitePreview(args: unknown, ctx: Ctx): Promise<SitePreview> {
    const n = number(args)
    const { repo } = await context(ctx)
    const template = await previewTemplate(ctx, repo)
    if (!template) return { status: 'off' }
    const url = template.replace('{n}', String(n)).replace(/\/+$/, '')
    const [raw, up] = await Promise.all([
      run(ctx, 'gh', [
        'pr',
        'view',
        String(n),
        '-R',
        repo,
        '--json',
        'headRefOid,statusCheckRollup',
      ]).then((out) => JSON.parse(out) as { headRefOid: string; statusCheckRollup: RawCheck[] }),
      answers(url),
    ])
    // The deploy check of the head commit; the workflow's cleanup job on close is not it.
    const deploy = (raw.statusCheckRollup ?? [])
      .map(check)
      .find((item) => /preview/i.test(item.name) && !/remove|clean|delete/i.test(item.name))
    const status: Exclude<SitePreview, { status: 'off' }>['status'] = deploy
      ? deploy.state === 'pass'
        ? up
          ? 'ready'
          : 'none'
        : deploy.state === 'pending'
          ? 'building'
          : 'failed'
      : up
        ? 'earlier'
        : 'none'
    return { status, url, head: raw.headRefOid, ...(deploy && { check: deploy }) }
  },

  async fetch(args: unknown, ctx: Ctx) {
    const n = number(args)
    const pr = await detail(ctx, n)
    if (!/^[\w./-]+$/.test(pr.base) || pr.base.includes('..') || pr.base.startsWith('-'))
      throw new Error(`Unexpected base branch name: ${pr.base}`)
    await run(ctx, 'git', [
      'fetch',
      '--no-tags',
      'origin',
      `+refs/pull/${n}/head:refs/remotes/origin/pr/${n}`,
      `+refs/heads/${pr.base}:refs/remotes/origin/${pr.base}`,
    ])
    const [base, head] = await Promise.all([
      run(ctx, 'git', ['rev-parse', '--verify', `refs/remotes/origin/${pr.base}^{commit}`]),
      run(ctx, 'git', ['rev-parse', '--verify', `refs/remotes/origin/pr/${n}^{commit}`]),
    ])
    return { spec: `${base}...${head}`, head }
  },

  async comment(args: unknown, ctx: Ctx) {
    notInPreview()
    const n = number(args)
    const body = text((args as { body?: unknown }).body, 'The comment')!
    const { repo } = await context(ctx)
    await run(ctx, 'gh', ['pr', 'comment', String(n), '-R', repo, '--body', body])
    return null
  },

  async review(args: unknown, ctx: Ctx) {
    notInPreview()
    const n = number(args)
    const { event, body: raw } = args as { event?: unknown; body?: unknown }
    if (event !== 'approve' && event !== 'request-changes')
      throw new Error('event must be approve or request-changes')
    const body = text(raw, 'The review', event === 'request-changes')
    const { repo, viewer } = await context(ctx)
    const author = await run(ctx, 'gh', [
      'pr',
      'view',
      String(n),
      '-R',
      repo,
      '--json',
      'author',
      '--jq',
      '.author.login',
    ])
    if (author === viewer)
      throw new Error('GitHub does not let you approve or request changes on your own PR.')
    await run(ctx, 'gh', [
      'pr',
      'review',
      String(n),
      '-R',
      repo,
      event === 'approve' ? '--approve' : '--request-changes',
      ...(body ? ['--body', body] : []),
    ])
    return null
  },

  async merge(args: unknown, ctx: Ctx) {
    notInPreview()
    const n = number(args)
    const head = (args as { head?: unknown }).head
    if (typeof head !== 'string' || !/^[0-9a-f]{40}$/.test(head))
      throw new Error('Expected head: the full SHA of the commit you reviewed')
    const pr = await detail(ctx, n)
    if (pr.headSha !== head)
      throw new Error(
        `PR #${n} changed since you reviewed it (${head.slice(0, 7)} → ${pr.headSha.slice(0, 7)}): review the new head first.`,
      )
    if (pr.blockers.length) throw new Error(`Not merged: ${pr.blockers.join(' ')}`)
    const { repo } = await context(ctx)
    try {
      await run(ctx, 'gh', [
        'pr',
        'merge',
        String(n),
        '-R',
        repo,
        '--merge',
        '--match-head-commit',
        head,
      ])
    } catch (error) {
      throw new Error(`gh refused the merge: ${failure(error)}`)
    }
    return null
  },

  async close(args: unknown, ctx: Ctx) {
    notInPreview()
    const n = number(args)
    const { repo } = await context(ctx)
    await run(ctx, 'gh', ['pr', 'close', String(n), '-R', repo])
    return null
  },
}
