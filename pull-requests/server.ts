import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { defineExtension } from '@earendil-works/pi-durable'
import type {
  Check,
  Checks,
  LocalRun,
  LocalRuns,
  PrDetail,
  PrCard,
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
  host: {
    projectRoot: string
    userHome: string
    home: string
    resource<T>(key: string, create: () => T): T
    onClose(cleanup: () => Promise<void>): void
  }
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

/** `pullRequests.<key>[repo]` from the user's settings when it is a string with `{n}`, or undefined. */
async function template(ctx: Ctx, key: 'sitePreviews' | 'localRun', repo: string) {
  try {
    const settings = JSON.parse(
      await readFile(join(ctx.host.userHome, '.ultimate/settings.json'), 'utf8'),
    ) as { pullRequests?: Record<string, Record<string, unknown> | undefined> }
    const value = settings.pullRequests?.[key]?.[repo]
    return typeof value === 'string' && value.includes('{n}') ? value : undefined
  } catch {
    return undefined
  }
}

// ── Local runs: the user's `pullRequests.localRun` command, detached in its own process group ──

/** How many PRs may run locally at once. */
const RUN_CAP = 3
/** The first `tailscale serve` HTTPS port tried for a run's tailnet address. */
const TAILNET_PORTS = 4850
/** How long a stopped run may take to clean up before its group is killed. */
const STOP_GRACE = 20_000

type Run = {
  number: number
  head: string
  log: string
  child: ChildProcess
  /** The process group: the leader's PID. */
  group: number
  startedAt: string
  stopping?: Promise<void>
  /** Its tailnet publication, once its URL is known: the proxy and the `tailscale serve` HTTPS port. */
  published?: Promise<{ proxy: Server; port: number; url: string } | undefined>
}

let publishing: Promise<unknown> = Promise.resolve()

const tailscale = (args: string[]) =>
  promisify(execFile)('tailscale', args, { timeout: 15_000 }).then((result) => result.stdout)

/**
 * Publishes `local` (`http://localhost:<port>`) on the tailnet: a proxy on 127.0.0.1 that makes every request look
 * like it came from `local` (Host, Origin and Referer, since Forma takes POSTs only from its own origin and Vite checks
 * Host) and points redirects to `local` back at the tailnet URL, served by `tailscale serve --https` on a free port,
 * tailnet only. Undefined when Tailscale is off or has no HTTPS name.
 */
async function publish(local: string) {
  let dns: string
  let used: Set<number>
  try {
    const status = JSON.parse(await tailscale(['status', '--json'])) as {
      Self?: { DNSName?: string }
    }
    dns = status.Self?.DNSName?.replace(/\.$/, '') ?? ''
    if (!dns) return undefined
    const serve = JSON.parse((await tailscale(['serve', 'status', '--json'])) || '{}') as {
      TCP?: Record<string, unknown>
      Web?: Record<string, unknown>
    }
    const registry = JSON.parse(
      await readFile(join(homedir(), '.ultimate/tailscale.json'), 'utf8').catch(() => '{}'),
    ) as { ports?: Record<string, { port: number }> }
    used = new Set([
      ...Object.keys(serve.TCP ?? {}).map(Number),
      ...Object.keys(serve.Web ?? {}).map((authority) => Number(authority.split(':').at(-1))),
      ...Object.values(registry.ports ?? {}).map((entry) => entry.port),
    ])
  } catch {
    return undefined
  }
  const target = new URL(local)
  let port = TAILNET_PORTS
  while (used.has(port)) port++
  const url = `https://${dns}:${port}`
  const proxy = createServer((req, res) => {
    const headers = { ...req.headers, host: target.host }
    if (headers.origin) headers.origin = target.origin
    if (typeof headers.referer === 'string')
      headers.referer = headers.referer.replace(/^https?:\/\/[^/]+/, target.origin)
    const upstream = request(
      { host: target.hostname, port: target.port, path: req.url, method: req.method, headers },
      (response) => {
        const location = response.headers.location
        if (location?.startsWith(target.origin))
          response.headers.location = url + location.slice(target.origin.length)
        res.writeHead(response.statusCode ?? 502, response.headers)
        response.pipe(res)
      },
    )
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
  })
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done))
  const { port: proxied } = proxy.address() as AddressInfo
  try {
    await tailscale(['serve', '--bg', '--yes', `--https=${port}`, `http://127.0.0.1:${proxied}`])
  } catch {
    proxy.close()
    return undefined
  }
  return { proxy, port, url }
}

const alive = (group: number) => {
  try {
    process.kill(-group, 0)
    return true
  } catch {
    return false
  }
}

/**
 * SIGTERM to the run's process group, so the command's own handlers stop its server and clean up (`pr:run` removes its
 * worktree); whatever of the group is left after the grace is killed.
 */
function stopRun(runs: Map<number, Run>, run: Run) {
  run.stopping ??= (async () => {
    if (alive(run.group)) {
      try {
        process.kill(-run.group, 'SIGTERM')
      } catch {}
      const until = Date.now() + STOP_GRACE
      while (alive(run.group) && Date.now() < until)
        await new Promise((done) => setTimeout(done, 200))
      if (alive(run.group))
        try {
          process.kill(-run.group, 'SIGKILL')
        } catch {}
    }
    const published = await run.published
    if (published) {
      await tailscale(['serve', `--https=${published.port}`, 'off']).catch(() => {})
      published.proxy.close()
      published.proxy.closeAllConnections()
    }
    if (runs.get(run.number) === run) runs.delete(run.number)
  })()
  return run.stopping
}

/** The runs of this process, kept across reloads; all of them stop when the host stops. */
const localRuns = (ctx: Ctx) =>
  ctx.host.resource('pull-requests.localRuns', () => {
    const runs = new Map<number, Run>()
    ctx.host.onClose(async () => {
      await Promise.all([...runs.values()].map((run) => stopRun(runs, run)))
    })
    return runs
  })

async function describe(run: Run): Promise<LocalRun> {
  const log = await readFile(run.log, 'utf8').catch(() => '')
  const url = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+/.exec(log)?.[0]
  const base = { number: run.number, head: run.head, startedAt: run.startedAt }
  if (run.stopping) return { ...base, status: 'stopping' }
  if (!alive(run.group)) {
    const lines = log.trim().split('\n').slice(-3).join(' ').slice(0, 400)
    return { ...base, status: 'failed', error: lines || 'It exited without output.' }
  }
  if (!url) return { ...base, status: 'starting' }
  // One at a time, so two runs never pick the same free port.
  if (!run.published) {
    run.published = publishing.then(() => publish(url).catch(() => undefined))
    publishing = run.published
  }
  const tailnet = (await run.published)?.url
  return { ...base, status: 'running', url, ...(tailnet && { tailnet }) }
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

/** How long a hover card's PR stays cached: moving the pointer back and forth costs nothing. */
const CARD_TTL = 3 * 60_000
const cards = new Map<string, { at: number; card: Promise<PrCard> }>()

async function readCard(ctx: Ctx, repo: string, n: number): Promise<PrCard> {
  const raw = JSON.parse(
    await run(ctx, 'gh', [
      'pr',
      'view',
      String(n),
      '-R',
      repo,
      '--json',
      'title,state,isDraft,author,baseRefName,headRefName,additions,deletions,changedFiles,statusCheckRollup,reviewDecision,updatedAt',
    ]),
  ) as RawPr & {
    state: string
    additions: number
    deletions: number
    changedFiles: number
    reviewDecision: string
  }
  return {
    repo,
    number: n,
    title: raw.title,
    state:
      raw.state === 'MERGED'
        ? 'merged'
        : raw.state === 'CLOSED'
          ? 'closed'
          : raw.isDraft
            ? 'draft'
            : 'open',
    author: raw.author.login,
    base: raw.baseRefName,
    head: raw.headRefName,
    additions: raw.additions,
    deletions: raw.deletions,
    files: raw.changedFiles,
    checks: rollup((raw.statusCheckRollup ?? []).map(check)),
    review:
      raw.reviewDecision === 'APPROVED'
        ? 'approved'
        : raw.reviewDecision === 'CHANGES_REQUESTED'
          ? 'changes'
          : raw.reviewDecision === 'REVIEW_REQUIRED'
            ? 'required'
            : 'none',
    updatedAt: raw.updatedAt,
  }
}

export const userActions = ['comment', 'review', 'merge', 'close', 'runLocally', 'stopLocalRun']
export const pollActions = ['list', 'view', 'sitePreview', 'localRuns', 'card']

export const actions = {
  async card(args: unknown, ctx: Ctx): Promise<PrCard> {
    const n = number(args)
    const repo = (args as { repo?: unknown }).repo
    if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo))
      throw new Error('Expected { repo: "owner/name", number }')
    const key = `${repo}#${n}`
    const now = Date.now()
    for (const [old, entry] of cards) if (now - entry.at > CARD_TTL) cards.delete(old)
    let entry = cards.get(key)
    if (!entry) {
      entry = { at: now, card: readCard(ctx, repo, n) }
      cards.set(key, entry)
      entry.card.catch(() => cards.delete(key))
    }
    return entry.card
  },

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
    const site = await template(ctx, 'sitePreviews', repo)
    if (!site) return { status: 'off' }
    const url = site.replace('{n}', String(n)).replace(/\/+$/, '')
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

  async localRuns(_args: unknown, ctx: Ctx): Promise<LocalRuns> {
    if (inPreview()) return { enabled: false, runs: [] }
    const found = await repoOf(ctx)
    const enabled = 'repo' in found && (await template(ctx, 'localRun', found.repo)) !== undefined
    return { enabled, runs: await Promise.all([...localRuns(ctx).values()].map(describe)) }
  },

  async runLocally(args: unknown, ctx: Ctx): Promise<LocalRun> {
    notInPreview()
    const n = number(args)
    const { repo } = await context(ctx)
    const command = await template(ctx, 'localRun', repo)
    if (!command)
      throw new Error(`No pullRequests.localRun command for ${repo} in ~/.ultimate/settings.json.`)
    const pr = await detail(ctx, n)
    if (!pr.trusted)
      throw new Error(
        `PR #${n} is from a fork or from someone without write access: running it locally would run their code as you.`,
      )
    const runs = localRuns(ctx)
    const previous = runs.get(n)
    if (previous) await stopRun(runs, previous)
    // A run that exited on its own (a failed start) stays listed with its error, but takes no slot.
    if ([...runs.values()].filter((item) => alive(item.group)).length >= RUN_CAP)
      throw new Error(`${RUN_CAP} PRs already run locally: stop one first.`)
    const [program, ...rest] = command.replaceAll('{n}', String(n)).trim().split(/\s+/)
    const dir = join(ctx.host.home, 'pr-runs')
    mkdirSync(dir, { recursive: true })
    const log = join(dir, `${n}.log`)
    const fd = openSync(log, 'w')
    let child: ChildProcess
    try {
      child = spawn(program!, rest, {
        cwd: ctx.host.projectRoot,
        detached: true,
        stdio: ['ignore', fd, fd],
      })
    } finally {
      closeSync(fd)
    }
    child.unref()
    child.on('error', () => {})
    if (child.pid === undefined) throw new Error(`Could not start ${program}.`)
    const run: Run = {
      number: n,
      head: pr.headSha,
      log,
      child,
      group: child.pid,
      startedAt: new Date().toISOString(),
    }
    runs.set(n, run)
    return describe(run)
  },

  async stopLocalRun(args: unknown, ctx: Ctx) {
    const n = number(args)
    const runs = localRuns(ctx)
    const run = runs.get(n)
    if (run) await stopRun(runs, run)
    return null
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
