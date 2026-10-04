// Shared bits for the website's Vercel functions (bundled by scripts/build-web.ts). Each function
// is a plain Node handler, like the routes in server/plugin.ts.
import type { IncomingMessage, ServerResponse } from 'node:http'

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

export function query(req: IncomingMessage, key: string) {
  return new URL(req.url ?? '/', 'http://local').searchParams.get(key) ?? ''
}

export async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const text = Buffer.concat(chunks).toString()
  return text ? JSON.parse(text) : {}
}

export function json(res: ServerResponse, data: unknown, status = 200, cache?: string) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...(cache ? { 'Cache-Control': cache } : {}) })
  res.end(JSON.stringify(data))
}

/** Runs a handler, answering errors as `{ error }` like the local server does. */
export const handle =
  (run: Handler): Handler =>
  async (req, res) => {
    try {
      await run(req, res)
    } catch (err) {
      if (!res.headersSent) json(res, { error: err instanceof Error ? err.message : String(err) }, 400)
      else res.end()
    }
  }

/** Only public http(s) addresses: the functions fetch what they're given. */
export function publicUrl(raw: string) {
  const u = new URL(raw)
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only web links work here')
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/i.test(u.hostname) || !u.hostname.includes('.'))
    throw new Error('Only public web links work here')
  return u
}
