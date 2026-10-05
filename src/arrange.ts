import type { Frame, SectionLayout } from '../shared/types.ts'
import { isSection, sectionContents, sectionOf } from '../shared/sections.ts'
import {
  computeLayout,
  currentOption,
  detachLeaf,
  evenTree,
  isLeaf,
  LAYOUT_GAP,
  LAYOUT_PAD,
  layoutMembers,
  optionsFor,
  shapeHeight,
  shapesFor,
  nodeAt,
  slotsOf,
  splitLeaf,
  trailTo,
  treeFor,
  withOption,
  type Geo,
  type LayoutMode,
  type Rect,
} from './layout'
import { growSections, newId } from './actions'
import { frameById, getState, INSPECTOR_W, mutateFrames, setCamera, setState, toast, updateFrame, viewLeft } from './store'
import { cue } from './ui/sound'

// Arranging blocks: a layout is a kind of section. Picking a shape for loose blocks puts
// them in a new section with that layout; picking one for a section lays out what's in it.

/** The layout section a block is in, if any. */
export function tileSection(id: string): Frame | undefined {
  const frames = getState().board?.frames
  const sid = frames && layoutMembers(frames).get(id)
  return sid ? frameById(sid) : undefined
}
export const isTile = (id: string) => !!tileSection(id)

/** Where a layout section's blocks go right now. */
export const geoOf = (s: Frame, L: SectionLayout = s.layout!): Geo => computeLayout(s, L, frameById)

/** Blocks glide to their new places for a moment (layout changes, not drags). */
let morphTimer: ReturnType<typeof setTimeout> | undefined
export function morph() {
  const el = document.querySelector<HTMLElement>('.canvas')
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  el.dataset.morph = ''
  clearTimeout(morphTimer)
  morphTimer = setTimeout(() => delete el.dataset.morph, 520)
}

// ── last used ──
const LAST_KEY = 'mb:arrange'
export function lastArrange(): { mode: LayoutMode; option: number } {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? '')
    if (v && ['grid', 'columns', 'rows'].includes(v.mode) && typeof v.option === 'number') return v
  } catch {
    // nothing stored
  }
  return { mode: 'grid', option: 0 }
}
function remember(mode: LayoutMode, option: number) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ mode, option }))
  } catch {
    // storage unavailable
  }
}

/** Top to bottom in visual rows, then left to right. */
export function readingOrder(frames: Frame[]) {
  const byY = [...frames].sort((a, b) => a.y - b.y)
  const rows: Frame[][] = []
  for (const f of byY) {
    const r = rows[rows.length - 1]
    const mid = f.y + f.h / 2
    if (r && r.some((q) => mid > q.y && mid < q.y + q.h)) r.push(f)
    else rows.push([f])
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x)).map((f) => f.id)
}

// ── what can be arranged ──

/** Loose blocks in the selection, or why they can't be arranged together. */
export function arrangeable(ids = getState().selected): { frames: Frame[]; why?: string } {
  const frames = ids.map(frameById).filter((f): f is Frame => !!f)
  if (frames.some(isSection)) return { frames: [], why: 'Select a section on its own to arrange what’s in it.' }
  if (frames.some((f) => isTile(f.id))) return { frames: [], why: 'These are already in a layout. Select their section to change it.' }
  return { frames }
}

/** A plain section's own blocks, or why it can't take a layout. */
function sectionBlocks(s: Frame): { frames: Frame[]; why?: string } {
  const all = getState().board?.frames ?? []
  const inner = sectionContents(s, all).filter((f) => sectionOf(f, all)?.id === s.id)
  if (inner.some(isSection)) return { frames: [], why: 'Layouts hold blocks, not sections. Move the inner sections out first.' }
  return { frames: inner }
}

/** The section box and layout a choice would give, without changing anything. */
function plan(target: string | null, mode: LayoutMode, option: number): { box: Rect; L: SectionLayout; members: Frame[] } | null {
  if (target) {
    const s = frameById(target)
    if (!s || !isSection(s)) return null
    const blocks = s.layout ? { frames: s.layout.order.map(frameById).filter((f): f is Frame => !!f) } : sectionBlocks(s)
    if (blocks.why) return null
    const order = s.layout ? s.layout.order : readingOrder(blocks.frames)
    const L = withOption({ mode, order, gap: s.layout?.gap ?? LAYOUT_GAP }, mode, option)
    // Never narrower than a layout can sit in (a section may have been made tiny).
    const w = Math.max(s.w, 320)
    const width = w - LAYOUT_PAD * 2
    const box = { x: s.x, y: s.y, w, h: mode === 'grid' ? shapeHeight(order.length, option, width) + LAYOUT_PAD * 2 : s.h }
    return { box, L, members: blocks.frames }
  }
  const { frames, why } = arrangeable()
  if (why || frames.length < 2) return null
  const n = frames.length
  const width = n <= 2 ? 560 : n <= 4 ? 720 : 880
  const x0 = Math.min(...frames.map((f) => f.x))
  const y0 = Math.min(...frames.map((f) => f.y))
  const order = readingOrder(frames)
  const L = withOption({ mode, order, gap: LAYOUT_GAP }, mode, option)
  const box = { x: x0 - LAYOUT_PAD, y: y0 - LAYOUT_PAD, w: width + LAYOUT_PAD * 2, h: mode === 'grid' ? shapeHeight(n, option, width) + LAYOUT_PAD * 2 : 400 }
  // Not over other blocks (a section takes in whatever sits inside it): the nearest clear spot.
  return { box: clearSpot(box, frames), L, members: frames }
}

/**
 * The nearest place for a new section's box where it covers no other block or section, so it
 * doesn't take in blocks that weren't picked. The blocks being arranged, and sections around
 * them, don't count. Columns and rows grow downward, so their box is checked a little taller.
 */
function clearSpot(box: Rect, picked: Frame[]): Rect {
  const ids = new Set(picked.map((f) => f.id))
  const all = getState().board?.frames ?? []
  const around = (s: Frame) => isSection(s) && picked.every((f) => f.x >= s.x && f.y >= s.y && f.x + f.w <= s.x + s.w && f.y + f.h <= s.y + s.h)
  const others = all.filter((f) => !ids.has(f.id) && !around(f) && !(isSection(f) && f.layout && f.layout.order.some((id) => ids.has(id))))
  const M = 32
  const clear = (x: number, y: number) =>
    !others.some((f) => x - M < f.x + f.w && x + box.w + M > f.x && y - M < f.y + f.h && y + box.h + M > f.y)
  const STEP = 64
  for (let r = 0; r <= 80; r++) {
    const ring: [number, number][] = []
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (Math.max(Math.abs(i), Math.abs(j)) === r) ring.push([i * STEP, j * STEP])
    ring.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))
    for (const [dx, dy] of ring) if (clear(box.x + dx, box.y + dy)) return { ...box, x: box.x + dx, y: box.y + dy }
  }
  return box
}

/** Glide the view so a box is on screen, if it isn't. */
function bringIntoView(r: Rect) {
  const c = getState().camera
  const left = viewLeft() + 24
  const right = window.innerWidth - INSPECTOR_W - 24
  const sx0 = r.x * c.z + c.x
  const sy0 = r.y * c.z + c.y
  const sx1 = sx0 + r.w * c.z
  const sy1 = sy0 + r.h * c.z
  let dx = 0
  let dy = 0
  if (sx1 > right) dx = right - sx1
  if (sx0 + dx < left) dx = left - sx0
  if (sy1 > window.innerHeight - 96) dy = window.innerHeight - 96 - sy1
  if (sy0 + dy < 64) dy = 64 - sy0
  if (dx || dy) setCamera({ ...c, x: c.x + dx, y: c.y + dy })
}

/** Where each block would go for a plan (columns and rows also settle the section's height). */
function placed(p: { box: Rect; L: SectionLayout; members: Frame[] }) {
  const geo = computeLayout(p.box, p.L, frameById)
  const box = p.L.mode === 'grid' ? p.box : { ...p.box, h: Math.round(geo.height + LAYOUT_PAD * 2) }
  return { geo, box }
}

/** Hovering a choice: show where blocks would go. */
export function previewArrange(target: string | null, mode: LayoutMode, option: number) {
  const p = plan(target, mode, option)
  if (!p) return
  const { geo, box } = placed(p)
  const rects: Record<string, Rect> = {}
  for (const [id, r] of geo.rects) rects[id] = r
  morph()
  setState({ arrange: { rects, section: box, id: target } })
  bringIntoView(box)
}
export function clearArrangePreview() {
  if (!getState().arrange) return
  morph()
  setState({ arrange: null })
}

/** Apply a layout choice: to a section, or to the loose blocks selected (a new section). */
export function arrange(target: string | null, mode: LayoutMode, option: number) {
  const p = plan(target, mode, option)
  if (!p) {
    const why = target ? (frameById(target)?.layout ? null : sectionBlocks(frameById(target)!).why) : arrangeable().why
    return toast(why ?? 'Select two or more blocks to arrange')
  }
  const { geo, box } = placed(p)
  remember(mode, option)
  morph()
  setState({ arrange: null })
  const sid = target ?? newId()
  const L: SectionLayout = { ...p.L, tree: mode === 'grid' ? treeFor(p.L) : undefined }
  mutateFrames((fs) => {
    const next = fs.map((f) => {
      if (f.id === sid) return { ...f, ...box, layout: L }
      const r = geo.rects.get(f.id)
      if (!r) return f
      return { ...f, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), natural: f.natural ?? { w: f.w, h: f.h }, fit: undefined }
    })
    // A new section goes first: sections paint behind what's in them.
    return target ? next : [{ id: sid, type: 'section', ...box, layout: L } as Frame, ...next]
  })
  growSections([sid])
  if (!target) setState({ selected: [sid] })
  bringIntoView(box)
  cue('paste')
}

/** ⌃⌥T: arrange the selection the way you last did, or step a layout section to its next choice. */
export function arrangeAgain() {
  const sel = getState().selected
  const one = sel.length === 1 ? frameById(sel[0]) : undefined
  const s = one && (isSection(one) ? one : tileSection(one.id))
  if (s?.layout) {
    const opts = optionsFor(s.layout.mode, s.layout.order.length)
    const cur = opts.indexOf(currentOption(s.layout) ?? -1)
    return arrange(s.id, s.layout.mode, opts[(cur + 1) % opts.length])
  }
  const { mode, option } = lastArrange()
  if (one && isSection(one)) return arrange(one.id, mode, mode === 'grid' ? 0 : option)
  arrange(null, mode, mode === 'grid' ? 0 : option)
}

/** Stop laying out: the section stays, its blocks stay where they are. */
export function freeLayout(id: string) {
  updateFrame(id, { layout: undefined })
  toast('Free layout · ⌘Z to undo')
}

export function setLayout(id: string, patch: Partial<SectionLayout>, save = true) {
  const s = frameById(id)
  if (!s?.layout) return
  updateFrame(id, { layout: { ...s.layout, ...patch } }, save)
}

/** Every split back to equal parts, keeping the shape. */
export function evenOut(id: string) {
  const s = frameById(id)
  if (!s?.layout) return
  morph()
  if (s.layout.mode === 'grid') {
    const t = treeFor(s.layout)
    setLayout(id, { tree: t && evenTree(t) })
  } else setLayout(id, { span: undefined, rowH: undefined })
}

/**
 * A grid's split as shares, for the side panel's split control: the top split of a section, or
 * the one a block sits in. Its parts are named for their blocks ("3 blocks" for a group).
 */
export function gridSplit(sid: string, blockId?: string) {
  const s = frameById(sid)
  const L = s?.layout
  if (!L || L.mode !== 'grid') return null
  const tree = treeFor(L)
  if (!tree || isLeaf(tree)) return null
  let path: number[] = []
  let mine: number | undefined
  if (blockId) {
    const trail = trailTo(tree, L.order.indexOf(blockId))
    if (!trail?.length) return null
    path = trail.slice(0, -1)
    mine = trail[trail.length - 1]
  }
  const node = nodeAt(tree, path)
  if (isLeaf(node)) return null
  const total = node.kids.reduce((a, k) => a + k.w, 0) || 1
  const name = (n: (typeof node.kids)[number]['n']) => {
    if (!isLeaf(n)) return `${slotsOf(n).length} blocks`
    const f = frameById(L.order[n.slot])
    const t = (f?.label || f?.type || 'Block').trim()
    return t.length > 14 ? `${t.slice(0, 13)}…` : t
  }
  // What it started as: the picked shape's own proportions (equal parts once reshaped by hand).
  const even = node.kids.map(() => 1 / node.kids.length)
  let original = even
  const shapes = shapesFor(L.order.length)
  const shape = L.shape !== undefined ? shapes[Math.min(L.shape, shapes.length - 1)]?.t : undefined
  try {
    const o = shape && nodeAt(shape, path)
    if (o && !isLeaf(o) && o.kids.length === node.kids.length) {
      const ot = o.kids.reduce((a, k) => a + k.w, 0) || 1
      original = o.kids.map((k) => k.w / ot)
    }
  } catch {
    // the shape has no split there
  }
  return {
    dir: node.dir,
    parts: node.kids.map((k) => name(k.n)),
    shares: node.kids.map((k) => k.w / total),
    original,
    mine,
    path,
  }
}

/** Set a grid split's parts to these shares (the side panel's split control). */
export function setGridSplit(sid: string, path: number[], shares: number[]) {
  const s = frameById(sid)
  const tree = s?.layout && treeFor(s.layout)
  if (!tree) return
  const next = structuredClone(tree)
  const node = nodeAt(next, path)
  if (isLeaf(node)) return
  const total = node.kids.reduce((a, k) => a + k.w, 0) || 1
  node.kids.forEach((k, i) => (k.w = (shares[i] ?? 0) * total))
  setLayout(sid, { tree: next })
}

// ── blocks in a layout ──

/** The block beside one in a direction: ones that overlap it first, then the nearest. */
function neighbor(geo: Geo, id: string, dir: 'left' | 'right' | 'up' | 'down') {
  const r = geo.rects.get(id)
  if (!r) return null
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  let best: string | null = null
  let bestD = Infinity
  for (const [o, q] of geo.rects) {
    if (o === id) continue
    const across = dir === 'left' || dir === 'right' ? q.y < r.y + r.h && q.y + q.h > r.y : q.x < r.x + r.w && q.x + q.w > r.x
    const gap =
      dir === 'right' ? q.x - (r.x + r.w) : dir === 'left' ? r.x - (q.x + q.w) : dir === 'down' ? q.y - (r.y + r.h) : r.y - (q.y + q.h)
    if (gap < -2) continue
    const d = (across ? 0 : 1e5) + gap * 10 + Math.hypot(q.x + q.w / 2 - cx, q.y + q.h / 2 - cy)
    if (d < bestD) {
      bestD = d
      best = o
    }
  }
  return best
}

export function swapTiles(a: string, b: string) {
  const s = tileSection(a)
  if (!s?.layout || tileSection(b)?.id !== s.id) return
  const order = [...s.layout.order]
  const i = order.indexOf(a)
  const j = order.indexOf(b)
  ;[order[i], order[j]] = [order[j], order[i]]
  morph()
  setLayout(s.id, { order, span: s.layout.span })
}

/** Arrow keys: the selected block trades places with its neighbor. False when it isn't in a layout. */
export function moveTile(dir: 'left' | 'right' | 'up' | 'down') {
  const sel = getState().selected
  if (sel.length !== 1) return false
  const s = tileSection(sel[0])
  if (!s) return false
  const n = neighbor(geoOf(s), sel[0], dir)
  if (n) swapTiles(sel[0], n)
  return true
}

/** The layout without a block: the blocks beside it close the gap. */
export function without(L: SectionLayout, id: string): SectionLayout {
  const slot = L.order.indexOf(id)
  if (slot < 0) return L
  const order = L.order.filter((x) => x !== id)
  const span = { ...L.span }
  delete span[id]
  if (L.mode !== 'grid') return { ...L, order, span, rowH: undefined }
  let tree = treeFor(L)
  tree = tree && detachLeaf(tree, slot)
  // Slots above the gone one move down one.
  const renum = (n: NonNullable<typeof tree>): NonNullable<typeof tree> =>
    'slot' in n ? (n.slot > slot ? { slot: n.slot - 1 } : n) : { dir: n.dir, kids: n.kids.map((k) => ({ n: renum(k.n), w: k.w })) }
  return { ...L, order, tree: tree && renum(tree), shape: undefined }
}

/** The layout with blocks added: each shares the spot of `onto` (or the biggest block). */
export function withAdded(s: Frame, L: SectionLayout, ids: string[], onto?: string | null): SectionLayout {
  for (const id of ids) {
    if (L.mode !== 'grid' || !L.order.length) {
      const at = onto ? L.order.indexOf(onto) : -1
      L = { ...L, order: at >= 0 ? [...L.order.slice(0, at), id, ...L.order.slice(at)] : [...L.order, id] }
      continue
    }
    const geo = computeLayout(s, L, frameById)
    const target = (onto && geo.leafOf.get(onto)) || [...geo.leaves].sort((a, b) => b.w * b.h - a.w * a.h)[0]
    L = { ...L, tree: splitLeaf(treeFor(L)!, target.slot, L.order.length, target), order: [...L.order, id], shape: undefined }
  }
  return L
}

/** Out of its layout, back at its own size: at a point, or beside the section. */
export function takeOut(id: string, at?: { x: number; y: number }) {
  const s = tileSection(id)
  const f = frameById(id)
  if (!s?.layout || !f) return
  const size = f.natural ?? { w: f.w, h: f.h }
  const pos = at ? { x: Math.round(at.x - size.w / 2), y: Math.round(at.y - 22) } : { x: s.x + s.w + 48, y: f.y }
  morph()
  mutateFrames((fs) =>
    fs.map((x) => (x.id === s.id ? { ...x, layout: without(s.layout!, id) } : x.id === id ? { ...x, ...pos, ...size, crop: undefined } : x)),
  )
  setState({ selected: [id], crop: null })
}

/** Blocks dropped into a layout section join it (one dropped on a block shares its spot). */
export function addToLayout(sid: string, ids: string[], onto?: string | null) {
  const s = frameById(sid)
  if (!s?.layout) return
  morph()
  const L = withAdded(s, s.layout, ids, onto)
  mutateFrames((fs) =>
    fs.map((f) => (f.id === sid ? { ...f, layout: L } : ids.includes(f.id) ? { ...f, natural: f.natural ?? { w: f.w, h: f.h }, fit: undefined } : f)),
  )
}

// ── crop (images and videos in a layout) ──

export const canCrop = (f?: Frame) => !!f && (f.type === 'image' || f.type === 'video') && isTile(f.id)
export function startCrop(id: string) {
  setState({ crop: getState().crop === id ? null : id, selected: [id], interact: null })
}
export function resetCrop(id: string) {
  updateFrame(id, { crop: undefined })
}
