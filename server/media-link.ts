// Turn a link to a media page (a Cosmos element, a direct .mp4/.jpg, or any page
// that declares its video/image) into a downloaded asset on the board.
import fs from 'node:fs'
import path from 'node:path'

const MAX_BYTES = 250 * 1024 * 1024

import { MEDIA_EXT } from '../shared/links.ts'
import { gifToVideo, probeSize } from './gif.ts'
import { findMediaLink, UA, type Found } from './media-find.ts'

const EXT: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
}

async function download(boardDir: string, url: string, base: string) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) })
  if (!r.ok || !r.body) throw new Error(`Download failed (${r.status})`)
  const type = (r.headers.get('content-type') ?? '').split(';')[0].trim()
  const ext = EXT[type] ?? MEDIA_EXT.exec(new URL(url).pathname)?.[0].replace(/\?.*$/, '') ?? ''
  if (!ext) throw new Error(`That link isn’t an image or video (${type || 'unknown type'})`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length > MAX_BYTES) throw new Error('That file is too large (over 250 MB)')
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'media'
  const rel = `assets/${slug}-${Math.random().toString(36).slice(2, 6)}${ext}`
  fs.mkdirSync(path.join(boardDir, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(boardDir, rel), buf)
  // Animated GIFs (common on Cosmos) are motion: make them video.
  const video = ext === '.gif' ? await gifToVideo(boardDir, rel) : null
  if (video) return { rel: video, kind: 'video' as const }
  return { rel, kind: type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/.test(ext) ? ('video' as const) : ('image' as const) }
}

export async function resolveMediaLink(boardDir: string, link: string) {
  const found = await findMediaLink(link)
  if (found.items.length > 1) return downloadAll(boardDir, { title: found.title, items: found.items }, link)
  const [piece] = found.items
  const file = await download(boardDir, piece.url, piece.title ?? found.title)
  return { path: file.rel, type: file.kind, title: found.title, source: link, width: piece.width, height: piece.height }
}

/** Every piece of a multi-piece page, in page order. Pieces that fail to download are skipped. */
async function downloadAll(boardDir: string, project: { title?: string; items: Found[] }, link: string) {
  const title = project.title ?? new URL(link).pathname.split('/').pop() ?? 'muzli'
  const settled = await Promise.allSettled(
    project.items.map(async (it) => {
      const file = await download(boardDir, it.url, title)
      const size = await probeSize(path.join(boardDir, file.rel))
      return { path: file.rel, type: file.kind, width: size?.width, height: size?.height }
    }),
  )
  const items = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []))
  if (!items.length) throw new Error('Couldn’t download any pieces from that project')
  return { ...items[0], title, source: link, items }
}
