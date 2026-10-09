import type { PointerEvent as RPE } from 'react'
import type { Frame, LayoutNode, SectionLayout } from '../../shared/types.ts'
import { isSection, sectionAt, sectionContents, withContents } from '../../shared/sections.ts'
import { growSections } from '../actions'
import { addToLayout, geoOf, morph, swapTiles, takeOut, tileSection } from '../arrange'
import { clamp, drag } from '../drag'
import { stackLayer } from './blocks'
import {
  computeLayout,
  detachLeaf,
  isLeaf,
  layoutMembers,
  minExtent,
  minLayoutSize,
  nodeAt,
  PUSH,
  settleLayouts,
  slotsOf,
  splitLeaf,
  treeFor,
  treeLeaves,
  type Geo,
  type Line,
  type Rect,
} from '../layout'
import { frameById, getState, mutateFrames, saveSoon, screenToWorld, setState, toast, updateFrame } from '../store'

const MIN = 24
/** A frame's draw offset outside Compare, and the marker for one Compare hides (compared by identity). */
export const NONE = { dx: 0, dy: 0 }
export const HIDDEN = { dx: 0, dy: 0 }
export const DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type Dir = (typeof DIRS)[number]
export const HANDLE_POS: Record<Dir, [number, number]> = {
  nw: [0, 0],
  n: [50, 0],
  ne: [100, 0],
  e: [100, 50],
  se: [100, 100],
  s: [50, 100],
  sw: [0, 100],
  w: [0, 50],
}

/**
 * Press on a frame: select it (Shift toggles) and drag the selection, sections with
 * everything in them. The section a block is dropped into lights up while it moves, and
 * grows to hold it if it sticks out.
 */
export function pressFrame(e: RPE, id: string) {
  const s = getState()
  if (e.button !== 0 || s.space || s.hand) return
  e.stopPropagation()
  // ⌥-click reaches what's underneath: each one takes the next frame down at that spot.
  if (e.altKey && !e.shiftKey && !s.compare) id = frameBeneath(screenToWorld(e.clientX, e.clientY), s.selected) ?? id
  let sel = s.selected
  if (e.shiftKey) sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]
  else if (!sel.includes(id)) sel = [id]
  setState({ selected: sel, interact: s.interact === id ? id : null, renaming: null, crop: s.crop === id ? id : null })
  // Comparing is for looking: select, but don't move things around.
  if (s.compare) return
  const frames = s.board?.frames ?? []
  // One block in a layout: it trades places, or leaves when dropped outside.
  if (sel.length === 1 && sel[0] === id && layoutMembers(frames).has(id)) return dragTile(e, id)
  const moving = withContents(sel, frames)
  const starts = new Map(moving.map((m) => [m, frameById(m)!]).filter(([, f]) => f) as [string, Frame][])
  const skip = new Set(moving)
  // Where the dragged group's center lands decides its section.
  const all = [...starts.values()]
  const cx = all.length ? (Math.min(...all.map((f) => f.x)) + Math.max(...all.map((f) => f.x + f.w))) / 2 : 0
  const cy = all.length ? (Math.min(...all.map((f) => f.y)) + Math.max(...all.map((f) => f.y + f.h))) / 2 : 0
  const z = s.camera.z
  drag(
    e,
    (dx, dy, ev) => {
      mutateFrames(
        (fs) =>
          fs.map((f) => {
            const st = starts.get(f.id)
            return st ? { ...f, x: Math.round(st.x + dx / z), y: Math.round(st.y + dy / z) } : f
          }),
        false,
      )
      const drop = sectionAt(cx + dx / z, cy + dy / z, getState().board?.frames ?? [], skip)?.id ?? null
      if (drop !== getState().dropSection) setState({ dropSection: drop })
      // One block over a layout: the block it would share a spot with.
      const tile = drop && moving.length === 1 ? tileUnder(drop, screenToWorld(ev.clientX, ev.clientY), id) : null
      if (tile !== getState().dropTile) setState({ dropTile: tile })
    },
    (moved) => {
      if (!moved) return
      const { dropSection, dropTile } = getState()
      setState({ dropSection: null, dropTile: null })
      const into = dropSection ? frameById(dropSection) : undefined
      if (into?.layout && moving.length === 1 && !isSection(frameById(id)!)) addToLayout(into.id, [id], dropTile)
      liftSections(moving)
      // Blocks dropped in a layout join it; ones dragged out of one leave it.
      mutateFrames((fs) => fs)
      growSections(moving)
      saveSoon()
    },
  )
}

/** Under a point, the frame below the selected one (top to bottom, round again), or below the top one. */
function frameBeneath(p: { x: number; y: number }, selected: string[]) {
  const frames = getState().board?.frames ?? []
  const stack = frames
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => !isSection(f) && p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h)
    .sort((a, b) => stackLayer(b.f, false, false) - stackLayer(a.f, false, false) || b.i - a.i)
    .map(({ f }) => f.id)
  if (stack.length < 2) return null
  const at = selected.length === 1 ? stack.indexOf(selected[0]) : -1
  return stack[(Math.max(at, 0) + 1) % stack.length]
}

/** The block of a layout section under a point, if any. */
function tileUnder(sid: string, p: { x: number; y: number }, skip?: string) {
  const s = frameById(sid)
  if (!s?.layout) return null
  for (const [tid, r] of geoOf(s).rects) if (tid !== skip && p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) return tid
  return null
}

const inside = (p: { x: number; y: number }, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h

/** Layouts hold blocks: a section dropped into one moves to just below it, with what's in it. */
function liftSections(moved: string[]) {
  const frames = getState().board?.frames ?? []
  for (const id of moved) {
    const m = frameById(id)
    if (!m || !isSection(m)) continue
    const host = frames.find((s) => s.layout && s.id !== m.id && !moved.includes(s.id) && inside({ x: m.x + m.w / 2, y: m.y + m.h / 2 }, s))
    if (!host) continue
    const dy = host.y + host.h + 64 - m.y
    const group = new Set([m.id, ...sectionContents(m, frames).map((f) => f.id)])
    mutateFrames((fs) => fs.map((f) => (group.has(f.id) ? { ...f, y: f.y + dy } : f)), false)
    toast('Layouts hold blocks, not sections')
  }
}

/**
 * Drag a block that's in a layout: drop it on another block to trade places, anywhere
 * inside its section to put it back, or outside to take it out (into another layout if
 * dropped on one).
 */
function dragTile(e: RPE, id: string) {
  const f0 = frameById(id)!
  const home = tileSection(id)!
  const z = getState().camera.z
  let at = { x: 0, y: 0 }
  drag(
    e,
    (dx, dy, ev) => {
      updateFrame(id, { x: Math.round(f0.x + dx / z), y: Math.round(f0.y + dy / z) }, false)
      at = screenToWorld(ev.clientX, ev.clientY)
      const over = inside(at, home) ? home.id : (sectionAt(at.x, at.y, getState().board?.frames ?? [], new Set([id]))?.id ?? null)
      const tile = over ? tileUnder(over, at, id) : null
      const drop = over === home.id ? null : over
      if (tile !== getState().dropTile || drop !== getState().dropSection) setState({ dropTile: tile, dropSection: drop })
    },
    (moved) => {
      if (!moved) return
      const { dropTile, dropSection } = getState()
      setState({ dropTile: null, dropSection: null })
      morph()
      if (inside(at, home)) {
        if (dropTile) swapTiles(id, dropTile)
        else mutateFrames((fs) => fs) // back to its spot
        return
      }
      takeOut(id, at)
      const into = dropSection ? frameById(dropSection) : undefined
      if (into?.layout) addToLayout(into.id, [id], dropTile)
      else growSections([id])
    },
  )
}

// ── resizing inside a layout ──

type LineTarget = { kind: 'line'; path: number[]; i: number; axis: 'x' | 'y'; sa: number; sb: number; W: number; minA: number; minB: number }
type OuterTarget = { kind: 'outer'; side: 'l' | 'r' | 't' | 'b' }
type Target = LineTarget | OuterTarget
type Split = Exclude<LayoutNode, { slot: number }>

const samePath = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i])

function lineTarget(tree: LayoutNode, l: Line, gap: number): LineTarget {
  const node = nodeAt(tree, l.path) as Split
  const a = node.kids[l.i - 1]
  const b = node.kids[l.i]
  return { kind: 'line', path: l.path, i: l.i, axis: l.axis, sa: l.sa, sb: l.sb, W: a.w + b.w, minA: minExtent(a.n, l.axis, gap), minB: minExtent(b.n, l.axis, gap) }
}

/** The line a block's edge sits on (the nearest split on that side), or the section's own edge. */
function edgeTarget(tree: LayoutNode, geo: Geo, trail: number[], side: 'l' | 'r' | 't' | 'b', gap: number): Target {
  const want = side === 'l' || side === 'r' ? 'row' : 'col'
  for (let d = trail.length - 1; d >= 0; d--) {
    const path = trail.slice(0, d)
    const node = nodeAt(tree, path) as Split
    const i = trail[d]
    if (node.dir !== want) continue
    const at = side === 'r' || side === 'b' ? (i < node.kids.length - 1 ? i + 1 : -1) : i > 0 ? i : -1
    if (at < 0) continue
    const l = geo.lines.find((x) => samePath(x.path, path) && x.i === at)
    if (l) return lineTarget(tree, l, gap)
  }
  return { kind: 'outer', side }
}

/** In a group of blocks pushed against a line: the one beside the line, level with the pointer. */
function nearestLeaf(n: LayoutNode, geo: Geo, axis: 'x' | 'y', after: boolean, p: { x: number; y: number }) {
  const slots = new Set(slotsOf(n))
  const ls = geo.leaves.filter((l) => slots.has(l.slot))
  const edge = (l: Rect) => (axis === 'x' ? (after ? l.x : l.x + l.w) : after ? l.y : l.y + l.h)
  const best = after ? Math.min(...ls.map(edge)) : Math.max(...ls.map(edge))
  const beside = ls.filter((l) => Math.abs(edge(l) - best) < 1)
  const level = beside.find((l) => (axis === 'x' ? p.y >= l.y && p.y <= l.y + l.h : p.x >= l.x && p.x <= l.x + l.w))
  return (level ?? beside[0]).slot
}

/**
 * Move lines of a grid (and the section's edges). Past a block's smallest size it turns
 * dashed; further and it moves to the biggest other spot, which ends the drag.
 */
function dragGrid(e: RPE, s0: Frame, sides: ('l' | 'r' | 't' | 'b')[] | null, line: Line | null, keep?: string) {
  e.stopPropagation()
  const L0 = s0.layout!
  const z = getState().camera.z
  const geo = computeLayout(s0, L0, frameById)
  const tree0 = treeFor(L0)!
  const leaf = keep ? geo.leafOf.get(keep) : undefined
  const targets: Target[] = line ? [lineTarget(tree0, line, L0.gap)] : sides!.map((side) => edgeTarget(tree0, geo, leaf!.trail, side, L0.gap))
  const keepSlot = keep ? L0.order.indexOf(keep) : -1
  let done = false
  drag(
    e,
    (sdx, sdy, ev) => {
      if (done) return
      const p = screenToWorld(ev.clientX, ev.clientY)
      const tree = structuredClone(tree0)
      const box = { x: s0.x, y: s0.y, w: s0.w, h: s0.h }
      let pushing: { slot: number; over: number } | null = null
      for (const t of targets) {
        const d = (t.kind === 'line' ? t.axis : t.side === 'l' || t.side === 'r' ? 'x' : 'y') === 'x' ? sdx / z : sdy / z
        if (t.kind === 'outer') {
          if (t.side === 'r') box.w = Math.max(200, s0.w + d)
          if (t.side === 'l') (box.w = Math.max(200, s0.w - d)), (box.x = s0.x + s0.w - box.w)
          if (t.side === 'b') box.h = Math.max(160, s0.h + d)
          if (t.side === 't') (box.h = Math.max(160, s0.h - d)), (box.y = s0.y + s0.h - box.h)
          continue
        }
        const node = nodeAt(tree, t.path) as Split
        let na = t.sa + d
        const maxA = t.sa + t.sb - t.minB
        let squeezed: LayoutNode | null = null
        let over = 0
        let after = true
        if (na > maxA) (over = na - maxA), (squeezed = node.kids[t.i].n), (na = maxA)
        if (na < t.minA) (over = t.minA - na), (squeezed = node.kids[t.i - 1].n), (na = t.minA), (after = false)
        node.kids[t.i - 1].w = (t.W * na) / (t.sa + t.sb)
        node.kids[t.i].w = t.W - node.kids[t.i - 1].w
        if (squeezed) {
          const slot = isLeaf(squeezed) ? squeezed.slot : nearestLeaf(squeezed, geo, t.axis, after, p)
          if (slot !== keepSlot && over > 6 && (!pushing || over > pushing.over)) pushing = { slot, over }
        }
      }
      let L: SectionLayout = { ...L0, tree, shape: undefined }
      if (pushing && pushing.over > PUSH) {
        // It leaves for the biggest other spot.
        const rest = detachLeaf(tree, pushing.slot)!
        const leaves = treeLeaves(rest, box, L0.gap)
        const big = leaves.filter((l) => l.slot !== keepSlot).sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? leaves[0]
        L = { ...L, tree: splitLeaf(rest, big.slot, pushing.slot, big) }
        done = true
        morph()
        toast(`Made room · ${frameById(L0.order[pushing.slot])?.label || 'block'} moved`)
        pushing = null
      }
      const tile = pushing ? L0.order[pushing.slot] : null
      if (tile !== getState().dropTile) setState({ dropTile: tile })
      mutateFrames((fs) => settleLayouts(fs.map((f) => (f.id === s0.id ? { ...f, ...box, layout: L } : f))), false)
    },
    (moved) => {
      setState({ dropTile: null })
      if (moved) saveSoon()
    },
  )
}

/** A line between blocks in a grid section. */
export const dragLine = (e: RPE, s: Frame, line: Line) => dragGrid(e, s, null, line)

/**
 * A block's own handles inside a layout. Grid: its edges move the lines beside it (or the
 * section's edge). Columns: a side sets how many columns it spans. Rows: the bottom edge
 * sets that row's height.
 */
export function resizeTile(e: RPE, f: Frame, dir: Dir) {
  const s = tileSection(f.id)
  if (!s?.layout) return
  const L = s.layout
  const sides = [...dir].map((c) => ({ n: 't', s: 'b', e: 'r', w: 'l' })[c] as 'l' | 'r' | 't' | 'b')
  if (L.mode === 'grid') return dragGrid(e, s, sides, null, f.id)
  e.stopPropagation()
  const z = getState().camera.z
  const geo = geoOf(s)
  const r = geo.rects.get(f.id)!
  drag(
    e,
    (dx, dy) => {
      let next: SectionLayout = L
      if (L.mode === 'columns' && (dir === 'e' || dir === 'w')) {
        const w = r.w + (dir === 'e' ? dx : -dx) / z
        const span = clamp(Math.round((w + L.gap) / (geo.colW! + L.gap)), 1, geo.cols!)
        if (span === (L.span?.[f.id] ?? 1)) return
        next = { ...L, span: { ...L.span, [f.id]: span } }
        morph()
      } else if (L.mode === 'rows' && dir === 's') {
        const ri = geo.rowOf!.get(f.id)!
        const rowH = [...(L.rowH ?? [])]
        rowH[ri] = clamp(geo.rows![ri].h + dy / z, 60, geo.rows![ri].max)
        next = { ...L, rowH }
      } else return
      mutateFrames((fs) => settleLayouts(fs.map((x) => (x.id === s.id ? { ...x, layout: next } : x))), false)
    },
    (moved) => moved && saveSoon(),
  )
}

/** Drag inside a block being cropped: move the image in its box. */
export function panCrop(e: RPE, f: Frame) {
  e.stopPropagation()
  const z = getState().camera.z
  const c0 = f.crop ?? { x: 0, y: 0, s: 1 }
  // How far the covering image reaches past the box, per side.
  const a = (f.natural ? f.natural.w / f.natural.h : f.w / f.h) || 1
  const cover = { w: Math.max(f.w, f.h * a) * c0.s, h: Math.max(f.h, f.w / a) * c0.s }
  const ox = Math.max(40, cover.w - f.w)
  const oy = Math.max(40, cover.h - f.h)
  drag(
    e,
    (dx, dy) =>
      updateFrame(f.id, { crop: { ...c0, x: clamp(c0.x - dx / z / ox, -0.5, 0.5), y: clamp(c0.y - dy / z / oy, -0.5, 0.5) } }, false),
    (moved) => moved && saveSoon(),
    1,
  )
}

export function resizeFrame(e: RPE, f0: Frame, dir: Dir) {
  e.stopPropagation()
  const z = getState().camera.z
  const ratio = f0.w / f0.h
  // A layout section stops at the size its blocks can shrink to.
  const min = f0.layout ? minLayoutSize(f0.layout) : { w: MIN, h: MIN }
  drag(
    e,
    (sdx, sdy, ev) => {
      const dx = sdx / z
      const dy = sdy / z
      let l = f0.x
      let t = f0.y
      let r = f0.x + f0.w
      let b = f0.y + f0.h
      if (dir.includes('w')) l += dx
      if (dir.includes('e')) r += dx
      if (dir.includes('n')) t += dy
      if (dir.includes('s')) b += dy
      if (ev.altKey) {
        if (dir.includes('w')) r -= dx
        if (dir.includes('e')) l -= dx
        if (dir.includes('n')) b -= dy
        if (dir.includes('s')) t -= dy
      }
      let w = Math.max(min.w, r - l)
      let h = Math.max(min.h, b - t)
      if (ev.shiftKey) {
        if (dir.length === 2) {
          if (w / h > ratio) w = h * ratio
          else h = w / ratio
        } else if (dir === 'e' || dir === 'w') h = w / ratio
        else w = h * ratio
      }
      let x = dir.includes('w') ? r - w : l
      let y = dir.includes('n') ? b - h : t
      if (ev.altKey) {
        x = f0.x + f0.w / 2 - w / 2
        y = f0.y + f0.h / 2 - h / 2
      } else if (ev.shiftKey && dir.length === 1) {
        if (dir === 'e' || dir === 'w') y = f0.y + (f0.h - h) / 2
        else x = f0.x + (f0.w - w) / 2
      }
      // A hand resize becomes the frame's own size again (and a block still waiting to size itself won't now).
      const patch = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), natural: undefined, fit: undefined }
      // A layout section's blocks follow as it resizes.
      if (f0.layout) mutateFrames((fs) => settleLayouts(fs.map((f) => (f.id === f0.id ? { ...f, ...patch } : f))), false)
      else updateFrame(f0.id, patch, false)
    },
    (moved) => moved && saveSoon(),
  )
}
