import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fitBezier } from '../shared/ease.ts'
import type { Burst, Segment, VideoAnalysis } from '../shared/types.ts'

const FPS = 30
const W = 192

function run(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args)
    const out: Buffer[] = []
    const err: Buffer[] = []
    p.stdout.on('data', (c: Buffer) => out.push(c))
    p.stderr.on('data', (c: Buffer) => err.push(c))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new Error(`${cmd} failed: ${Buffer.concat(err).toString().split('\n').slice(-4).join(' ')}`))
    })
  })
}

async function probe(file: string) {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json',
    file,
  ])
  const j = JSON.parse(out.toString())
  return { width: j.streams[0].width as number, height: j.streams[0].height as number, duration: +j.format.duration }
}

/**
 * Progress 0→1 across frames [from, to].
 *
 * Movement: the centroid of |frame − start| sits halfway between where the
 * thing was and where it is, so it moves linearly with position (frame
 * differencing alone saturates once an object moves more than its own width
 * per frame). Fades and in-place scales barely move that centroid, so those
 * fall back to projecting each frame onto the start→end change.
 */
function motionProgress(raw: Buffer, size: number, w: number, from: number, to: number): number[] {
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

/**
 * Estimate motion timing from a clip: per-frame pixel difference → motion
 * bursts; cumulative difference inside the main burst → progress curve,
 * fitted to a cubic-bezier. It's an estimate to start tuning from, not truth.
 */
export async function analyzeVideo(boardDir: string, src: string, id: string, segment?: Segment): Promise<VideoAnalysis> {
  const file = path.resolve(boardDir, src)
  if (!file.startsWith(boardDir + path.sep) || !fs.existsSync(file)) throw new Error(`video not found: ${src}`)
  const info = await probe(file)
  const seg: Segment = segment && segment.out > segment.in ? segment : { in: 0, out: info.duration }
  const h = Math.max(2, Math.round((W * info.height) / info.width / 2) * 2)
  const span = ['-ss', String(seg.in), '-t', String(seg.out - seg.in)]

  const raw = await run('ffmpeg', [
    '-v', 'error', ...span, '-i', file,
    '-vf', `fps=${FPS},scale=${W}:${h},format=gray`,
    '-f', 'rawvideo', '-',
  ])
  const size = W * h
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
  const msAt = (i: number) => Math.round(seg.in * 1000 + (Math.max(0, i) / FPS) * 1000)
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
    const progress = motionProgress(raw, size, W, first, b)
    primary = {
      startMs: msAt(first),
      endMs: msAt(b),
      durationMs: msAt(b) - msAt(first),
      ease: fitBezier(progress),
    }
  }

  const sheetRel = `assets/${id}.sheet.png`
  const sheetFps = Math.min(FPS, 24 / Math.max(0.1, seg.out - seg.in))
  await run('ffmpeg', [
    '-v', 'error', '-y', ...span, '-i', file,
    '-vf', `fps=${sheetFps},scale=240:-2,tile=6x4:padding=6:margin=6:color=0x2a2b30`,
    '-frames:v', '1', path.join(boardDir, sheetRel),
  ])

  const analysis: VideoAnalysis = {
    source: src,
    fps: FPS,
    segment: seg,
    bursts,
    primary,
    energy: smooth.map((n) => Math.round(n * 100) / 100),
    contactSheet: sheetRel,
  }
  fs.writeFileSync(path.join(boardDir, `assets/${id}.analysis.json`), JSON.stringify(analysis, null, 2) + '\n')
  return analysis
}
