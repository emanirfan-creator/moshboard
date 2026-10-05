// Motion timing from a clip's frames: per-frame pixel difference → motion bursts; the main
// burst's progress curve → a fitted cubic-bezier. Pure math on grey frames, so the local server
// (frames from ffmpeg, server/analyze-video.ts) and the website (frames drawn from a <video>,
// src/folder/analyze.ts) share it. It's an estimate to start tuning from, not truth.
import { fitBezier } from './ease.ts'
import { readMotion } from './read-motion.ts'
import type { Burst, Segment, VideoAnalysis } from './types.ts'

/**
 * Progress 0→1 across frames [from, to].
 *
 * Movement: the centroid of |frame − start| sits halfway between where the
 * thing was and where it is, so it moves linearly with position (frame
 * differencing alone saturates once an object moves more than its own width
 * per frame). Fades and in-place scales barely move that centroid, so those
 * fall back to projecting each frame onto the start→end change.
 */
function motionProgress(raw: Uint8Array, size: number, w: number, from: number, to: number): number[] {
  const at = (i: number, p: number) => raw[i * size + p]
  // Centroid of pixels that differ between frames a and b (NaN if none do).
  const centroid = (a: number, b: number): [number, number] => {
    let sx = 0
    let sy = 0
    let sw = 0
    for (let p = 0; p < size; p++) {
      const m = Math.abs(at(a, p) - at(b, p))
      if (m <= 8) continue
      sx += (p % w) * m
      sy += Math.floor(p / w) * m
      sw += m
    }
    return sw ? [sx / sw, sy / sw] : [NaN, NaN]
  }
  // For an object moving s → e and currently at p:
  //   centroid(frame, start) = (s + p) / 2,  centroid(frame, end) = (p + e) / 2,
  //   centroid(start, end)   = (s + e) / 2 = M,  and their difference gives D = e − s.
  // So progress = 1 + 2·(centroid(frame, start) − M)·D / |D|².
  const M = centroid(from, to)
  const toStart: [number, number][] = []
  const ds: [number, number][] = []
  for (let i = from; i <= to; i++) {
    const cs = centroid(i, from)
    const ce = centroid(i, to)
    toStart.push(cs)
    if (!Number.isNaN(cs[0]) && !Number.isNaN(ce[0])) ds.push([2 * (ce[0] - cs[0]), 2 * (ce[1] - cs[1])])
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
  const D: [number, number] = [median(ds.map((d) => d[0])), median(ds.map((d) => d[1]))]
  const len2 = D[0] ** 2 + D[1] ** 2

  let raw01: number[]
  if (!Number.isNaN(M[0]) && len2 > 1.5 ** 2) {
    raw01 = toStart.map((c, k) =>
      k === 0 || Number.isNaN(c[0]) ? 0 : 1 + (2 * ((c[0] - M[0]) * D[0] + (c[1] - M[1]) * D[1])) / len2,
    )
  } else {
    // In place (fade/scale/color): project each frame onto the start→end change.
    let endNorm = 0
    for (let p = 0; p < size; p++) endNorm += (at(to, p) - at(from, p)) ** 2
    raw01 = []
    for (let i = from; i <= to; i++) {
      let dot = 0
      for (let p = 0; p < size; p++) dot += (at(i, p) - at(from, p)) * (at(to, p) - at(from, p))
      raw01.push(endNorm ? dot / endNorm : 0)
    }
  }
  raw01[raw01.length - 1] = 1
  // Monotone and clamped.
  let hi = 0
  return raw01.map((v) => (hi = Math.max(hi, Math.min(1, Math.max(0, v)))))
}

/** `raw`: `frames` grey frames of w×h, one byte per pixel, sampled at `fps` from the start of `seg`. */
export function analyzeFrames(raw: Uint8Array, w: number, h: number, seg: Segment, fps: number) {
  const size = w * h
  const frames = Math.floor(raw.length / size)
  const diff: number[] = [0]
  for (let i = 1; i < frames; i++) {
    let s = 0
    const a = (i - 1) * size
    const b = i * size
    for (let p = 0; p < size; p++) s += Math.abs(raw[b + p] - raw[a + p])
    diff.push(s / size)
  }
  const smooth = diff.map((_, i) => {
    const xs = diff.slice(Math.max(0, i - 1), i + 2)
    return xs.reduce((x, y) => x + y, 0) / xs.length
  })
  const peak = Math.max(...smooth, 0)
  const threshold = Math.max(0.35, peak * 0.12)

  // Contiguous runs above threshold, merging gaps shorter than 3 frames.
  const runs: [number, number][] = []
  for (let i = 0; i < smooth.length; i++) {
    if (smooth[i] < threshold) continue
    const last = runs[runs.length - 1]
    if (last && i - last[1] <= 3) last[1] = i
    else runs.push([i, i])
  }
  const msAt = (i: number) => Math.round(seg.in * 1000 + (Math.max(0, i) / fps) * 1000)
  const bursts: Burst[] = runs
    .filter(([a, b]) => b - a >= 2)
    .map(([a, b]) => ({ startMs: msAt(a - 1), endMs: msAt(b), durationMs: msAt(b) - msAt(a - 1) }))

  let primary: VideoAnalysis['primary'] = null
  if (runs.length) {
    const energy = (r: [number, number]) => smooth.slice(r[0], r[1] + 1).reduce((x, y) => x + y, 0)
    const main = runs.reduce((best, r) => (energy(r) > energy(best) ? r : best))
    // Hysteresis: grow the burst while there's still faint motion, so slow
    // ease-in starts and ease-out tails aren't cut off.
    const floor = Math.max(0.03, peak * 0.01)
    let a = main[0]
    let b = main[1]
    // Smoothing widens runs by a frame each side; trim to real motion first.
    while (a < b && diff[a] <= floor) a++
    while (b > a && diff[b] <= floor) b--
    while (a > 1 && diff[a - 1] > floor) a--
    while (b < diff.length - 1 && diff[b + 1] > floor) b++
    const first = a - 1 // last still frame before motion
    const progress = motionProgress(raw, size, w, first, b)
    primary = {
      startMs: msAt(first),
      endMs: msAt(b),
      durationMs: msAt(b) - msAt(first),
      ease: fitBezier(progress),
    }
  }

  return { bursts, primary, energy: smooth.map((n) => Math.round(n * 100) / 100), read: readMotion(raw, w, h, seg, fps, diff) }
}
