Lets an agent ask you for an external service's key (an API key, a token) without you pasting it into chat and
without it going into Ultimate Secrets. Modelled on BB's built-in Secrets plugin (`bb secret request`).

## What it adds

- **`request_secret {names, purpose, path, describe?}`**: shows a card in the transcript with the purpose, the target
  file and one masked field per name. It returns at once; the agent is not blocked.
- **Save** merges the values into the dotenv file `path` (mode 0600, written atomically). Other lines, comments,
  `export` prefixes and line endings are kept. A file that assigns a requested name twice, or holds a multi-line quoted
  value, is refused. **Cancel** writes nothing.
- **The result** arrives in the calling conversation as an input: the path, the names and how many were added, updated
  or unchanged. It never carries values.

## Where values go, and where they never go

- Values go only from the browser to the `submit` action and then into the file. They are not stored in the
  `secret-request.requests` document (names and state only), nor in the transcript, the tool result or errors. The call
  trace redacts the action's `secrets` argument by its key name.
- `submit` and `cancel` are `userActions`, so agents cannot call them, and Save carries `data-agent-confirm`, so the
  browser tool cannot press it.
- `path` must be inside the home folder. A symlink to outside it is refused, and so is `~/.ultimate/secrets.json`.

## Limits

- **The file is not a vault.** It is a plain file only you can read; an agent's shell could still print it. Only the
  tool's instructions tell agents to load it (`set -a; . <path>; set +a; <command>`) and never print it. Ultimate
  Secrets works the same way.
- **MCP servers** substitute `${NAME}` only from Ultimate Secrets. To use a key from one of these files, wrap the
  server's command: `sh -c 'set -a; . ~/.config/my-app/.env; exec my-server'`.
- Keys Ultimate itself reads (an extension's declared secret, an MCP `${NAME}`) still belong in ⌘K → Secrets.
