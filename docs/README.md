A Docs app for any repository, with editing: every git-tracked Markdown file rendered with Ultimate's own Markdown renderer, plus the project's reports, with comments you send to @ultimate or a branch.

## What it does

- **Surface `Docs`** (title bar, or ⌘K → Open Docs): the files on the left, grouped by folder (Reports first, then root docs, then alphabetically), with a filter; the doc in the middle, its YAML frontmatter as a card above the body; the agent docked on the right. On a phone the file list is a drawer behind the list button in the header, and below desktop width the agent dock is left out (reach the agent from the title bar). Tables and code highlight as in messages.
- **Links.** `?doc=<path>#<section>` opens a doc at a section. A Markdown link to a repo `.md` file opens it in Docs, with its `#section` if it has one. Inside a doc, relative links resolve against the doc's folder and `[x](#section)` jumps within it. In a chat message, write the link with a leading slash, e.g. `[name](/docs/name.md)` — a plain relative link like `[name](docs/name.md)` is blocked by Streamdown's hardening and renders as "[blocked]".
- **Section ids.** Every heading gets a GitHub-style id: lowercase, punctuation removed, spaces as hyphens, a repeated heading `-1`, `-2` (`links.ts`).
- **Auto-links in the doc body.** Bare `https://` URLs and domains ending in a common TLD (`skat.dk`, `www.example.com/x`) become links; `file.md`, `v1.2`, emails and anything in code do not. A backticked path that is a tracked doc (`wiki/business/x.md`, or relative to the current doc) becomes a link to it. Short ids such as "02b" are not guessed: write them as links in a reference table.
- **Back.** Opening another doc from a link pushes a browser history entry; the header shows a back arrow, and the phone back gesture returns to the previous doc.
- **Agents.** A prompt section (`docs_links`, `server.ts`) tells every agent to link what its reports and docs mention, with the same slug rule.
- **Download.** The doc's bar has a **Download** button that saves the file as stored, frontmatter included, under its own name. On a phone that can share files it opens the share sheet instead.
- **Comments.** Select text and click **Comment** (on touch, **Comment on selection** at the foot of the screen), or **Comment on doc** for the doc as a whole. Pending comments are kept per doc in durable UI state until sent. **Send (N)** posts one `docs.comments` input to the conversation the **to** picker names (default @ultimate). It steers a busy recipient like a typed message. The recipient sees a card on the user's side; the model reads each comment with its heading and quote, and is told to read the doc (for a report, at its absolute path).

## Editing

- **Edit** in the doc's bar (not for kept reports) opens the doc block by block: tap a paragraph, heading, list, quote or code block and it becomes a text field in the same type size, with Markdown marks (`#`, `**`, `-`) dimmed and bold, italic and code styled live as you type. Typing `###` and a space gives a heading-sized line; Enter continues a list (`1.` counts up) and an empty item ends it; Enter elsewhere splits the block; Backspace in an empty block removes it; Arrow Up/Down at the edge moves to the neighbouring block; Ctrl/⌘+B and +I wrap the selection; Ctrl/⌘+Enter saves; Esc leaves the block. **Save** writes the file, **Cancel** drops the draft. YAML frontmatter is kept as it was and is not editable here.
- **Safe saves.** A save sends the SHA-256 of the text it opened (`hash`); the server refuses a mismatch ("changed since you opened it"), so a draft never overwrites an agent's newer edit. It writes a temp file in the same folder and renames it over the original.
- **Reports** keep the last 20 versions in `.history/<report>/` in the reports folder (dot folder: never listed, never a doc). Each save stores the text it replaces. **History** lists them newest first; picking one opens it as a draft to Save, so a restore is itself undoable. Deleting a report in the sweep removes its history.
- **Repo docs** save to the working tree and stay uncommitted. A doc with uncommitted changes shows **Commit**, which commits that file alone (`git commit --only -- <path>`, message `Docs: edit <path>`) on the checked-out branch; other staged or dirty files are left out.

## Reports

Long one-off output (a setup manual, an investigation, a runbook for one machine) goes to the project's reports folder instead of a chat message or the repo, and the chat gets a short summary with a link.

- **Folder:** `~/.ultimate/reports/<name>-<hash>/`, named exactly like the project's state home `~/.ultimate/projects/<name>-<hash>/` (the folder Ultimate keeps the project's `state.sqlite` in). Two projects with the same folder name never share one. It is outside every repo, so never in git.
- **Writing:** an agent writes a report with the normal `write` tool, directly in that folder (no subfolders): `YYYY-MM-DD-<slug>.md`, the date it was written and a short lowercase slug, e.g. `2026-11-16-hub-ct.md`.
- **Linking:** in chat, `[Hub CT manual](/.reports/2026-11-16-hub-ct.md)`. The `/.reports/` prefix starts with a dot, and the repo list never shows a path with a dot segment, so a report link can never mean a repo file. After Keep, the same link still opens the report from `archive/`.
- **Docs:** a **Reports** section at the top of the file list, newest first, each with the days it has left; kept reports below under **Reports · kept**. With none yet, the section names the folder. Reports render and take comments like repo docs.
- **Retention:** a report is deleted 30 days after it was last written. **Keep** (in the doc's bar) moves it to `archive/` in the same folder, which is never deleted.
- **Sweep:** each project's host sweeps its own folder when it opens and every 24 hours after. One host serves one project home, so no two hosts sweep the same folder; a project whose host is not running is swept when it next opens.

## Actions

- `list` → every tracked `*.md` path, sorted.
- `reports` → `{ folder, reports }`: the folder (`~/.ultimate/reports/<name>-<hash>/`) and its reports, `{ path, size, modified, archived, expires? }`, newest first, then `archive/`'s.
- `read { path }` → `{ status: 'ok', path, frontmatter, body, size, modified }`, or `missing` (not tracked, gone, or a report that does not exist) / `tooLarge` (over 1 MB). The surface shows `Not found: <path>` for a missing doc; it never falls back to another doc. `path` is one of `list`'s, or a report's `.reports/<name>.md` / `.reports/archive/<name>.md`.
- `write { path, text, base }`, **user only** → `{ hash }`. `history { path }` → a report's versions; `version { path, id }` → one's text. `commit { path, message? }`, **user only**, repo docs → `{ commit }`.
- `send { conversation, path, comments, note? }`, **user only**: at most 50 comments, each up to 4,000 characters with a quote up to 1,000.
- `keep { path }`, **user only**: moves a report into `archive/` and returns its new path.
- `sweep` → `{ deleted }`: deletes the reports last written over 30 days ago, as the daily sweep does.

## What it never shows or does

- **Repo docs: only `git ls-files '*.md'` from the project root.** Untracked and ignored files (`.env.local`) never appear. No path with a segment starting with `.` appears either (`.env*`, `.claude/`, `.ultimate/`). If the project is not a git repo, the list is empty.
- **`read` of a repo doc accepts only a path that `list` returned.** It then checks that the real path is the same regular file inside the project root, so a tracked symlink is refused.
- **Writes only through `write` and `commit`, both user only.** `write` accepts a path `list` returned (or a report), re-checks the real path like `read`, and needs the current hash. `commit` runs `git commit --only` on one listed path and nothing else (no add, push or reset).
- **Reports are the one exception, and only inside the reports folder.** It reads only regular `.md` files directly in the folder or in its `archive/`; it refuses symlinks, folders, names starting with `.`, and any path whose real path is not that file inside the folder. Its writes are `write` (snapshot into `.history/`, then temp file and rename), `keep` (user only: creates `archive/` if needed and `rename`s the report into it, never over an existing file) and the sweep (`unlink` of a top-level report over 30 days old; never `archive/`, never anything but `.md`).
