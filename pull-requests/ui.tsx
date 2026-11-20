/** Points other extensions provide into the PRs surface. */
import type { ReactNode } from 'react'
import { definePoint } from '@/sdk'

/**
 * A quiet mark about one PR from another extension (`pr-fit` provides its fit verdict): `row` sits among a list row's
 * tags, `detail` is a line under the PR's title. Undefined or null shows nothing.
 */
export const PrMark = definePoint<{ number: number; place: 'row' | 'detail' }, ReactNode>(
  'pull-requests.mark',
)
