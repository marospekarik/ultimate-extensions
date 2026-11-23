/** @jsxImportSource @solidjs/web */
import type { JSX } from '@solidjs/web'
import { defineWebExtension, definePoint, provide } from '@/sdk/solid'
import { Count } from './count.solid.tsx'

const AgentMark = definePoint<{ name: string }, JSX.Element>('subagents.mark')

export default defineWebExtension({
  provides: [provide(AgentMark, Count)],
})
