// Links between blocks on a canvas. A link is one reference (the video, site or block being
// copied or annotated) plus the blocks that follow it, and it has a number, shown on its lines
// and on its blocks. Each following block lists the links it's in (`links: [{ ref, n }]`): the
// same block can be in a few links, so a reference can have its copies linked to it together or
// each on their own. Older boards (and tools that write board.json) use a single `link: <ref>`,
// read here as joining that reference's first link.
import type { Frame } from './types.ts'

export interface FrameLink {
  /** the reference this block follows */
  ref: string
  /** the link's number on the canvas */
  n: number
}

/** How many links one block can be in, as a reference or following one. */
export const MAX_LINKS = 3

export interface LinkInfo {
  n: number
  ref: string
  /** the blocks following the reference */
  members: string[]
}

/** The links a block follows (empty when it follows none). */
export const linksOf = (f: Frame): FrameLink[] => f.links ?? []
/** The references a block follows, first link first. */
export const refsOf = (f: Frame): string[] => linksOf(f).map((l) => l.ref)

const infos = new WeakMap<Frame[], Map<number, LinkInfo>>()
/** Every link on the board by number. Cached per frames array. */
export function allLinks(frames: Frame[]): Map<number, LinkInfo> {
  let m = infos.get(frames)
  if (m) return m
  m = new Map()
  const ids = new Set(frames.map((f) => f.id))
  for (const f of frames)
    for (const l of linksOf(f)) {
      if (!ids.has(l.ref)) continue
      const info = m.get(l.n) ?? { n: l.n, ref: l.ref, members: [] }
      info.members.push(f.id)
      m.set(l.n, info)
    }
  infos.set(frames, m)
  return m
}

const byFrame = new WeakMap<Frame[], Map<string, number[]>>()
/** The numbers of the links a block is in, as a reference or following one, lowest first. */
export function linkNumbers(id: string, frames: Frame[]): number[] {
  let m = byFrame.get(frames)
  if (!m) {
    m = new Map()
    for (const l of allLinks(frames).values())
      for (const x of [l.ref, ...l.members]) {
        const list = m.get(x) ?? []
        if (!list.includes(l.n)) list.push(l.n)
        m.set(x, list)
      }
    for (const list of m.values()) list.sort((a, b) => a - b)
    byFrame.set(frames, m)
  }
  return m.get(id) ?? []
}

export const nextLinkNumber = (frames: Frame[]) => Math.max(0, ...allLinks(frames).keys(), ...frames.flatMap((f) => linksOf(f).map((l) => l.n))) + 1

/** Link colors repeat after this many; the numbers keep going. */
export const LINK_COLORS = 8
export const linkColor = (n: number) => `var(--link-${((n - 1) % LINK_COLORS) + 1})`

/**
 * Brings a board's links up to date: a legacy `link: <ref>` joins that reference's first link
 * (or starts one), links to blocks that are gone are dropped, and repeats are removed.
 * Returns the same array when nothing changed.
 */
export function normalizeLinks(frames: Frame[]): Frame[] {
  const ids = new Set(frames.map((f) => f.id))
  const needs = frames.some((f) => f.link !== undefined || linksOf(f).some((l) => !ids.has(l.ref) || l.ref === f.id))
  if (!needs) return frames
  let next = nextLinkNumber(frames)
  // A reference's first link, for legacy links to join (so an old group stays one link).
  const firstOf = new Map<string, number>()
  for (const f of frames) for (const l of linksOf(f)) if (!firstOf.has(l.ref) || l.n < firstOf.get(l.ref)!) firstOf.set(l.ref, l.n)
  return frames.map((f) => {
    if (f.link === undefined && !linksOf(f).some((l) => !ids.has(l.ref) || l.ref === f.id)) return f
    const links = linksOf(f).filter((l) => ids.has(l.ref) && l.ref !== f.id)
    if (f.link && ids.has(f.link) && f.link !== f.id && !links.some((l) => l.ref === f.link)) {
      let n = firstOf.get(f.link)
      if (n === undefined) firstOf.set(f.link, (n = next++))
      links.push({ ref: f.link, n })
    }
    const out: Frame = { ...f, links: links.length ? links : undefined }
    delete out.link
    return out
  })
}
