import { actionRef } from '@/sdk/solid'

export type Theme = 'dark' | 'light'

export const ThemeAction = actionRef<null, Theme | null>('theme-sync', 'get')
export const SetThemeAction = actionRef<Theme, null>('theme-sync', 'set')
