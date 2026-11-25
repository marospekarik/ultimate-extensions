import { execFile } from 'node:child_process'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { defineExtension, defineTool } from '@earendil-works/pi-durable'
import { obj, opt, str } from '@earendil-works/pi-schema'

type Host = { userHome: string; home: string }

const run = promisify(execFile)
const MAX_OUTPUT = 50_000

export default function cfFetch(host: Host) {
  const script = join(host.userHome, '.ultimate', 'skills', 'blocked-pages', 'cf-fetch')
  const shots = join(host.userHome, '.ultimate', 'reports', basename(host.home), 'shots')

  const tool = defineTool({
    name: 'cf_fetch',
    replay: 'safe',
    description:
      "Read a public page that web_fetch and browser only show as a bot check (Cloudflare \"Just a moment…\", \"Performing security verification\"). Opens it in a real, visible Chromium on this machine, waits up to 25 s for the check to clear, and returns the title and the page's visible text. With `screenshot` it also saves a full-page PNG to the project's reports shots folder. Use web_fetch or browser first; this one takes 3–30 s per page.",
    parameters: obj({
      url: str({ pattern: '^https?://', description: 'The http(s) URL to open' }),
      screenshot: opt(
        str({
          pattern: '^[a-z0-9][a-z0-9-]*\\.png$',
          description: 'File name for a full-page screenshot, `<report-slug>-<what>.png`; saved under the reports shots folder',
        }),
      ),
    }),
    async execute(args, _api, ctx) {
      const shot = args.screenshot ? join(shots, args.screenshot) : undefined
      const result = await run(script, shot ? [args.url, shot] : [args.url], {
        timeout: 90_000,
        maxBuffer: 20 * 1024 * 1024,
        signal: ctx?.signal,
      }).then(
        ({ stdout }) => ({ ok: true, stdout, stderr: '' }),
        (error: { stdout?: string; stderr?: string; message: string }) => ({
          ok: false,
          stdout: error.stdout ?? '',
          stderr: error.stderr?.trim() || error.message,
        }),
      )
      const saved = shot ? `\n\nScreenshot: ${shot}` : ''
      if (!result.ok) throw new Error(`${result.stderr.replace(/^cf-fetch: screenshot saved to .*\n?/m, '')}${saved}`)
      const text =
        result.stdout.length > MAX_OUTPUT
          ? `${result.stdout.slice(0, MAX_OUTPUT)}\n\n[cut at ${MAX_OUTPUT} characters of ${result.stdout.length}]`
          : result.stdout
      return { output: [{ type: 'text', text: `${text.trim()}${saved}` }] }
    },
  })

  return defineExtension({ name: 'cf-fetch', tools: [tool] })
}
