/** Runpod pods in the browser: the chip's read and its two actions. Browser-safe. */
import { actionRef } from '@/sdk/solid'

export type Pod = {
  id: string
  name: string
  /** Runpod's `desiredStatus`: RUNNING, EXITED or TERMINATED. */
  status: string
  gpu?: string
  /** Dollars per hour while running. */
  costPerHr: number
  /** When it last started (ms); absent while unknown. */
  startedAt?: number
}

export type Pods = { pods: Pod[]; at: number; problem?: string; setup?: 'add key' }

/** No arguments → the account's pods now. */
export const PodsAction = actionRef<null, Pods>('runpod', 'pods')
/** `{ id }` → stops that pod (its disk keeps billing a little) and returns the pods. */
export const StopAction = actionRef<{ id: string }, Pods>('runpod', 'stop')
/** `{ id }` → deletes that pod and its disk for good, and returns the pods. */
export const TerminateAction = actionRef<{ id: string }, Pods>('runpod', 'terminate')
