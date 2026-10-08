// Finding the media behind a link (a Cosmos element, a pin, a Dribbble shot, a Muzli project, or a
// direct .mp4/.jpg): fetches the page and reads which video or image it declares. No disk access,
// so it runs in the local server (server/media-link.ts downloads what it finds) and as a Vercel
// function for the website (api/media-find), where the browser saves the files into the folder.

import { MEDIA_EXT, mediaKind } from '../shared/links.ts'

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36'

export interface Found {
  url: string
  kind: 'video' | 'image' | 'audio'
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

/** A streaming playlist in a `video_list` (some idea pins list nothing else). */
function pinStream(list: Record<string, PinVideo> | undefined): PinVideo | null {
  return Object.values(list ?? {}).find((v) => /\.m3u8(\?|$)/.test(v?.url ?? '')) ?? null
}

// Pinterest keeps mp4 copies beside a playlist: …/videos/<x>/hls/<path>.m3u8 has
// …/videos/<x>/720p/<path>.mp4 and smaller …/videos/iht/expMp4/<path>_t4.mp4 (t4 down to t1).
async function mp4BesideStream(m3u8: string): Promise<string | null> {
  const m = /^(https:\/\/[^/]+\/videos\/)(\w+)\/hls\/(.+)\.m3u8/.exec(m3u8)
  if (!m) return null
  const [, root, kind, path] = m
  const tries = [`${root}${kind}/720p/${path}.mp4`, ...[4, 3, 2, 1].map((t) => `${root}iht/expMp4/${path}_t${t}.mp4`)]
  for (const url of tries) {
    const r = await fetch(url, { method: 'HEAD', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) }).catch(() => null)
    if (r?.ok && (r.headers.get('content-type') ?? '').startsWith('video/')) return url
  }
  return null
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
  // Only a stream: its mp4 copy, else the cover picture below.
  const stream = lists.map(pinStream).find(Boolean)
  const mp4 = stream && (await mp4BesideStream(stream.url))
  if (mp4) return { url: mp4, kind: 'video', title, width: stream.width, height: stream.height }
  const image = pin.images?.orig ?? Object.values(pin.images ?? {}).at(-1)
  return image?.url ? { url: image.url, kind: 'image', title, width: image.width, height: image.height } : null
}

export interface FoundLink {
  title: string
  source: string
  /** One piece, or several for a multi-piece project (Muzli). */
  items: Found[]
}

/** What a link points to. Throws a readable error when the page has nothing to take. */
export async function findMediaLink(link: string): Promise<FoundLink> {
  const u = new URL(link)
  const host = u.hostname.replace(/^www\./, '')
  // Direct file link.
  if (MEDIA_EXT.test(u.pathname)) {
    const name = u.pathname.split('/').pop() ?? 'media'
    return { title: name.replace(/\.\w+$/, ''), source: link, items: [{ url: link, kind: mediaKind('', /\.\w+$/.exec(name)?.[0] ?? ''), title: name.replace(/\.\w+$/, '') }] }
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
    if (project) return { title: project.title ?? new URL(link).pathname.split('/').pop() ?? 'muzli', source: link, items: project.items }
  }
  // pin.it short links redirect to the pin, so check the final URL.
  const pinterest = /(^|\.)pinterest\.[a-z.]+$/i.test(new URL(pageUrl).hostname)
  const found = (pinterest ? await findPinterestMedia(pageUrl).catch(() => null) : null) ?? findMedia(pageUrl, html)
  if (!found) throw new Error(`Couldn’t find a video or image on that ${host} page`)
  const title = found.title && !/^found on cosmos$/i.test(found.title) ? found.title : `${host} ${u.pathname.split('/').pop()}`
  return { title, source: link, items: [{ ...found, title }] }
}
