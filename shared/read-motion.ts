// Reading a clip: what kind of video it is (a UI recording, a motion graphic, or footage), and
// what's worth measuring for that kind. Pure math on the same grey frames analyze-motion.ts uses,
// so the local server and the website read clips the same way. Estimates to start from.
//
//   interface: something moves on a still screen → every move's timing, curve, spring
//   graphic:   beats and holds across the frame   → the rhythm (move, hold, every)
//   footage:   always changing, cuts, photographic → pacing only (no easing to copy)
import { fitBezier } from './ease.ts'
import type { MotionKind, MotionReading, Move, Segment } from './types.ts'

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0)
const sd = (xs: number[]) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

interface Frames {
  raw: Uint8Array
  w: number
  h: number
  n: number
}
const px = (f: Frames, i: number, p: number) => f.raw[i * f.w * f.h + p]

/** Mean of each column (and each row): a frame squashed to a line, for finding how far it shifted. */
function profiles(f: Frames, i: number) {
  const cols = new Float32Array(f.w)
  const rows = new Float32Array(f.h)
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const v = px(f, i, y * f.w + x)
      cols[x] += v / f.h
      rows[y] += v / f.w
    }
  return { cols, rows }
}

/**
 * How far line b sits shifted from line a (in samples), and how well it matches there. A shift
 * only counts when it lines up clearly better than none: a flat line (a solid color) matches
 * anywhere and would otherwise pile up made-up movement.
 */
function shiftOf(a: Float32Array, b: Float32Array, reach: number) {
  let zero = Infinity
  let best = 0
  let bestErr = Infinity
  // Nearest shifts first, so a tie goes to the smaller move.
  for (let j = 0; j <= reach * 2; j++) {
    const s = j % 2 ? (j + 1) / 2 : -j / 2
    let err = 0
    let k = 0
    for (let x = Math.max(0, s); x < Math.min(a.length, a.length + s); x++) {
      err += Math.abs(b[x] - a[x - s])
      k++
    }
    if (k < a.length * 0.4) continue
    err /= k
    if (s === 0) zero = err
    if (err < bestErr - 1e-6) {
      bestErr = err
      best = s
    }
  }
  if (best !== 0 && !(bestErr < zero * 0.85 && zero - bestErr > 0.15)) return { s: 0, err: zero }
  return { s: best, err: bestErr }
}

/** Share of pixels that sit flat against their neighbors: high for UI and graphics, low for photos. */
function flatness(f: Frames, i: number) {
  let flat = 0
  let all = 0
  for (let y = 0; y < f.h - 1; y += 2)
    for (let x = 0; x < f.w - 1; x += 2) {
      const p = y * f.w + x
      const v = px(f, i, p)
      if (Math.abs(v - px(f, i, p + 1)) <= 1 && Math.abs(v - px(f, i, p + f.w)) <= 1) flat++
      all++
    }
  return all ? flat / all : 0
}

/** A spring that overshoots this much and settles in about this long (mass 1). */
function springFor(overshoot: number, settleMs: number) {
  const l = Math.log(overshoot)
  const zeta = -l / Math.sqrt(Math.PI ** 2 + l ** 2)
  const omega = 4 / (zeta * (settleMs / 1000))
  return { stiffness: Math.round(omega ** 2), damping: Math.round(2 * zeta * omega * 10) / 10 }
}

/**
 * `diff`: mean absolute change per frame (0–255), as analyzeFrames computes it. Returns the reading;
 * a kind set by hand later only changes which part the panel and export use.
 */
export function readMotion(raw: Uint8Array, w: number, h: number, seg: Segment, fps: number, diff: number[]): MotionReading {
  const f: Frames = { raw, w, h, n: Math.floor(raw.length / (w * h)) }
  const ms = (i: number) => Math.round(seg.in * 1000 + (Math.max(0, i) / fps) * 1000)
  const total = Math.max(1, f.n - 1)

  // ── hard cuts: one frame where nearly everything changes, with calm frames either side ──
  const med = median(diff.slice(1))
  const cutAt: number[] = []
  for (let i = 1; i < diff.length; i++) {
    const d = diff[i]
    const around = Math.max(diff[i - 1] ?? 0, diff[i + 1] ?? 0)
    if (d > Math.max(18, med * 5) && around < d * 0.4) cutAt.push(i)
  }
  const calm = diff.map((d, i) => (cutAt.includes(i) ? 0 : d))

  // ── moves: runs of change between cuts, grown to catch slow starts and tails ──
  // Above the clip's own noise (compression grain), so a small element on a clean screen still
  // counts and a grainy clip doesn't move all the time.
  const peak = Math.max(...calm, 0)
  const noise = median(calm.slice(1))
  const threshold = Math.max(0.08, noise * 3, peak * 0.12)
  const floor = Math.max(0.02, noise * 1.5, peak * 0.01)
  const runs: [number, number][] = []
  for (let i = 1; i < calm.length; i++) {
    if (calm[i] < threshold) continue
    const last = runs[runs.length - 1]
    if (last && i - last[1] <= 3 && !cutAt.some((c) => c > last[1] && c <= i)) last[1] = i
    else runs.push([i, i])
  }
  const moves: Move[] = []
  for (const [a0, b0] of runs.filter(([a, b]) => b - a >= 2)) {
    let a = a0
    let b = b0
    while (a > 1 && calm[a - 1] > floor && !cutAt.includes(a - 1)) a--
    while (b < calm.length - 1 && calm[b + 1] > floor && !cutAt.includes(b + 1)) b++
    const first = a - 1
    moves.push(readMove(f, first, b, ms))
  }

  // ── signals ──
  const moving = calm.filter((d) => d > Math.max(0.6, med * 0.5)).length
  const stills = clamp01(1 - moving / total)
  const local = moves.length ? clamp01(1 - mean(moves.map((m) => m.area)) * 1.4) : 0.5
  const seconds = Math.max(0.1, (seg.out - seg.in) || f.n / fps)
  const cuts = clamp01(cutAt.length / seconds / 0.5)
  const samples = [0, Math.floor(f.n / 3), Math.floor((2 * f.n) / 3), f.n - 1].filter((i, k, xs) => i >= 0 && xs.indexOf(i) === k)
  const flat = mean(samples.map((i) => flatness(f, i)))
  // Letterboxing: black bars top and bottom read as film.
  const bar = (y0: number, y1: number) => {
    let s = 0
    let k = 0
    for (let y = y0; y < y1; y++) for (let x = 0; x < w; x += 4) (s += px(f, samples[0] ?? 0, y * w + x)), k++
    return k ? s / k : 255
  }
  const letterbox = h > 20 && bar(0, Math.floor(h * 0.08)) < 10 && bar(Math.ceil(h * 0.92), h) < 10
  const photo = clamp01((0.6 - flat) / 0.5 + (letterbox ? 0.2 : 0))
  const signals = { stills: round2(stills), local: round2(local), cuts: round2(cuts), photo: round2(photo) }

  // ── the kind: the best-fitting description, and how far ahead of the next it is ──
  const scores: Record<MotionKind, number> = {
    interface: stills * 0.35 + local * 0.4 + (1 - photo) * 0.25,
    graphic: stills * 0.3 + (1 - local) * 0.4 + (1 - photo) * 0.3,
    footage: cuts * 0.35 + (1 - stills) * 0.35 + photo * 0.3,
  }
  const ranked = (Object.keys(scores) as MotionKind[]).sort((x, y) => scores[y] - scores[x])
  const kind = ranked[0]
  const lead = scores[ranked[0]] - scores[ranked[1]]
  const sure = lead > 0.15 ? 'sure' : lead > 0.06 ? 'likely' : 'unsure'
  const why =
    kind === 'interface'
      ? 'One area moves on a still screen'
      : kind === 'graphic'
        ? 'Whole-frame moves with holds between, graphic look'
        : `${cutAt.length ? 'Steady cuts, ' : ''}always moving, photographic`

  const reading: MotionReading = { kind, sure, why, signals, moves, cuts: cutAt.map(ms) }

  // ── rhythm: repeated moves ──
  if (moves.length >= 2) {
    const durs = moves.map((m) => m.durationMs)
    const holds = moves.slice(1).map((m, i) => m.startMs - moves[i].endMs)
    const every = moves.slice(1).map((m, i) => m.startMs - moves[i].startMs)
    reading.rhythm = {
      beats: moves.length,
      holdMs: Math.round(mean(holds)),
      moveMs: Math.round(mean(durs)),
      spreadMs: Math.round(sd(durs)),
      everyMs: Math.round(mean(every)),
    }
  }

  // ── pacing: shots between cuts, camera moves within them ──
  const bounds = [0, ...cutAt, f.n - 1]
  const camera: { kind: string; startMs: number; endMs: number }[] = []
  for (let k = 0; k < bounds.length - 1; k++) {
    const a = bounds[k] + (k ? 1 : 0)
    const b = bounds[k + 1] - 1
    if (b - a < fps * 0.6) continue
    // Follow the frame's drift across the shot, a step at a time.
    let sx = 0
    let sy = 0
    let prev = profiles(f, a)
    const step = Math.max(1, Math.round(fps / 10))
    for (let i = a + step; i <= b; i += step) {
      const cur = profiles(f, i)
      sx += shiftOf(prev.cols, cur.cols, Math.ceil(w / 8)).s
      sy += shiftOf(prev.rows, cur.rows, Math.ceil(h / 8)).s
      prev = cur
    }
    const dx = sx / w
    const dy = sy / h
    let move = ''
    if (Math.abs(dx) > 0.12 && Math.abs(dx) >= Math.abs(dy)) move = dx < 0 ? 'pan left' : 'pan right'
    else if (Math.abs(dy) > 0.12) move = dy < 0 ? 'tilt up' : 'tilt down'
    if (move) camera.push({ kind: move, startMs: ms(a), endMs: ms(b) })
  }
  const shots = cutAt.length + 1
  const shotMs = Math.round((seconds * 1000) / shots)
  reading.pacing = { shots, shotMs, camera, feel: shotMs < 1200 ? 'energetic' : shotMs < 3000 ? 'steady' : 'calm' }
  return reading
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** One move between frames `a` (the last still one) and `b`. */
function readMove(f: Frames, a: number, b: number, ms: (i: number) => number): Move {
  const size = f.w * f.h
  // How much of the frame it touched.
  let touched = 0
  for (let p = 0; p < size; p += 2) if (Math.abs(px(f, b, p) - px(f, a, p)) > 12) touched++
  const area = Math.min(1, touched / (size / 2))

  // Follow the content's shift frame to frame: a slide, its direction and distance.
  let sx = 0
  let sy = 0
  const path: number[] = [0]
  const pathY: number[] = [0]
  let prev = profiles(f, a)
  let fit = 0
  for (let i = a + 1; i <= b; i++) {
    const cur = profiles(f, i)
    const x = shiftOf(prev.cols, cur.cols, Math.ceil(f.w / 4))
    const y = shiftOf(prev.rows, cur.rows, Math.ceil(f.h / 4))
    sx += x.s
    sy += y.s
    fit += x.err + y.err
    path.push(sx)
    pathY.push(sy)
    prev = cur
  }
  const horizontal = Math.abs(sx) >= Math.abs(sy)
  const shift = horizontal ? sx : sy
  const span = horizontal ? f.w : f.h
  const distance = Math.abs(shift) / span
  const along = horizontal ? path : pathY
  const slide = area > 0.35 && distance > 0.08 && fit / Math.max(1, b - a) < 12

  // Brightness only, no shift: a fade.
  const lum = (i: number) => {
    let s = 0
    for (let p = 0; p < size; p += 3) s += px(f, i, p)
    return s / (size / 3)
  }
  const fade = !slide && area > 0.35 && Math.abs(lum(b) - lum(a)) > 6

  let progress: number[]
  let spring: Move['spring']
  if (slide) {
    // Along the slide, which can overshoot (a spring) before settling.
    progress = along.map((v) => v / shift)
    const over = Math.max(...progress)
    if (over > 1.04 && Math.abs(progress[progress.length - 1] - 1) < 0.05) spring = springFor(over - 1, ms(b) - ms(a))
  } else {
    // Share of the start→end change done, frame by frame.
    let endNorm = 0
    for (let p = 0; p < size; p += 2) endNorm += (px(f, b, p) - px(f, a, p)) ** 2
    progress = []
    for (let i = a; i <= b; i++) {
      let dot = 0
      for (let p = 0; p < size; p += 2) dot += (px(f, i, p) - px(f, a, p)) * (px(f, b, p) - px(f, a, p))
      progress.push(endNorm ? dot / endNorm : 0)
    }
  }
  let hi = 0
  const monotone = progress.map((v) => (hi = Math.max(hi, Math.min(1, Math.max(0, v)))))
  monotone[monotone.length - 1] = 1

  const type: Move['type'] = slide ? 'slide' : fade ? 'fade' : area < 0.35 ? 'move' : 'change'
  // A slide's direction, or a small thing's when it clearly travels.
  const travels = slide || (area < 0.35 && distance > 0.03)
  const dir: Move['dir'] = travels ? (horizontal ? (shift < 0 ? '←' : '→') : shift < 0 ? '↑' : '↓') : undefined
  return {
    startMs: ms(a),
    endMs: ms(b),
    durationMs: ms(b) - ms(a),
    type,
    ...(dir ? { dir, distance: round2(distance) } : {}),
    area: round2(area),
    ease: fitBezier(monotone),
    ...(spring ? { spring } : {}),
  }
}

// ── for the panel ──────────────────────────────────────

/** How its speed changes, in a few plain words: "slows to a stop", "springy". */
export function feelOf(m: Move) {
  if (m.spring) return 'springy'
  const n = m.ease.nearest
  if (n === 'linear') return 'even speed'
  if (/in-?out/.test(n)) return 'smooth in and out'
  if (n === 'ease' || /out/.test(n)) return 'slows to a stop'
  if (/in/.test(n)) return 'speeds up'
  return 'smooth in and out'
}
/** The biggest move: what someone watching would call "the" motion. */
export const mainMove = (r: MotionReading) => r.moves.reduce<Move | null>((a, m) => (!a || m.durationMs * m.area > a.durationMs * a.area ? m : a), null)
