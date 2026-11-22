export type RunState = 'running' | 'done' | 'failed' | 'stopped'

export type Tokens = { input: number; output: number; cacheRead: number; total: number }

/** One Hermes researcher run started by the `hermes_research` tool. */
export type Run = {
  id: string
  /** The conversation that called the tool, and its call id. */
  conversation: number
  call: string
  prompt: string
  model?: string
  reasoning?: string
  /** The run this one follows up, in the same Hermes session. */
  resume?: string
  /** The Hermes session: known at start for a follow-up, else once the run ends. */
  session?: string
  /** Where this run's prompt and output live. */
  dir: string
  /** Where Hermes runs: the session's folder (the first run's `dir`). */
  cwd: string
  /** API and tool calls the resumed session had before this run, so the card counts only this run's. */
  base?: { apiCalls: number; tools: number }
  startedAt: number
  state: RunState
  stopping?: true
  endedAt?: number
  apiCalls?: number
  tokens?: Tokens
  /** The brief's file name in the project's reports folder. */
  report?: string
  preview?: string
  error?: string
}

/** What a running Hermes session shows now. */
export type Live = {
  model?: string
  apiCalls: number
  tools: number
  /** The last tool call: its name and the page, query or command it was given. */
  last?: string
}

/** The input that tells the calling conversation a run ended. */
export type Result = { run: string; state: RunState; report?: string; error?: string }

export const RUNS_KIND = 'hermes-research.runs'
export const RESULT_KIND = 'hermes-research.result'
