import { useEffect, useRef, useSyncExternalStore } from 'react'
import { api, defineWebExtension, useAction, useStore, useUltimate } from '@/sdk'
import { SetThemeAction, ThemeAction } from './refs.ts'
import type { Theme } from './refs.ts'

const POLL_MS = 2000

const subscribe = (listener: () => void) => {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}

const ignore = () => {}

const share = (theme: Theme) => api.action(SetThemeAction, theme).catch(ignore)

function ThemeSync() {
  const { setTheme } = useUltimate()
  const theme = useStore((state) => state.ui.theme)
  const visible = useSyncExternalStore(subscribe, () => document.visibilityState === 'visible')
  const { data: remote } = useAction(ThemeAction, null, {
    enabled: visible,
    every: visible ? POLL_MS : undefined,
    focus: true,
    onError: ignore,
  })
  const shared = useRef<Theme | null | undefined>(undefined)
  const current = useRef(theme)
  current.current = theme

  useEffect(() => {
    if (remote === undefined) return
    if (remote === null) {
      if (shared.current === undefined) {
        shared.current = current.current
        void share(current.current)
      }
      return
    }
    shared.current = remote
    if (remote !== current.current) setTheme(remote)
  }, [remote, setTheme])

  useEffect(() => {
    if (shared.current === undefined || theme === shared.current) return
    shared.current = theme
    void share(theme)
  }, [theme])

  return null
}

export default defineWebExtension({ slots: { 'titlebar.right': [ThemeSync] } })
