import type { ReactNode } from 'react'
import { defineWebExtension, definePoint, island, provide } from '@/sdk'
import { Count } from './count.solid.tsx'

const AgentMark = definePoint<{ name: string }, ReactNode>('subagents.mark')

export default defineWebExtension({
  provides: [provide(AgentMark, island(Count))],
})
