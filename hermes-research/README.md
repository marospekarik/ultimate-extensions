Runs a research question on the user's Hermes `researcher` agent and shows the run as a live card in the conversation that asked.

## What it adds

- **`hermes_research {prompt, model?, reasoning?, resume?}`**: starts `hermes -p researcher chat --query-file … --format
  stream-json` as a transient systemd user unit (`hermes-research-<run>`) and returns at once with the run id. The unit
  outlives an Ultimate restart; a durable task follows it, so a restart neither loses the run nor starts a second one.
- **The card** in place of the tool call: profile, model, state, elapsed time and API calls in the header, the current
  tool and its page, query or command while it runs, and a Stop button. When done: tokens, the brief's first lines and a
  link to the whole brief in Docs.
- **The brief** goes to the project's reports folder, `~/.ultimate/reports/<project-home>/YYYY-MM-DD-<slug>.md`, under a
  header naming the question, the model and the date.
- **The result** arrives in the calling conversation as an input (`hermes-research.result`), with the brief inline
  when it is short: the agent never polls.
- **Follow-ups**: `resume: <run id>` continues that run's Hermes session (`--resume <session>`, in its folder).

## How it follows a run

- Live progress reads Hermes' session store (`~/.hermes/profiles/researcher/state.db`, read-only): the session started
  in the run's own folder, its API and tool counts and its last tool call.
- The end is the stream's `result` line (session id, exit code, text, tokens) in `<home>/hermes-research/<run>/out.jsonl`,
  or the unit going inactive without one (a failure or a stop).
- Runs are listed in the root conversation's `hermes-research.runs` document.

## Needs

- Hermes Agent at `~/.local/bin/hermes` with a `researcher` profile, and `systemd-run --user`.
- Tokens go to the provider of the researcher profile (Ollama Cloud), not to Ultimate's.
