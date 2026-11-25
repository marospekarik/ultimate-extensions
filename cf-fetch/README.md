Gives an agent a page reader that gets past Cloudflare-style bot checks, without giving it a shell.

## What it adds

- **`cf_fetch {url, screenshot?}`**: runs `~/.ultimate/skills/blocked-pages/cf-fetch` and nothing else. It opens the
  URL in the researcher's own visible Chromium (`researcher-browser.service`: Xvfb :97, CDP 127.0.0.1:9233, its own
  profile, the sandbox on), waits up to 25 s for the check to clear, and returns the title and visible text.
- `screenshot` is a file name (`<report-slug>-<what>.png`), not a path: the PNG always goes to
  `~/.ultimate/reports/<project-home>/shots/`.
- When the check never clears, the tool fails with the script's message (and the screenshot path, if one was asked
  for).

## Needs

- The `blocked-pages` skill folder with its `cf-fetch` and `browser.sh` scripts, and the
  `~/.config/systemd/user/researcher-browser.service` unit; see that skill's `SKILL.md`.
- Playwright's Chromium allowed by AppArmor (`/etc/apparmor.d/playwright-chromium`).

Forma's researcher gets the tool through the personal overlay `~/.ultimate/agents/researcher.md` (`addTools: [cf_fetch]`).
