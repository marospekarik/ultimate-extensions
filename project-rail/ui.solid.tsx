/** @jsxImportSource @solidjs/web */
/** The project bar's point for other extensions' browser code. */
import type { JSX } from '@solidjs/web'
import { definePoint } from '@/sdk/solid'

/**
 * What sits pinned at the bottom of the project bar (`subscriptions` provides its Plans block); several extensions may
 * provide it and their blocks stack in discovery order. Input `where` is where it renders: the desktop `rail` (the block
 * supplies both its collapsed and its hover-expanded look, switching with `group-hover/rail`) or the `phone` sheet.
 */
export const BarFooter = definePoint<{ where: 'rail' | 'phone' }, JSX.Element>('project-rail.footer')
