/** The project bar's point for other extensions' browser code. */
import type { ReactNode } from 'react'
import { definePoint } from '@/sdk'

/**
 * What sits pinned at the bottom of the project bar (`subscriptions` provides its Plans block); several extensions may
 * provide it and their blocks stack in discovery order. Input is where it renders: the desktop `rail` (the block
 * supplies both its collapsed and its hover-expanded look, switching with `group-hover/rail`) or the `phone` sheet.
 */
export const BarFooter = definePoint<'rail' | 'phone', ReactNode>('project-rail.footer')
