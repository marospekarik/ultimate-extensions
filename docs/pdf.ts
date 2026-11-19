import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const MAX_HTML = 5 * 1024 * 1024;

const STYLE = `
@page { margin: 18mm 16mm }
body { font: 11pt/1.55 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; margin: 0 }
h1, h2, h3, h4 { line-height: 1.25; margin: 1.3em 0 .5em; break-after: avoid }
h1 { font-size: 20pt; border-bottom: 1px solid #ddd; padding-bottom: .2em } h2 { font-size: 16pt } h3 { font-size: 13pt } h4 { font-size: 11.5pt }
p, ul, ol, blockquote, table, pre { margin: 0 0 .8em }
a { color: #1a56c4; text-decoration: none }
code, pre { font: 9.5pt/1.45 ui-monospace, "SF Mono", Menlo, Consolas, monospace }
code { background: #f1f1f1; padding: .1em .3em; border-radius: 3px }
pre { background: #f6f6f6; border: 1px solid #e2e2e2; border-radius: 4px; padding: .6em .8em; white-space: pre-wrap; overflow-wrap: anywhere; break-inside: avoid }
pre code { background: none; padding: 0 }
blockquote { border-left: 3px solid #ccc; padding-left: .9em; color: #444 }
table { border-collapse: collapse; width: 100% }
th, td { border: 1px solid #ccc; padding: .3em .6em; text-align: left; vertical-align: top }
th { background: #f0f0f0 }
tr { break-inside: avoid }
img { max-width: 100% }
hr { border: 0; border-top: 1px solid #ddd }
`;

export async function chromium(): Promise<string> {
  const env = process.env.ULTIMATE_CHROMIUM;
  if (env) return env;
  const base = join(homedir(), ".cache", "ms-playwright");
  const names = (await readdir(base).catch(() => [] as string[]))
    .filter((name) => name.startsWith("chromium-"))
    .toSorted((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  if (names[0]) return join(base, names[0], "chrome-linux64", "chrome");
  return "/usr/bin/chromium";
}

export const pageHtml = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${title.replace(/[<&]/g, "")}</title><style>${STYLE}</style><body>${body}`;

export async function renderPdf(title: string, body: unknown): Promise<Buffer> {
  if (typeof body !== "string" || !body.trim())
    throw new Error("Expected { path, html }");
  if (Buffer.byteLength(body) > MAX_HTML)
    throw new Error("The doc is too large to print");
  const { chromium: playwright } = await import("playwright-core");
  const browser = await playwright.launch({ executablePath: await chromium() });
  try {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.setContent(pageHtml(title, body), { waitUntil: "load" });
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await browser.close();
  }
}
