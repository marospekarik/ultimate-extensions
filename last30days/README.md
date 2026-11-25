Gives one agent the [last30days](https://github.com/mvanhorn/last30days-skill) research engine (MIT) without giving it a shell.

## What it adds

- **`last30days {topic, sources?, subreddits?, compare?, days?}`**: runs the pinned engine's `last30days.py` and nothing
  else, and returns its compact report: ranked clusters of Reddit threads, Hacker News stories with comments, GitHub
  issues and PRs, Polymarket markets and keyless web results, each with its date and link (cut at 40,000 characters).
- The tool is **deferred**: no agent gets it unless its definition names it. Forma's researcher names it in its personal
  overlay (`.ultimate/agents/researcher.personal.md`, `addTools: [last30days]`).
- Arguments are validated, never passed through: the topic and comparison names are letters, digits, spaces and
  `. ' + _ / -` with no leading dash; `sources` is a fixed list; `subreddits` are bare names; `days` is 1–90. The engine
  runs as an argv array (`python3.12 -I … -- <topic>`), with a 5-minute timeout.

## Isolation

- Always `--no-browser-cookies`, `FROM_BROWSER=off`, `BROWSER_CONSENT=false`, `LAST30DAYS_SKIP_KEYCHAIN=1`.
- A clean environment: no keys from the server, `HOME` is the empty `~/.local/share/last30days/home`, `PATH` is the
  empty `~/.local/share/last30days/bin` (so no `gh auth token`, `pass`, `yt-dlp`, `npx` or installer can run), and
  `LAST30DAYS_CONFIG_DIR=''` (no `.env`).
- Saved briefs and the engine's library index go to `~/.local/share/last30days/briefs/` only.

## Needs

- Python 3.12 at `/usr/bin/python3.12`.
- The engine at tag v4.6.0, commit `64b1f006f800640022ce07f51de5ce56aad34b76`, in `~/.local/share/last30days/src`:

  ```shell
  git clone --depth 1 --branch v4.6.0 https://github.com/mvanhorn/last30days-skill ~/.local/share/last30days/src
  git -C ~/.local/share/last30days/src rev-parse HEAD   # must print the commit above
  mkdir -p ~/.local/share/last30days/{home,bin,briefs}
  ```

  Pinned on purpose: update only by re-checking a new tag's code, then changing the commit here.

## Known limits

- Reddit's search API answers 403 from this machine; Reddit threads come only from the subreddits named in
  `subreddits`. A `SCRAPECREATORS_API_KEY` would restore Reddit search (and add TikTok and Instagram), but the tool
  passes no keys yet.
- X/Twitter, YouTube, TikTok, Instagram, Bluesky and better web search need keys or extra CLIs, and are off.
