/** Project rail: the running projects on this machine. Browser-safe. */
import { actionRef } from '@/sdk/solid'

/** Its keep-warm state, from that project's `keep-warm.state` action. */
export type RailWarm = {
  on: boolean
  /** @ultimate's latest request on its cache (ms); the cache is warm for an hour after it. */
  lastRequest?: number
  /** When the next ping is due (ms), while one will run. */
  nextAt?: number
  /** Why the last ping failed, while nothing renewed the cache since. */
  error?: string
}

export type RailProject = {
  name: string
  /** Project folder's basename: the key of its colour. */
  folder: string
  /** Two-letter tile label, unique among the list. */
  abbr: string
  current: boolean
  /** Loopback URL of its running instance. */
  url: string
  /** Machine it runs on: this machine's hostname, or the `remotes` key. */
  machine: string
  /** Its HTTPS port on the tailnet, when it has one. */
  tailnetPort?: number
  /** Machine hosting it, for a project that runs elsewhere; `url` is then its own address. */
  remote?: string
  /** Open questions waiting on the user; absent when its status could not be read. */
  waiting?: number
  /** When the newest of those questions was asked (ms); the badge fades once it is a day old. */
  waitingSince?: number
  /** Conversations working right now (its `status` action's `busy`); absent when its status could not be read. */
  busy?: number
  /** Its `pause.state` says it is paused: running work finishes, nothing new starts. */
  paused?: boolean
  /** Absent when its keep-warm state could not be read. */
  warm?: RailWarm
}

/** No arguments → every project with a running instance, current first. */
export const ProjectsAction = actionRef<null, RailProject[]>('project-rail', 'projects')
