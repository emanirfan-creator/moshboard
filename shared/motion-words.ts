// Animations in the words designers and AI tools already share ("pop in", "ease-out", "stagger"),
// with the numbers: "Card: on hover, fade and move, ease-out, 240ms. Feel: snappy." A line like
// that is a complete brief. Used by the export (motion.md); the app's own names stay as they are.
import type { Bezier, Param, ParamValue, Spring } from './params.ts'

export interface MotionFacts {
  /** what sets it off: "hover", "mount" */
  trigger?: string
  /** what it changes, as written in `@animates`: "transform, opacity" */
  animates?: string
  ease?: Bezier
  spring?: Spring
  /** ms */
  duration?: number
  delay?: number
  stagger?: number
}

/** The curve's common name: "ease-out", "ease-in-out", "linear", plus "overshoots" / "pulls back first". */
export function easeWords([x1, y1, x2, y2]: Bezier): string {
  // How fast it starts and ends, relative to constant speed.
  const start = x1 === 0 ? (y1 > 0 ? Infinity : 1) : y1 / x1
  const end = x2 === 1 ? (y2 < 1 ? Infinity : 1) : (1 - y2) / (1 - x2)
  const fast = (s: number) => s > 1.25
  const slow = (s: number) => s < 0.8
  let name = 'ease-in-out'
  if (Math.abs(start - 1) < 0.25 && Math.abs(end - 1) < 0.25) name = 'linear'
  else if (fast(start) && !fast(end)) name = 'ease-out'
  else if (!fast(start) && fast(end)) name = 'ease-in'
  else if (slow(start) && slow(end)) name = 'ease-in-out'
  else if (fast(start) && fast(end)) name = 'ease-out'
  const extra = [y1 < -0.02 || y2 < -0.02 ? 'pulls back first' : '', y1 > 1.02 || y2 > 1.02 ? 'overshoots' : ''].filter(Boolean)
  return [name, ...extra].join(', ')
}

/** How much a spring bounces, from its damping ratio. */
export function springBounce(s: Spring): 'none' | 'slight' | 'bouncy' {
  const ratio = s.damping / (2 * Math.sqrt(s.stiffness * (s.mass ?? 1)))
  return ratio >= 1 ? 'none' : ratio >= 0.5 ? 'slight' : 'bouncy'
}

export function springWords(s: Spring): string {
  const bounce = springBounce(s)
  const how = bounce === 'none' ? 'spring, no bounce' : bounce === 'slight' ? 'spring, slight bounce' : 'bouncy spring'
  return `${how} (stiffness ${s.stiffness}, damping ${s.damping}${s.mass !== undefined && s.mass !== 1 ? `, mass ${s.mass}` : ''})`
}

const overshoots = (f: MotionFacts) => (f.spring ? springBounce(f.spring) !== 'none' : !!f.ease && (f.ease[1] > 1.02 || f.ease[3] > 1.02))

/** "fade and move", "pop": what it changes, from `@animates`. */
export function movesWords(f: MotionFacts): string {
  if (!f.animates) return ''
  const a = f.animates.toLowerCase()
  const acts: string[] = []
  if (/opacity|autoalpha|\bfade/.test(a)) acts.push('fade')
  if (/\bscale/.test(a)) acts.push(overshoots(f) ? 'pop' : 'scale')
  if (/translate|mov|\b[xy]\b|\bleft\b|\btop\b|position|slide/.test(a) || (/transform/.test(a) && !/\bscale|rotat/.test(a))) acts.push('move')
  if (/rotat/.test(a)) acts.push('rotate')
  if (/blur|filter/.test(a)) acts.push('blur')
  if (/clip|mask/.test(a)) acts.push('reveal')
  if (/width|height|layout/.test(a)) acts.push('resize')
  if (/colou?r|background/.test(a)) acts.push('change color')
  return acts.length > 1 ? `${acts.slice(0, -1).join(', ')} and ${acts[acts.length - 1]}` : acts[0] ?? ''
}

/** One word for the mood, from how long it takes and how it moves. */
export function feelWord(f: MotionFacts): string {
  if (f.spring) {
    const bounce = springBounce(f.spring)
    if (bounce === 'bouncy') return 'playful'
    if (bounce === 'slight') return 'lively'
    return f.spring.stiffness >= 300 ? 'snappy' : 'soft'
  }
  const ms = f.duration
  if (ms === undefined) return ''
  if (f.ease && (f.ease[1] > 1.02 || f.ease[3] > 1.02)) return 'playful'
  const words = f.ease ? easeWords(f.ease) : ''
  if (words.startsWith('linear')) return ms < 300 ? 'mechanical' : 'steady'
  if (ms < 150) return 'instant'
  if (ms <= 250) return 'snappy'
  if (ms <= 400) return words.startsWith('ease-in-out') ? 'calm' : 'smooth'
  return words.startsWith('ease-in-out') ? 'slow and calm' : 'slow'
}

const TRIGGERS: Record<string, string> = {
  hover: 'on hover',
  click: 'on click',
  tap: 'on tap',
  press: 'on press',
  mount: 'when it appears',
  scroll: 'on scroll',
  loop: 'on a loop',
  focus: 'on focus',
  animate: '',
}

/** "on hover, fade and move, ease-out, 240ms, after 40ms, 60ms between items. Feel: snappy" */
export function motionBrief(f: MotionFacts): string {
  const trigger = f.trigger ? (TRIGGERS[f.trigger.toLowerCase()] ?? f.trigger) : ''
  const parts = [
    trigger,
    movesWords(f),
    f.spring ? springWords(f.spring) : f.ease ? easeWords(f.ease) : '',
    f.duration !== undefined && !f.spring ? `${Math.round(f.duration)}ms` : '',
    f.delay ? `after ${Math.round(f.delay)}ms` : '',
    f.stagger ? `staggered, ${Math.round(f.stagger)}ms between items` : '',
  ].filter(Boolean)
  const feel = feelWord(f)
  return `${parts.join(', ')}${feel ? `. Feel: ${feel}` : ''}`
}

/** The board's overall mood, from every animation's feel: "snappy", or "mostly smooth, some playful". */
export function overallFeel(all: MotionFacts[]): string {
  const counts = new Map<string, number>()
  for (const f of all) {
    const w = feelWord(f)
    if (w) counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]).map(([w]) => w)
  if (!ranked.length) return ''
  if (ranked.length === 1) return ranked[0]
  return `mostly ${ranked[0]}, some ${ranked.slice(1, 3).join(' and ')}`
}

// ── Feel nudges: "Snappy", "Soft", "Bouncy", "Calm" move the right controls one step ──

export type Feel = 'snappy' | 'soft' | 'bouncy' | 'calm'
export const FEELS: Feel[] = ['snappy', 'soft', 'bouncy', 'calm']

type Nudgeable = Pick<Param, 'name' | 'kind' | 'unit' | 'min' | 'max' | 'soft' | 'label'>
const r2 = (n: number) => Math.round(n * 100) / 100
const r1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const isLength = (p: Nudgeable) => p.kind === 'number' && p.unit === 'ms' && !/delay|stagger/i.test(`${p.name} ${p.label ?? ''}`)
const isBounce = (p: Nudgeable) => p.kind === 'number' && p.unit !== 'ms' && /bounce/i.test(`${p.name} ${p.label ?? ''}`)

/** One step toward a feel, for every control it touches: name → new value. Delays and staggers stay. */
export function nudgeFeel(feel: Feel, params: Nudgeable[], values: Record<string, unknown>): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {}
  for (const p of params) {
    const v = values[p.name]
    if (isLength(p) && typeof v === 'number' && v > 0) {
      const k = feel === 'snappy' ? 0.8 : feel === 'calm' ? 1.25 : feel === 'soft' ? 1.1 : 1
      if (k === 1) continue
      // Past the slider's range is fine when the range is only a guide (`soft`).
      const lo = p.soft ? 40 : (p.min ?? 40)
      const hi = p.soft ? 4000 : (p.max ?? 4000)
      out[p.name] = Math.round(clamp(v * k, lo, hi))
    } else if (p.kind === 'ease' && Array.isArray(v)) {
      let [x1, y1, x2, y2] = v as Bezier
      if (feel === 'bouncy') {
        // Overshoot at the end: the second handle rises above 1.
        y2 = Math.min(1.6, Math.max(1, y2) + 0.12)
        x2 = Math.min(x2, 0.7)
      } else if (feel === 'soft') {
        if (y2 > 1) y2 = Math.max(1, y2 - 0.12)
        if (y1 > 1) y1 = Math.max(1, y1 - 0.12)
        if (y1 < 0) y1 = Math.min(0, y1 + 0.1)
      } else if (feel === 'snappy') {
        // A quicker start.
        x1 = Math.max(0, x1 - 0.08)
        y1 = Math.min(y1 + 0.15, Math.max(1, y1))
      } else {
        // Calm: eases in and out.
        x1 = Math.min(0.6, x1 + 0.1)
        y1 = Math.max(0, Math.min(y1, 1) - 0.1)
      }
      out[p.name] = [r2(x1), r2(y1), r2(x2), r2(y2)]
    } else if (p.kind === 'spring' && v && typeof v === 'object') {
      const s = v as Spring
      // Stiffness sets speed; damping scaled by √ of it keeps the bounce the same.
      const speed = feel === 'snappy' ? 1.3 : feel === 'calm' ? 0.75 : feel === 'soft' ? 0.9 : 1
      const bounce = feel === 'bouncy' ? 0.8 : feel === 'soft' ? 1.2 : 1
      out[p.name] = { ...s, stiffness: r1(s.stiffness * speed), damping: r1(s.damping * Math.sqrt(speed) * bounce) }
    } else if (isBounce(p) && typeof v === 'number' && (feel === 'bouncy' || feel === 'soft')) {
      out[p.name] = r2(clamp(v + (feel === 'bouncy' ? 0.1 : -0.1), p.min ?? 0, p.max ?? 1))
    }
  }
  return out
}

// ── Quiet notes: the few rules worth pointing out on the board ──

/** Most interface motion is under this. */
export const LONG_MS = 300

/** A loop (spinner, marquee, ambient motion), by its name or a constant-speed curve: no feel or length rules apply. */
export function looksLikeLoop(title: string, ease?: Bezier) {
  return /loop|spin|marquee|rotat|infinite|pulse|float|orbit|shimmer/i.test(title) || (!!ease && easeWords(ease).startsWith('linear'))
}

/** "Runs long" for a transition over 300ms; loops, spins and keyframe animations are left alone. */
export function runsLong(ms: number | undefined, opts: { title?: string; ease?: Bezier; trigger?: string } = {}) {
  if (ms === undefined || ms <= LONG_MS) return false
  if (/animation/i.test(opts.title ?? '') || /loop|scroll/i.test(opts.trigger ?? '')) return false
  return !looksLikeLoop(opts.title ?? '', opts.ease)
}

const EXIT = /exit|leave|hide|hidden|close|out\b|fades out/i
const ENTER = /enter|animate|visible|show|open|\bin\b|fades in|appear/i

/** Names the exits that run slower than their entrance: exit name → the entrance's ms. */
export function slowExits(items: { name: string; text: string; ms?: number }[]): Map<string, number> {
  const out = new Map<string, number>()
  const enters = items.filter((i) => i.ms && ENTER.test(i.text) && !EXIT.test(i.text))
  if (!enters.length) return out
  const enter = Math.min(...enters.map((i) => i.ms!))
  for (const i of items) if (i.ms && EXIT.test(i.text) && i.ms > enter) out.set(i.name, enter)
  return out
}
