// Turn a link to a media page (a Cosmos element, a direct .mp4/.jpg, or any page
// that declares its video/image) into a downloaded asset on the board.
import fs from 'node:fs'
import path from 'node:path'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36'
const MAX_BYTES = 250 * 1024 * 1024

import { MEDIA_EXT } from '../shared/links.ts'
import { gifToVideo, probeSize } from './gif.ts'

interface Found {
  url: string
  kind: 'video' | 'image'
  title?: string
  width?: number
  height?: number
}

// Pages embed JSON inside JS strings, sometimes escaped twice (\\u003c, \\").
const decode = (s: string) =>
  s
    .replace(/\\+u003c/gi, '<')
    .replace(/\\+u003e/gi, '>')
    .replace(/\\+u0026/gi, '&')
    .replace(/\\+"/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')

const meta = (html: string, key: string) =>
  new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)`, 'i').exec(html)?.[1] ??
  new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, 'i').exec(html)?.[1]

const stripTags = (s?: string) => s?.replace(/<[^>]+>/g, '').trim()

/** A short readable name: the description beats generic names like "Element #123". */
function pickTitle(name?: string, description?: string) {
  const n = stripTags(name)
  const d = stripTags(description)
  const pick = n && !/^element\s*#?\d+$/i.test(n) ? n : d || n
  if (!pick) return undefined
  return pick.length > 60 ? `${pick.slice(0, 57).replace(/[\s,.;:]+\S*$/, '')}…` : pick
}

function findMedia(pageUrl: string, html: string): Found | null {
  const text = decode(html)

  // 1. Structured data for this exact page (Cosmos: VideoObject/ImageObject with contentUrl).
  const canonical = pageUrl.replace(/[?#].*$/, '').replace(/\/$/, '')
  for (const anchor of [`"url":"${canonical}"`, `"@id":"${canonical}"`]) {
    const i = text.indexOf(anchor)
    if (i < 0) continue
    const around = text.slice(Math.max(0, i - 2500), i + 2500)
    const content = /"contentUrl":"(https?:[^"]+)"/.exec(around)?.[1]
    if (content) {
      const type = /"@type":"(VideoObject|ImageObject)"/.exec(around)?.[1]
      return {
        url: content,
        kind: type === 'ImageObject' && !/\.(mp4|webm|mov)/i.test(content) ? 'image' : /\.(mp4|webm|mov|m4v)/i.test(content) ? 'video' : 'image',
        title: pickTitle(/"name":"([^"]{1,200})"/.exec(around)?.[1], /"description":"([^"]{1,400})"/.exec(around)?.[1]),
        width: Number(/"width":(\d+)/.exec(around)?.[1]) || undefined,
        height: Number(/"height":(\d+)/.exec(around)?.[1]) || undefined,
      }
    }
  }

  const title = stripTags(meta(html, 'og:title'))
  // 2. Declared video, then a <video>/<source> on the page.
  const video =
    meta(html, 'og:video:secure_url') ??
    meta(html, 'og:video:url') ??
    meta(html, 'og:video') ??
    meta(html, 'twitter:player:stream') ??
    /<(?:video|source)[^>]+src=["'](https?:[^"']+\.(?:mp4|webm|mov)[^"']*)/i.exec(html)?.[1]
  if (video) return { url: video, kind: 'video', title }
  // 3. Declared image.
  const image = meta(html, 'og:image:secure_url') ?? meta(html, 'og:image')
  if (image) return { url: image, kind: 'image', title }
  return null
}

interface PinVideo {
  url: string
  width?: number
  height?: number
}

/** The best mp4 in a Pinterest `video_list` (HLS entries are skipped). */
function bestPinVideo(list: Record<string, PinVideo> | undefined): PinVideo | null {
  const mp4s = Object.values(list ?? {}).filter((v) => /\.mp4(\?|$)/.test(v?.url ?? ''))
  return mp4s.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0] ?? null
}

// A Muzli project (me.muz.li/<user>/<slug>) is several pieces. The page data lists
// each one as {"type":"image"|"video","url":...} in a "media" array, hosted on Muzli.
function findMuzliMedia(html: string): { title?: string; items: Found[] } | null {
  const text = decode(html)
  const start = text.indexOf('"media":[')
  if (start < 0) return null
  const seg = text.slice(start, text.indexOf('}]', start) + 1)
  const items: Found[] = []
  for (const m of seg.matchAll(/\{[^{}]*\}/g)) {
    try {
      const o = JSON.parse(m[0]) as { type?: string; url?: string }
      if (o.url && /^https?:/.test(o.url) && !items.some((it) => it.url === o.url))
        items.push({ url: o.url, kind: o.type === 'video' ? 'video' : 'image' })
    } catch {
      // not a media entry
    }
  }
  if (!items.length) return null
  const title = stripTags(meta(html, 'og:title'))?.replace(/&amp;/g, '&').replace(/\s+on Muzli$/i, '')
  return { title: pickTitle(title), items }
}

// Pinterest's page HTML only declares the cover image, even for video, story and
// carousel pins, so read the pin's JSON instead. Carousels use their first video.
async function findPinterestMedia(pageUrl: string): Promise<Found | null> {
  const id = /\/pin\/(?:[^/]*--)?(\d+)/.exec(new URL(pageUrl).pathname)?.[1]
  if (!id) return null
  const api = new URL('https://www.pinterest.com/resource/PinResource/get/')
  api.searchParams.set('data', JSON.stringify({ options: { id, field_set_key: 'detailed' } }))
  const r = await fetch(api, {
    headers: { 'user-agent': UA, 'x-pinterest-pws-handler': 'www/pin/[id].js' },
    signal: AbortSignal.timeout(20000),
  })
  if (!r.ok) return null
  const pin = (await r.json())?.resource_response?.data as any
  if (!pin) return null
  const lists = [
    pin.videos?.video_list,
    ...(pin.story_pin_data?.pages ?? []).flatMap((p: any) => (p.blocks ?? []).map((b: any) => b.video?.video_list)),
    ...(pin.carousel_data?.carousel_slots ?? []).map((s: any) => s.videos?.video_list),
  ]
  const title = pickTitle(pin.title || pin.grid_title, pin.description)
  for (const list of lists) {
    const v = bestPinVideo(list)
    if (v) return { url: v.url, kind: 'video', title, width: v.width, height: v.height }
  }
  const image = pin.images?.orig ?? Object.values(pin.images ?? {}).at(-1)
  return image?.url ? { url: image.url, kind: 'image', title, width: image.width, height: image.height } : null
}

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
  const u = new URL(link)
  const host = u.hostname.replace(/^www\./, '')
  // Direct file link.
  if (MEDIA_EXT.test(u.pathname)) {
    const file = await download(boardDir, link, path.basename(u.pathname).replace(/\.\w+$/, ''))
    return { path: file.rel, type: file.kind, title: path.basename(u.pathname), source: link }
  }
  const r = await fetch(link, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(`${host} returned ${r.status}`)
  // Bot checks (Dribbble's AWS WAF) answer 202 with a challenge page instead of the shot.
  if (r.status === 202 || r.headers.get('x-amzn-waf-action'))
    throw new Error(`${host} blocks downloads. Right-click the media, copy its address and paste that`)
  const pageUrl = r.url || link
  const html = await r.text()
  if (/(^|\.)muz\.li$/i.test(new URL(pageUrl).hostname)) {
    const project = findMuzliMedia(html)
    if (project) return downloadAll(boardDir, project, link)
  }
  // pin.it short links redirect to the pin, so check the final URL.
  const pinterest = /(^|\.)pinterest\.[a-z.]+$/i.test(new URL(pageUrl).hostname)
  const found = (pinterest ? await findPinterestMedia(pageUrl).catch(() => null) : null) ?? findMedia(pageUrl, html)
  if (!found) throw new Error(`Couldn’t find a video or image on that ${host} page`)
  const title = found.title && !/^found on cosmos$/i.test(found.title) ? found.title : `${host} ${u.pathname.split('/').pop()}`
  const file = await download(boardDir, found.url, title)
  return { path: file.rel, type: file.kind, title, source: link, width: found.width, height: found.height }
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
