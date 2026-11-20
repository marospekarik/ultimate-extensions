Review and merge the project's open GitHub pull requests without leaving Ultimate.

The **PRs** surface lists the open PRs of the project's GitHub `origin`, read through `gh` as its logged-in
user: title, author, branch, CI rollup and whether Merge is allowed. It refreshes every minute while on screen.
Opening one shows what blocks a merge, its CI checks linked to their runs, the description, and the comments, reviews
and inline comments in time order.

- **Review diff** fetches the PR's head into `refs/remotes/origin/pr/<n>` and its base branch, then opens the Review
  surface at `<base>...<head>`, which is GitHub's diff. Inline comments there go to an agent as Review sends them:
  by default to the conversation in the head commit's `Ultimate-Conversation` trailer (the branch that made it; else
  @ultimate, and the **to** picker can change it), and it fixes
  the code and submits again, which updates the PR. The head opened this way is the head you reviewed.
- **Preview site** opens the PR's deployed site preview, when the user setting names where it lives:
  `{ "pullRequests": { "sitePreviews": { "owner/repo": "https://pr-{n}.example.com" } } }` in
  `~/.ultimate/settings.json`. A line under the buttons says whether it is current: built for the head (the head's
  preview check passed), building, failed (linked to the run), from an earlier commit (no preview check on the head,
  but the URL answers: later commits did not change the site), or none. The deploy check is the one whose name
  contains "preview" but not "remove", "clean" or "delete". Repositories without the setting show nothing.
- **Run locally** runs the PR on this machine with the command the user setting names:
  `{ "pullRequests": { "localRun": { "owner/repo": "npm run pr:run {n}" } } }` in `~/.ultimate/settings.json`
  (`{n}` is the PR number; the command is split on spaces, no shell). It starts in the project checkout as a detached
  process group that outlives the action, writing `pr-runs/<n>.log` in the instance home; the first
  `http://localhost:<port>` in that log is its address. A line under the buttons links it with the commit it started
  on, and **Stop** sends SIGTERM to its group so the command cleans up (Forma's `pr:run` removes its worktree and data),
  killing what is left after 20 s. When the PR has new commits since, **Restart it** starts it on the new head. A run
  that exits by itself shows the end of its log. At most three run at once, the runs survive extension reloads, and a
  host stop stops them all. When Tailscale is up, each run is also published on the tailnet (never Funnel): a proxy
  on 127.0.0.1 rewrites Host, Origin and Referer to the run's localhost address (Forma takes POSTs only from its own
  origin) and redirects back to the tailnet URL, and `tailscale serve --https=<port>` (from 4850, skipping ports in
  use) points at it. A page opened over the tailnet links that address; Stop turns off the mapping and the proxy with
  the run. Without Tailscale, the line says the run is reachable only on this machine. Offered only on PRs from people with write access and never from forks, since it runs the PR's code as you;
  repositories without the setting show nothing. The list marks running PRs `running`.
- **Ultimate preview** shows on PRs that change `.ultimate/`. It fetches the PR's head (as Review diff does) and asks
  `instance` to `start` a separate Ultimate on that commit, labelled `PR #<n>`, with the commit as its project: the
  PR's agents, extensions and settings run there. Once it is up, a line under the buttons links it: here the
  `instance` link renderer shows it in the frame below the title bar, and on a page opened over the tailnet it opens
  its tailnet address in a new tab. **Stop** ends it; when the PR has new commits since, **Restart it** starts it on
  the new head. At most two PR previews run: starting a third stops the one started or opened longest ago (the
  `instance` cap of three, shared with agents' previews, still applies). `instance` stops one after an hour with no
  page open, and a host restart stops them all. A preview spends nothing until someone talks to its agents.
  It is offered only for PRs whose author may write to the repository and that come from no fork, since a preview
  runs the commit's `.ultimate/` code as you. The list marks PRs with a running preview `preview`.
- **Comment** posts a PR comment on GitHub.
- **Approve** and **Request changes** show only on other people's PRs: GitHub refuses both on your own.
- **Merge** makes a merge commit. The confirm dialog names the commit it pins: the head you last opened in Review, or
  the head on screen if you never did. The server reads the PR again and refuses unless it is open, not a draft,
  mergeable, every check passed (SUCCESS, NEUTRAL or SKIPPED; no checks at all is refused), and its head is still that
  commit; `gh pr merge --merge --match-head-commit` then makes GitHub refuse too if the head moved in between. There
  is no override. The remote branch is kept.
- **Close** closes the PR without merging, after a confirm.

After a merge, local `main` follows through the workspaces lander, which checks the PRs it opened every five minutes
and fast-forwards the target (see `extensions/workspaces/README.md`, "Pull request mode"). A merged PR the lander did
not open reaches local `main` with the next one it did, or a `git pull`.

Links to this repository's open PRs in messages open the PR here (⌘- or Ctrl-click still opens GitHub). ⌘K has **Open PRs**, and the
status line counts the open PRs, with how many may merge now.

In a preview instance (`ULTIMATE_INSTANCE_OWNER` is set), the tab is for looking: the header says `preview`, Merge
and Close are disabled, the comment box and Ultimate preview are gone, and the server refuses `comment`, `review`, `merge` and `close`.

Actions (`refs.ts`): `list`, `view { number }`, `sitePreview { number }`, `localRuns` and `fetch { number }` are open to
agents; `comment`, `review`, `merge`, `close`, `runLocally` and `stopLocalRun` are user-only (`userActions`), so codemode refuses them. That does not stop an agent with a shell from
running `gh` itself: the rule that agents never merge covers that.

Other extensions add a quiet mark to a PR through the point `pull-requests.mark` (`ui.tsx`): `row` sits among a list
row's tags, `detail` is a line under the PR's title. A project extension, which cannot import this file, declares the
same point by name.

Personal extension: lives in `~/.ultimate/extensions/pull-requests/`, shows in every project. Turn it off with
`{ "extensions": { "disable": ["pull-requests"] } }`.
