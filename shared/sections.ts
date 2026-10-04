// Sections group blocks by where they sit: a block is in a section when its center is inside it,
// a section is in another when it fits entirely inside it. Nothing stores the membership, so
// moving a block in or out (on the canvas or by editing board.json) is all it takes.
import type { Frame } from './types.ts'

export const isSection = (f: Frame) => f.type === 'section'

/** Room kept between a section's edge and what's in it (and above it for the title). */
export const SECTION_PAD = 48

const inside = (f: Frame, s: Frame) =>
  isSection(f)
    ? f.x >= s.x && f.y >= s.y && f.x + f.w <= s.x + s.w && f.y + f.h <= s.y + s.h && f.w * f.h < s.w * s.h
    : f.x + f.w / 2 > s.x && f.x + f.w / 2 < s.x + s.w && f.y + f.h / 2 > s.y && f.y + f.h / 2 < s.y + s.h

/** Everything in a section, nested sections and their contents included. */
export const sectionContents = (s: Frame, frames: Frame[]) => frames.filter((f) => f !== s && f.id !== s.id && inside(f, s))

/** The innermost section a frame is in, if any. */
export function sectionOf(f: Frame, frames: Frame[]): Frame | undefined {
  let best: Frame | undefined
  for (const s of frames) if (isSection(s) && s.id !== f.id && inside(f, s) && (!best || s.w * s.h < best.w * best.h)) best = s
  return best
}

/** The innermost section under a point. */
export function sectionAt(x: number, y: number, frames: Frame[], skip?: Set<string>): Frame | undefined {
  let best: Frame | undefined
  for (const s of frames)
    if (isSection(s) && !skip?.has(s.id) && x > s.x && x < s.x + s.w && y > s.y && y < s.y + s.h && (!best || s.w * s.h < best.w * best.h)) best = s
  return best
}

/** The ids plus, for each section among them, everything in it. */
export function withContents(ids: string[], frames: Frame[]): string[] {
  const out = new Set(ids)
  for (const f of frames) if (out.has(f.id) && isSection(f)) for (const c of sectionContents(f, frames)) out.add(c.id)
  return [...out]
}

/** Sections biggest first: they paint behind, so a nested one sits on top of its parent. */
export const bySize = (a: Frame, b: Frame) => b.w * b.h - a.w * a.h

/** Bounds of some frames, grown by `pad` (title room on top). */
export function boundsAround(frames: Frame[], pad = SECTION_PAD) {
  const x0 = Math.min(...frames.map((f) => f.x))
  const y0 = Math.min(...frames.map((f) => f.y))
  const x1 = Math.max(...frames.map((f) => f.x + f.w))
  const y1 = Math.max(...frames.map((f) => f.y + f.h))
  return { x: Math.round(x0 - pad), y: Math.round(y0 - pad), w: Math.round(x1 - x0 + pad * 2), h: Math.round(y1 - y0 + pad * 2) }
}
