// Animations in the words designers and AI tools already share ("pop in", "ease-out", "stagger"),
// with the numbers: "Card: on hover, fade and move, ease-out, 240ms. Feel: snappy." A line like
// that is a complete brief. Used by the export (motion.md); the app's own names stay as they are.
import type { Bezier, Spring } from './params.ts'

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
