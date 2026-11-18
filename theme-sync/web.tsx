import { useEffect, useRef } from 'react'
import { api, defineWebExtension, useStore, useUltimate } from '@/sdk'
import { SetThemeAction, ThemeAction } from './refs.ts'
import type { Theme } from './refs.ts'

const POLL_MS = 2000

function ThemeSync() {
  const { setTheme } = useUltimate()
  const theme = useStore((state) => state.ui.theme)
  const shared = useRef<Theme | null | undefined>(undefined)
  const current = useRef(theme)
  current.current = theme

  useEffect(() => {
    let live = true
    const pull = async () => {
      const remote = await api.action(ThemeAction, null)
      if (!live) return
      if (remote === null) {
        if (shared.current === undefined) {
          shared.current = current.current
          await api.action(SetThemeAction, current.current)
        }
        return
      }
      shared.current = remote
      if (remote !== current.current) setTheme(remote)
    }
    void pull()
    const timer = setInterval(() => void pull(), POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [setTheme])

  useEffect(() => {
    if (shared.current === undefined || theme === shared.current) return
    shared.current = theme
    void api.action(SetThemeAction, theme)
  }, [theme])

  return null
}

export default defineWebExtension({ slots: { 'titlebar.right': [ThemeSync] } })
