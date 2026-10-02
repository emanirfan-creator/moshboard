// Reads the colors on the board (images, video frames, site snapshots, swatches)
// so a palette can be suggested from them. Media is same-origin (/media/…), so
// the pixels can be read from a canvas.
import type { Frame } from '../shared/types.ts'
import { hexToLab, rgbToOklab, type ColorSample } from '../shared/color.ts'
import { mediaUrl } from './api'

const SIZE = 40 // each picture is read at 40×40: plenty for color, cheap to cluster
const cache = new Map<string, ColorSample[]>()

function read(source: CanvasImageSource, w: number, h: number): ColorSample[] {
  const canvas = document.createElement('canvas')
  const s = Math.min(1, SIZE / Math.max(w, h))
  canvas.width = Math.max(1, Math.round(w * s))
  canvas.height = Math.max(1, Math.round(h * s))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const out: ColorSample[] = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    out.push({ lab: rgbToOklab([data[i] / 255, data[i + 1] / 255, data[i + 2] / 255]), w: 1 })
  }
  return out
}

function image(url: string) {
  return new Promise<ColorSample[]>((resolve) => {
    const img = new Image()
    img.onload = () => resolve(read(img, img.naturalWidth, img.naturalHeight))
    img.onerror = () => resolve([])
    img.src = url
  })
}

/** A few stills from across the clip (or its marked segment). */
function video(url: string, segment?: Frame['segment']) {
  return new Promise<ColorSample[]>((resolve) => {
    const v = document.createElement('video')
    const out: ColorSample[] = []
    let times: number[] = []
    const done = () => {
      clearTimeout(timer)
      v.removeAttribute('src')
      v.load()
      resolve(out)
    }
    const timer = setTimeout(done, 8000)
    v.muted = true
    v.preload = 'auto'
    v.onloadedmetadata = () => {
      const a = segment?.in ?? 0
      const b = Math.min(segment?.out ?? v.duration, v.duration) || 0
      times = [0.15, 0.5, 0.85].map((t) => a + (b - a) * t)
      v.currentTime = times.shift()!
    }
    v.onseeked = () => {
      out.push(...read(v, v.videoWidth, v.videoHeight))
      if (times.length) v.currentTime = times.shift()!
      else done()
    }
    v.onerror = done
    v.src = url
  })
}

async function samplesFor(board: string, f: Frame): Promise<ColorSample[]> {
  if (f.type === 'swatch' && f.color) return [{ lab: hexToLab(f.color), w: 1 }]
  if (f.type === 'palette') return (f.colors ?? []).map((c) => ({ lab: hexToLab(c.hex), w: 1 }))
  const src = f.type === 'image' || f.type === 'video' ? f.src : f.type === 'url' ? f.snapshot : undefined
  if (!src) return []
  const key = `${board}/${src}/${f.segment?.in ?? ''}-${f.segment?.out ?? ''}`
  if (!cache.has(key)) {
    const url = mediaUrl(board, src)
    cache.set(key, await (f.type === 'video' ? video(url, f.segment) : image(`${url}?w=200`)))
  }
  return cache.get(key)!
}

/** Frames whose colors can be read. Palettes only count when picked on purpose. */
export const hasColors = (f: Frame, picked: boolean) =>
  (f.type === 'image' && !!f.src) ||
  (f.type === 'video' && !!f.src) ||
  (f.type === 'url' && !!f.snapshot) ||
  (f.type === 'swatch' && !!f.color) ||
  (picked && f.type === 'palette' && !!f.colors?.length)

/**
 * Color samples from these frames. Every frame gets the same total say, so one
 * huge screenshot doesn't drown out the rest of the board.
 */
export async function boardSamples(board: string, frames: Frame[]): Promise<ColorSample[]> {
  const per = await Promise.all(frames.map((f) => samplesFor(board, f)))
  return per.flatMap((xs) => xs.map((x) => ({ lab: x.lab, w: 1 / xs.length })))
}
