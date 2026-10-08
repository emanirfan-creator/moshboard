// Finding the post in a phone screenshot or screen recording, so the block can show just it.
// A recording: the post is the part that changes while everything around it (the app's bars,
// buttons, caption) holds still. A screenshot: the post is the tallest full-width stretch of
// picture between the app's flat bars. A guess either way; the crop can be dragged after.

import type { Region } from '../../shared/types.ts'

/** Taller than this (height ÷ width) reads as a phone screen. */
export const PHONE_RATIO = 1.85

type Mask = (x: number, y: number) => boolean

/** The post's box (0–1 of the file), or null when there's nothing to crop to. */
export async function findPost(url: string, kind: 'image' | 'video'): Promise<Region | null> {
  try {
    if (kind === 'image') return still(await pixels(await loadImage(url), 240))
    const frames = await videoFrames(url, 8, 160)
    if (frames.length < 2) return frames[0] ? still(frames[0]) : null
    return moving(frames) ?? still(frames[Math.floor(frames.length / 2)])
  } catch {
    return null
  }
}

/** The area whose pixels change across the frames. Null when it's (nearly) everything, e.g. a recording of scrolling. */
function moving(frames: ImageData[]): Region | null {
  const { width: W, height: H } = frames[0]
  const changed = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    let lo = 255
    let hi = 0
    for (const f of frames) {
      const l = luma(f.data, i * 4)
      if (l < lo) lo = l
      if (l > hi) hi = l
    }
    changed[i] = hi - lo > 24 ? 1 : 0
  }
  const box = boxOf((x, y) => changed[y * W + x] === 1, W, H)
  return box && box.w * box.h < 0.85 ? box : null
}

/** The tallest stretch of picture rows: rows that are mostly unlike the app's background (text rows are mostly background). */
function still(img: ImageData): Region | null {
  const { width: W, height: H, data } = img
  const bg = background(img)
  const box = boxOf((x, y) => {
    const i = (y * W + x) * 4
    return Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2])) > 28
  }, W, H)
  return box && box.w * box.h < 0.9 ? box : null
}

/**
 * The box of the longest run of rows where enough of the row is marked (short gaps bridged),
 * narrowed to the columns marked within it. Null when no run is tall enough to be a post.
 */
function boxOf(marked: Mask, W: number, H: number): Region | null {
  const rowOn = Array.from({ length: H }, (_, y) => {
    let n = 0
    for (let x = 0; x < W; x++) if (marked(x, y)) n++
    return n / W > 0.3
  })
  const gap = Math.max(2, Math.round(H * 0.02))
  let best = { top: 0, bottom: -1 }
  let top = -1
  let last = -1
  for (let y = 0; y <= H; y++) {
    const on = y < H && rowOn[y]
    if (on) {
      if (top < 0 || y - last > gap) top = y
      last = y
    }
    if (top >= 0 && (y === H || (!on && y - last > gap))) {
      if (last - top > best.bottom - best.top) best = { top, bottom: last }
      top = -1
    }
  }
  if (best.bottom - best.top < H * 0.15) return null
  const rows = best.bottom - best.top + 1
  let left = W
  let right = -1
  for (let x = 0; x < W; x++) {
    let n = 0
    for (let y = best.top; y <= best.bottom; y++) if (marked(x, y)) n++
    if (n / rows > 0.3) {
      left = Math.min(left, x)
      right = Math.max(right, x)
    }
  }
  if (right < left) return null
  // Within a few percent of an edge is the edge (the post is usually full width). Elsewhere the
  // box comes in a sample step, so no sliver of the app's bars shows along it.
  const snap = (v: number) => (v < 0.03 ? 0 : v > 0.97 ? 1 : v)
  const x0 = snap(left / W) && snap((left + 1) / W)
  const x1 = snap((right + 1) / W) === 1 ? 1 : right / W
  const y0 = snap(best.top / H) && snap((best.top + 1) / H)
  const y1 = snap((best.bottom + 1) / H) === 1 ? 1 : best.bottom / H
  const r = (n: number) => Math.round(n * 1000) / 1000
  return { x: r(x0), y: r(y0), w: r(x1 - x0), h: r(y1 - y0) }
}

/** The app's background: the commonest color down the screen's left and right edges. */
function background({ width: W, height: H, data }: ImageData): [number, number, number] {
  const counts = new Map<number, { n: number; rgb: [number, number, number] }>()
  for (let y = 0; y < H; y++) {
    for (const x of [0, 1, W - 2, W - 1]) {
      const i = (y * W + x) * 4
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
      const c = counts.get(key) ?? { n: 0, rgb: [data[i], data[i + 1], data[i + 2]] }
      c.n++
      counts.set(key, c)
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.rgb ?? [255, 255, 255]
}

/** Gives up on a video that stops loading (a busy browser can stall one) rather than waiting forever. */
const within = <T,>(p: Promise<T>, ms = 8000) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])

const luma = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image'))
    img.src = url
  })
}

function pixels(src: CanvasImageSource & { width: number; height: number }, width: number, w0 = src.width, h0 = src.height) {
  const w = Math.min(width, w0)
  const h = Math.max(1, Math.round((h0 / w0) * w))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/** `n` frames spread across the clip (skipping its first and last tenth), `width` px wide. */
async function videoFrames(url: string, n: number, width: number): Promise<ImageData[]> {
  const v = document.createElement('video')
  v.muted = true
  v.preload = 'auto'
  v.src = url
  await within(
    new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve()
      v.onerror = () => reject(new Error('video'))
    }),
  )
  const out: ImageData[] = []
  const d = Number.isFinite(v.duration) ? v.duration : 0
  for (let k = 0; k < (d ? n : 1); k++) {
    if (d) {
      v.currentTime = d * (0.1 + (0.8 * k) / Math.max(1, n - 1))
      await within(new Promise((r) => (v.onseeked = r)))
    }
    out.push(pixels(v as HTMLVideoElement & { width: number; height: number }, width, v.videoWidth, v.videoHeight))
  }
  v.removeAttribute('src')
  v.load()
  return out
}
