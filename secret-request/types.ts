export const REQUESTS_KIND = 'secret-request.requests'
export const RESULT_KIND = 'secret-request.result'

export type RequestState = 'pending' | 'saved' | 'cancelled'

/** One `request_secret` call: names and where they go, never values. */
export type SecretRequest = {
  id: string
  /** The conversation that called the tool, and its call id. */
  conversation: number
  call: string
  purpose: string
  /** Absolute dotenv path the values are merged into. */
  path: string
  fields: { name: string; description?: string }[]
  state: RequestState
  at: number
  counts?: Counts
}

export type Counts = { added: number; updated: number; unchanged: number }

/** The input the calling conversation receives once the user saved or cancelled. */
export type Result = { request: string; state: Exclude<RequestState, 'pending'> }
