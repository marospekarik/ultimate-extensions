/**
 * The one secret this extension declares. A user extension cannot import the clone's `lib/secrets.ts`, so it reads
 * `~/.ultimate/secrets.json` the same way that helper does: without following a link, and only for the name it declared.
 * The value is used for one request and never returned, logged or written anywhere.
 */
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'

export async function secret(userHome: string, name: string): Promise<string | undefined> {
  let file
  try {
    file = await open(join(userHome, '.ultimate/secrets.json'), constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    // No store yet: the user has not added the key, which the panel and the card say.
    return undefined
  }
  try {
    const stat = await file.stat()
    // A store others can read is not trusted with a key here; the Secrets panel refuses to write one either.
    if (stat.mode & 0o077) return undefined
    const parsed = JSON.parse(await file.readFile('utf8')) as {
      secrets?: Record<string, { value?: unknown }>
    }
    const value = parsed.secrets?.[name]?.value
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    // An unreadable or malformed store reads as no key, and the card asks for one.
    return undefined
  } finally {
    await file.close()
  }
}
