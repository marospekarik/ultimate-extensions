/** @jsxImportSource @solidjs/web */
import { createEffect } from 'solid-js'
import {
  api,
  defineWebExtension,
  getState,
  runCommand,
  useAction,
  usePageVisible,
  useStore,
} from '@/sdk/solid'
import { SetThemeAction, ThemeAction } from './refs.ts'
import type { Theme } from './refs.ts'

const POLL_MS = 2000

const ignore = () => {}

const share = (theme: Theme) => api.action(SetThemeAction, theme).catch(ignore)

const apply = (theme: Theme) => {
  if (getState().ui.theme !== theme) runCommand('theme.toggle')
}

function ThemeSync() {
  const theme = useStore((state) => state.ui.theme)
  const visible = usePageVisible()
  const { data: remote } = useAction(ThemeAction, null, {
    every: () => (visible() ? POLL_MS : undefined),
    focus: true,
    onError: ignore,
  })
  let shared: Theme | null | undefined

  createEffect(remote, (next) => {
    if (next === undefined) return
    if (next === null) {
      if (shared === undefined) {
        shared = getState().ui.theme
        void share(shared)
      }
      return
    }
    shared = next
    apply(next)
  })

  createEffect(theme, (next) => {
    if (shared === undefined || next === shared) return
    shared = next
    void share(next)
  })

  return null
}

export default defineWebExtension({ slots: { 'titlebar.right': [ThemeSync] } })
