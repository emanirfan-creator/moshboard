// Passes a media file through (GET ?url=) for hosts that don't let browsers download it directly
// (Pinterest's file server sends no CORS header). Images and video only; nothing is stored.
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { UA } from '../media-find.ts'
import { handle, json, publicUrl, query } from './http.ts'

const MAX_BYTES = 250 * 1024 * 1024

export default handle(async (req, res) => {
  const url = publicUrl(query(req, 'url'))
  // A slow host gets 20s to start answering; the download itself may take the function's whole run.
  const start = new AbortController()
  const timer = setTimeout(() => start.abort(), 20000)
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: start.signal }).finally(() => clearTimeout(timer))
  if (!r.ok || !r.body) return json(res, { error: `Download failed (${r.status})` }, 502)
  const type = r.headers.get('content-type') ?? ''
  if (!/^(image|video)\//.test(type)) return json(res, { error: 'That link isn’t an image or video' }, 415)
  const size = Number(r.headers.get('content-length'))
  if (size > MAX_BYTES) return json(res, { error: 'That file is too large (over 250 MB)' }, 413)
  res.writeHead(200, { 'Content-Type': type, ...(size ? { 'Content-Length': String(size) } : {}), 'Cache-Control': 'private, max-age=3600' })
  // pipeline, not pipe: a dropped download ends the response instead of crashing the function.
  await pipeline(Readable.fromWeb(r.body as import('node:stream/web').ReadableStream), res)
})
