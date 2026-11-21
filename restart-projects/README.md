Restarts every other running Ultimate project on this machine, one at a time, and reports one row per project.

`restart-projects/restart` takes no arguments. For each project in `host.projects()` order it skips the host itself, projects that are not running and supervisors that do not run this clone's `bin/ultimate.ts` (skipped projects get no row). It restarts in place (`POST /api/restart`, then waits for the new generation on the event stream). It falls back to `systemctl --user restart <unit>` when the in-place restart is refused, fails or takes over 90 s, or when the unit started before `bin/` or its unit file changed (or needs a daemon-reload). A failure of one project never stops the others. The run is a durable task: a crash mid-run reruns it, which restarts projects again, harmlessly.

Result: `{ rows: [{ name, unit, status: 'ok' | 'fallback' | 'failed', before, after, reason?, error? }] }`, with `before` and `after` the served generations and `reason` the cause of a fallback.

From codemode (it runs for minutes):

```js
// @options: {"timeout_ms":900000}
return await ultimate.action('restart-projects', 'restart')
```

Personal extension: lives in `~/.ultimate/extensions/restart-projects/`, loads in every project.
