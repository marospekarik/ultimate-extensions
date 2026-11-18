import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { defineExtension } from '@earendil-works/pi-durable'

type Host = { userHome: string }

const file = (host: Host) => join(host.userHome, '.ultimate/theme.json')

export const actions = {
  async get(_args: null, { host }: { host: Host }) {
    try {
      const { theme } = JSON.parse(await readFile(file(host), 'utf8'))
      return theme === 'light' || theme === 'dark' ? theme : null
    } catch {
      return null
    }
  },
  async set(theme: unknown, { host }: { host: Host }) {
    if (theme !== 'light' && theme !== 'dark') throw new Error(`Not a theme: ${String(theme)}`)
    await mkdir(dirname(file(host)), { recursive: true })
    await writeFile(file(host), JSON.stringify({ theme }))
    return null
  },
}

export default defineExtension({ name: 'theme-sync' })
