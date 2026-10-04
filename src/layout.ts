import type { Frame, LayoutNode, SectionLayout } from '../shared/types.ts'
import { isSection, sectionOf } from '../shared/sections.ts'
import { BLOCK_HEAD, BLOCK_PAD, isBlock } from './canvas/blocks'

// A section can lay out the blocks in it: a grid (a tree of splits), columns (masonry,
// each block keeps its shape) or rows (equal-height rows that fill the width). The layout
// lives on the section (`layout` in board.json) and writes every block's x/y/w/h, so
// everything else (export, links, Compare) sees ordinary frames.

export type Rect = { x: number; y: number; w: number; h: number }
export type LayoutMode = SectionLayout['mode']

/** Room between a layout section's edge and its blocks. */
export const LAYOUT_PAD = 24
export const LAYOUT_GAP = 16
/** Smallest a block gets when a line is dragged against it. */
export const MIN_TILE = 56
/** Dragged this far past a block's smallest size, the block moves out of the way. */
export const PUSH = 48

// ── shapes ─────────────────────────────────────────────

type Kid = { n: LayoutNode; w: number }
const kid = (n: number | LayoutNode | Kid): Kid => (typeof n === 'number' ? { n: { slot: n }, w: 1 } : 'w' in n ? (n as Kid) : { n: n as LayoutNode, w: 1 })
const wt = (n: number | LayoutNode, w: number): Kid => ({ n: typeof n === 'number' ? { slot: n } : n, w })
const row = (...ks: (number | LayoutNode | Kid)[]): LayoutNode => ({ dir: 'row', kids: ks.map(kid) })
const col = (...ks: (number | LayoutNode | Kid)[]): LayoutNode => ({ dir: 'col', kids: ks.map(kid) })
export const isLeaf = (n: LayoutNode): n is { slot: number } => 'slot' in n

/** Hand-made shapes per count: the tree and its height for a width of 1. Slot 0 is the big one. */
const SHAPES: Record<number, { t: LayoutNode; a: number }[]> = {
  1: [{ t: { slot: 0 }, a: 0.62 }],
  2: [{ t: row(0, 1), a: 0.5 }, { t: row(wt(0, 2), 1), a: 0.42 }, { t: col(0, 1), a: 1.1 }],
  3: [{ t: row(wt(0, 2), col(1, 2)), a: 0.6 }, { t: row(0, 1, 2), a: 0.38 }, { t: col(wt(0, 1.5), row(1, 2)), a: 0.95 }],
  4: [
    { t: row(wt(0, 2), col(1, 2, 3)), a: 0.62 },
    { t: col(row(0, 1), row(2, 3)), a: 0.7 },
    { t: col(wt(0, 1.5), row(1, 2, 3)), a: 0.8 },
    { t: row(wt(0, 1.6), col(1, row(2, 3))), a: 0.62 },
  ],
  5: [
    { t: row(wt(0, 2), col(row(1, 2), row(3, 4))), a: 0.58 },
    { t: col(wt(row(wt(0, 2), 1), 1.6), row(2, 3, 4)), a: 0.82 },
    { t: row(col(wt(0, 2), 1), col(2, 3, 4)), a: 0.72 },
    { t: col(row(0, 1, 2), row(wt(3, 2), 4)), a: 0.62 },
  ],
  6: [
    { t: row(wt(0, 2), col(row(1, 2), row(3, 4), 5)), a: 0.68 },
    { t: col(wt(row(wt(0, 2), col(1, 2)), 1.6), row(3, 4, 5)), a: 0.85 },
    { t: col(row(0, 1, 2), row(3, 4, 5)), a: 0.62 },
    { t: row(col(wt(0, 2), 1), col(2, 3), col(4, 5)), a: 0.62 },
  ],
  7: [
    { t: col(wt(row(wt(0, 2), col(1, 2)), 1.6), row(3, 4, 5, 6)), a: 0.8 },
    { t: row(wt(0, 1.6), col(row(1, 2), row(3, 4), row(5, 6))), a: 0.7 },
    { t: col(row(0, 1, 2), row(3, 4, 5, 6)), a: 0.58 },
  ],
  8: [
    { t: col(wt(row(wt(0, 2), col(1, 2)), 1.6), row(3, 4, 5), row(6, 7)), a: 0.95 },
    { t: col(row(0, 1, 2, 3), row(4, 5, 6, 7)), a: 0.5 },
    { t: row(wt(0, 1.6), col(row(1, 2), row(3, 4), row(5, 6, 7))), a: 0.7 },
  ],
}

/** Shapes for any count: the hand-made ones, or a big block over rows of four. */
export function shapesFor(n: number): { t: LayoutNode; a: number }[] {
  if (n <= 0) return []
  if (SHAPES[n]) return SHAPES[n]
  const rowsOf = (from: number, per: number) => {
    const out: LayoutNode[] = []
    for (let i = from; i < n; i += per) out.push(row(...Array.from({ length: Math.min(per, n - i) }, (_, k) => i + k)))
    return out
  }
  const hero = row(wt(0, 2), col(1, 2))
  const rest = rowsOf(3, 4)
  const plain = rowsOf(0, 4)
  return [
    { t: col(wt(hero, 2), ...rest), a: 0.4 + rest.length * 0.25 },
    { t: col(...plain), a: plain.length * 0.25 },
  ]
}

export const COLUMN_OPTIONS = [2, 3, 4, 5]
export const ROW_OPTIONS = [{ h: 160, label: 'Short' }, { h: 240, label: 'Medium' }, { h: 320, label: 'Tall' }]

/** The choices offered for a mode and count (shape index, column count or row height). */
export function optionsFor(mode: LayoutMode, n: number): number[] {
  if (mode === 'grid') return shapesFor(n).map((_, i) => i)
  if (mode === 'columns') return COLUMN_OPTIONS
  return ROW_OPTIONS.map((r) => r.h)
}
/** Which option a layout is on, if any (a grid reshaped by hand is on none). */
export function currentOption(L: SectionLayout): number | null {
  if (L.mode === 'grid') return L.shape ?? null
  if (L.mode === 'columns') return L.columns ?? 3
  return L.rowHeight ?? 240
}
/** A layout set to an option, fresh: hand changes for the old shape are dropped. */
export function withOption(L: SectionLayout, mode: LayoutMode, option: number): SectionLayout {
  const base: SectionLayout = { mode, order: L.order, gap: L.gap }
  if (mode === 'grid') return { ...base, shape: option }
  if (mode === 'columns') return { ...base, columns: option }
  return { ...base, rowHeight: option }
}

// ── tree ───────────────────────────────────────────────

const clone = <T,>(x: T): T => structuredClone(x)
export const slotsOf = (n: LayoutNode): number[] => (isLeaf(n) ? [n.slot] : n.kids.flatMap((k) => slotsOf(k.n)))
/** The split at a path of kid indexes from the root. */
export function nodeAt(tree: LayoutNode, path: number[]): LayoutNode {
  let n = tree
  for (const i of path) n = (n as Exclude<LayoutNode, { slot: number }>).kids[i].n
  return n
}
function trailTo(n: LayoutNode, slot: number, trail: number[] = []): number[] | null {
  if (isLeaf(n)) return n.slot === slot ? trail : null
  for (let i = 0; i < n.kids.length; i++) {
    const t = trailTo(n.kids[i].n, slot, [...trail, i])
    if (t) return t
  }
  return null
}
/** The tree without a slot's leaf; a split left with one part becomes that part. Slots keep their numbers. */
export function detachLeaf(tree: LayoutNode, slot: number): LayoutNode | undefined {
  const t = trailTo(tree, slot)
  if (!t) return tree
  if (!t.length) return undefined
  const out = clone(tree)
  const parent = nodeAt(out, t.slice(0, -1)) as Exclude<LayoutNode, { slot: number }>
  parent.kids.splice(t[t.length - 1], 1)
  if (parent.kids.length === 1) {
    const only = parent.kids[0].n
    if (t.length === 1) return only
    const gp = nodeAt(out, t.slice(0, -2)) as Exclude<LayoutNode, { slot: number }>
    gp.kids[t[t.length - 2]].n = only
  }
  return out
}
/** Put a new slot beside another by splitting that block along its longer side. */
export function splitLeaf(tree: LayoutNode, target: number, slot: number, rect: Rect): LayoutNode {
  const t = trailTo(tree, target)
  const split: LayoutNode = { dir: rect.w >= rect.h ? 'row' : 'col', kids: [{ n: { slot: target }, w: 1 }, { n: { slot }, w: 1 }] }
  if (!t) return tree
  if (!t.length) return split
  const out = clone(tree)
  const parent = nodeAt(out, t.slice(0, -1)) as Exclude<LayoutNode, { slot: number }>
  parent.kids[t[t.length - 1]].n = split
  return out
}
/** After a slot is gone: slots above it move down one, so they stay 0..n-1. */
function renumber(n: LayoutNode, gone: number): LayoutNode {
  if (isLeaf(n)) return n.slot > gone ? { slot: n.slot - 1 } : n
  return { dir: n.dir, kids: n.kids.map((k) => ({ n: renumber(k.n, gone), w: k.w })) }
}
export function evenTree(n: LayoutNode): LayoutNode {
  return isLeaf(n) ? n : { dir: n.dir, kids: n.kids.map((k) => ({ n: evenTree(k.n), w: 1 })) }
}
export function minExtent(n: LayoutNode, axis: 'x' | 'y', gap: number): number {
  if (isLeaf(n)) return MIN_TILE
  const ms = n.kids.map((k) => minExtent(k.n, axis, gap))
  return (n.dir === 'row') === (axis === 'x') ? ms.reduce((a, b) => a + b, 0) + gap * (ms.length - 1) : Math.max(...ms)
}

// ── geometry ───────────────────────────────────────────

export interface Leaf extends Rect {
  slot: number
  /** kid indexes from the root to this leaf */
  trail: number[]
}
export interface Line {
  /** the split it belongs to, and the part after it */
  path: number[]
  i: number
  axis: 'x' | 'y'
  /** world position across the axis, where it starts and how long it is */
  at: number
  from: number
  len: number
  /** sizes of the parts on either side */
  sa: number
  sb: number
}
export interface Geo {
  rects: Map<string, Rect>
  /** height of what's laid out (the section is this plus padding in columns/rows) */
  height: number
  lines: Line[]
  leaves: Leaf[]
  leafOf: Map<string, Leaf>
  colW?: number
  cols?: number
  rowOf?: Map<string, number>
  rows?: { h: number; max: number }[]
}

/** The area blocks are laid out in. */
export const layoutArea = (s: Rect): Rect => ({ x: s.x + LAYOUT_PAD, y: s.y + LAYOUT_PAD, w: Math.max(80, s.w - LAYOUT_PAD * 2), h: Math.max(80, s.h - LAYOUT_PAD * 2) })

/** A frame's content shape, from its own size (a block's header and padding aren't content). */
export function aspectOf(f: Frame) {
  const n = f.natural ?? f
  const a = isBlock(f) ? (n.w - BLOCK_PAD * 2) / Math.max(1, n.h - BLOCK_HEAD - BLOCK_PAD) : n.w / Math.max(1, n.h)
  return Math.min(4, Math.max(0.25, a || 1))
}

/** The grid's tree for its current count: as stored, or its shape built fresh. */
export function treeFor(L: SectionLayout): LayoutNode | undefined {
  const n = L.order.length
  if (!n) return undefined
  const valid = (t?: LayoutNode) => {
    if (!t) return false
    const s = slotsOf(t).sort((a, b) => a - b)
    return s.length === n && s.every((v, i) => v === i)
  }
  if (valid(L.tree)) return L.tree
  const shapes = shapesFor(n)
  return clone(shapes[Math.min(L.shape ?? 0, shapes.length - 1)].t)
}
/** Height a grid shape wants at a width. */
export function shapeHeight(n: number, shape: number, width: number) {
  const shapes = shapesFor(n)
  return Math.round(width * (shapes[Math.min(shape, shapes.length - 1)]?.a ?? 0.62))
}

function layoutTree(n: LayoutNode, r: Rect, gap: number, out: Geo, trail: number[], path: number[]) {
  if (isLeaf(n)) return void out.leaves.push({ ...r, slot: n.slot, trail })
  const horiz = n.dir === 'row'
  const tot = n.kids.reduce((s, k) => s + k.w, 0) || 1
  const avail = (horiz ? r.w : r.h) - gap * (n.kids.length - 1)
  let pos = horiz ? r.x : r.y
  let prev = 0
  n.kids.forEach((k, i) => {
    const s = (avail * k.w) / tot
    if (i > 0) out.lines.push({ path, i, axis: horiz ? 'x' : 'y', at: pos - gap / 2, from: horiz ? r.y : r.x, len: horiz ? r.h : r.w, sa: prev, sb: s })
    const sub = horiz ? { x: pos, y: r.y, w: s, h: r.h } : { x: r.x, y: pos, w: r.w, h: s }
    layoutTree(k.n, sub, gap, out, [...trail, i], [...trail, i])
    prev = s
    pos += s + gap
  })
}

/** The spots of a tree laid out in a section, whatever slots it holds. */
export function treeLeaves(tree: LayoutNode, section: Rect, gap: number): Leaf[] {
  const geo: Geo = { rects: new Map(), height: 0, lines: [], leaves: [], leafOf: new Map() }
  layoutTree(tree, layoutArea(section), gap, geo, [], [])
  return geo.leaves
}

/** The smallest a layout section can be resized to: its blocks at their smallest, plus padding. */
export function minLayoutSize(L: SectionLayout) {
  const tree = L.mode === 'grid' ? treeFor(L) : undefined
  const pad = LAYOUT_PAD * 2
  if (!tree) return { w: 240, h: 160 }
  return { w: minExtent(tree, 'x', L.gap) + pad, h: minExtent(tree, 'y', L.gap) + pad }
}

/** Where every block in a layout section goes. `byId` gives each block's own shape. */
export function computeLayout(section: Rect, L: SectionLayout, byId: (id: string) => Frame | undefined): Geo {
  const area = layoutArea(section)
  const geo: Geo = { rects: new Map(), height: 0, lines: [], leaves: [], leafOf: new Map() }
  const ids = L.order
  if (!ids.length) return { ...geo, height: L.mode === 'grid' ? area.h : 120 }
  const gap = L.gap
  if (L.mode === 'grid') {
    const tree = treeFor(L)!
    layoutTree(tree, area, gap, geo, [], [])
    for (const l of geo.leaves) {
      const id = ids[l.slot]
      if (!id) continue
      geo.rects.set(id, { x: l.x, y: l.y, w: l.w, h: l.h })
      geo.leafOf.set(id, l)
    }
    return { ...geo, height: area.h }
  }
  const aspect = (id: string) => {
    const f = byId(id)
    return f ? aspectOf(f) : 1
  }
  if (L.mode === 'columns') {
    const k = Math.max(1, L.columns ?? 3)
    const colW = (area.w - (k - 1) * gap) / k
    const hs = Array(k).fill(0)
    for (const id of ids) {
      const span = Math.min(k, L.span?.[id] ?? 1)
      const w = span * colW + (span - 1) * gap
      let c = 0
      let top = Infinity
      for (let i = 0; i + span <= k; i++) {
        const t = Math.max(...hs.slice(i, i + span))
        if (t < top) {
          top = t
          c = i
        }
      }
      const h = w / aspect(id)
      geo.rects.set(id, { x: area.x + c * (colW + gap), y: area.y + top, w, h })
      for (let i = c; i < c + span; i++) hs[i] = top + h + gap
    }
    return { ...geo, height: Math.max(...hs) - gap, colW, cols: k }
  }
  // rows: packed at the row height, full rows stretched to the width; a row given its own
  // height keeps its blocks and gets shorter or taller, never wider than the area
  const H = L.rowHeight ?? 240
  const rows: { ids: string[]; full: boolean }[] = []
  let cur: string[] = []
  for (const id of ids) {
    cur.push(id)
    if (cur.reduce((s, i) => s + aspect(i) * H, 0) + (cur.length - 1) * gap >= area.w) {
      rows.push({ ids: cur, full: true })
      cur = []
    }
  }
  if (cur.length) rows.push({ ids: cur, full: false })
  let y = area.y
  const rowOf = new Map<string, number>()
  const info: { h: number; max: number }[] = []
  rows.forEach((r, ri) => {
    const sumA = r.ids.reduce((s, i) => s + aspect(i), 0)
    const fit = (area.w - (r.ids.length - 1) * gap) / sumA
    const own = L.rowH?.[ri]
    const h = own ? Math.min(own, fit) : r.full ? fit : Math.min(H, fit)
    let x = area.x
    for (const id of r.ids) {
      const w = aspect(id) * h
      geo.rects.set(id, { x, y, w, h })
      rowOf.set(id, ri)
      x += w + gap
    }
    info.push({ h, max: fit })
    y += h + gap
  })
  return { ...geo, height: y - gap - area.y, rowOf, rows: info }
}

// ── keeping sections and their blocks in step ──────────

const centerIn = (f: Rect, s: Rect) => f.x + f.w / 2 > s.x && f.x + f.w / 2 < s.x + s.w && f.y + f.h / 2 > s.y && f.y + f.h / 2 < s.y + s.h

/**
 * Bring every layout section and its blocks in line: ids of deleted blocks leave the
 * order, blocks put inside a layout section join it (splitting its biggest block), blocks
 * moved out of one leave it (back at their own size), and every block gets the place its
 * layout gives it. Only blocks in `joinable` (just moved, pasted or added) can join or leave:
 * one a section grew over stays out, and one the layout moved stays in. Returns the same array when nothing changes.
 */
export function settleLayouts(frames: Frame[], joinable: (f: Frame) => boolean = () => false): Frame[] {
  if (!frames.some((f) => f.layout)) return frames
  const byId = new Map(frames.map((f) => [f.id, f]))
  const patch = new Map<string, Partial<Frame>>()
  const put = (id: string, p: Partial<Frame>) => patch.set(id, { ...patch.get(id), ...p })
  const claimed = new Set<string>()
  const sections = frames.filter((f) => isSection(f) && f.layout)
  for (const s of sections) for (const id of s.layout!.order) if (byId.has(id)) claimed.add(id)

  for (const s of sections) {
    let L = s.layout!
    const own = new Set<string>()
    // Who stays: still here, a block, not taken by an earlier section, and not moved out by
    // hand (one the layout itself put outside, mid-resize, stays in).
    const keep = (id: string) => {
      const f = byId.get(id)
      if (!f || isSection(f) || own.has(id)) return false
      if (joinable(f) && !centerIn(f, s)) {
        if (f.natural) put(id, { w: f.natural.w, h: f.natural.h, crop: undefined })
        return false
      }
      own.add(id)
      return true
    }
    const kept = L.order.filter(keep)
    // Who joins: inside the box, this is their innermost section, in no layout yet.
    const joining = frames.filter((f) => !isSection(f) && !claimed.has(f.id) && joinable(f) && centerIn(f, s) && sectionOf(f, frames)?.id === s.id)
    if (kept.length !== L.order.length || joining.length) {
      let tree = L.mode === 'grid' && L.order.length ? treeFor(L) : undefined
      if (tree) {
        // Drop slots from the highest down, so the numbers still match while going.
        for (let slot = L.order.length - 1; slot >= 0; slot--) {
          if (own.has(L.order[slot])) continue
          tree = tree && detachLeaf(tree, slot)
          if (tree) tree = renumber(tree, slot)
        }
      }
      L = { ...L, order: kept, tree, shape: tree ? undefined : L.shape }
      for (const f of joining) {
        claimed.add(f.id)
        put(f.id, { natural: f.natural ?? { w: f.w, h: f.h }, fit: undefined })
        if (L.mode === 'grid' && L.tree) {
          const geo = computeLayout(s, L, (id) => byId.get(id))
          const big = [...geo.leaves].sort((a, b) => b.w * b.h - a.w * a.h)[0]
          L = { ...L, tree: splitLeaf(L.tree!, big.slot, L.order.length, big), order: [...L.order, f.id] }
        } else L = { ...L, order: [...L.order, f.id] }
      }
      // Rows set by hand belong to the old packing.
      if (L.mode === 'rows') L = { ...L, rowH: undefined }
      put(s.id, { layout: L })
    } else if (L.mode === 'grid' && L.order.length && !L.tree) {
      // A picked shape: keep its tree, so lines dragged from here on have something to move.
      L = { ...L, tree: treeFor(L) }
      put(s.id, { layout: L })
    }
    const look = (id: string) => {
      const f = byId.get(id)
      return f && patch.get(id)?.natural ? { ...f, ...patch.get(id) } : f
    }
    const geo = computeLayout(s, L, look)
    for (const [id, r] of geo.rects) {
      const f = byId.get(id)!
      const x = Math.round(r.x)
      const y = Math.round(r.y)
      const w = Math.round(r.w)
      const h = Math.round(r.h)
      if (f.x !== x || f.y !== y || f.w !== w || f.h !== h) put(id, { x, y, w, h })
    }
    if (L.mode !== 'grid') {
      const h = Math.round(geo.height + LAYOUT_PAD * 2)
      if (s.h !== h) put(s.id, { h })
    }
  }
  if (!patch.size) return frames
  return frames.map((f) => {
    const p = patch.get(f.id)
    return p ? { ...f, ...p } : f
  })
}

/** Frames that are new or have moved since `before`: the ones that may join a layout. */
export function movedSince(before: Frame[] | null) {
  if (!before) return () => false
  const was = new Map(before.map((f) => [f.id, f]))
  return (f: Frame) => {
    const p = was.get(f.id)
    return !p || p.x !== f.x || p.y !== f.y
  }
}

/** Block id → the layout section it's in. Cached per frames array. */
const members = new WeakMap<Frame[], Map<string, string>>()
export function layoutMembers(frames: Frame[]) {
  let m = members.get(frames)
  if (!m) {
    m = new Map()
    for (const f of frames) if (f.layout) for (const id of f.layout.order) m.set(id, f.id)
    members.set(frames, m)
  }
  return m
}
