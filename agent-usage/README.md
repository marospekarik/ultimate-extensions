A small muted number at the end of each agent row in the Agents panel: how many times this project ran that agent. The least-used agents read quieter (lower opacity, a faint `0` for one never run); hover a number for the exact count and the last-used date.

One run is one conversation that ran as the agent: a `subagent start` child, an automation run or a standing agent configured from that definition (its `ultimate.agent-profile` document), or a branch, which runs as `coordinator`. Agents made on the fly have no definition and are not counted. Concluded conversations count; so do deleted ones only while they are still stored.

The server's `usage` action reads each conversation's agent once and keeps it in memory; the page asks again every minute and on focus.

It provides the `subagents.mark` point, which the Agents panel renders at the end of each definition row.

Personal extension: lives in `~/.ultimate/extensions/agent-usage/`, shows in every project. Turn it off with `{ "extensions": { "disable": ["agent-usage"] } }`.
