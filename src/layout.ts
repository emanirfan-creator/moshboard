import type { Frame } from '../shared/types.ts'

// Arranging a selection: bento (unit grid with spans, packed densely, gaps filled),
// masonry (equal columns, aspect kept, shortest column first) and rows (packed rows,
// sizes untouched). Text frames act as section headers in every layout.

export type LayoutKind = 'bento' | 'masonry' | 'rows'
export type Rect = { x: number; y: number; w: number; h: number }

const GAP = 24
const HEADER_GAP = 16

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

/** Reading order: visual rows (by vertical overlap), then left to right. */
export function readingOrder(frames: Frame[]) {
  const byY = [...frames].sort((a, b) => a.y - b.y)
  const rows: Frame[][] = []
  for (const f of byY) {
    const row = rows[rows.length - 1]
    const mid = f.y + f.h / 2
    if (row && row.some((r) => mid > r.y && mid < r.y + r.h)) row.push(f)
    else rows.push([f])
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x))
}

/** Split into sections: a text frame starts a new section and is its header. */
function sections(ordered: Frame[]) {
  const out: { header?: Frame; items: Frame[] }[] = [{ items: [] }]
  for (const f of ordered) {
    if (f.type === 'text') out.push({ header: f, items: [] })
    else out[out.length - 1].items.push(f)
  }
  return out.filter((s) => s.header || s.items.length)
}

/** Shared column grid for the whole selection, so every section lines up. */
function grid(frames: Frame[]) {
  const media = frames.filter((f) => f.type !== 'text')
  return Math.min(360, Math.max(200, median(media.map((f) => Math.sqrt(f.w * f.h))) * 0.75))
}

// ── bento ──────────────────────────────────────────────
// Bento grid rules: square cells, a small set of tile sizes, size = importance
// (1–2 hero tiles at 2×2 / 3×2, utility tiles at 2×1 / 1×2, micro tiles 1×1),
// and the tiles fill one clean rectangle with even gutters. Media is cropped to
// its tile (object-fit: cover), which is what makes a bento read as one piece.

type Span = [number, number]

function bentoCols(count: number) {
  return count <= 2 ? 2 : count <= 5 ? 3 : 4
}

function tileFor(f: Frame, hero: boolean, cols: number, wideHero: boolean): Span {
  const a = f.w / f.h
  if (f.type === 'palette') return [Math.min(cols, Math.max(2, Math.round((f.colors?.length ?? 5) / 2))), 1]
  if (hero) return wideHero && a > 1.25 && cols >= 4 ? [3, 2] : [2, 2]
  const media = f.type === 'code' || f.type === 'url'
  if (a > 1.6 || (media && a >= 1)) return [2, 1]
  if (a < 0.62 || (media && a < 1)) return [1, 2]
  return [1, 1]
}

interface Packing {
  place: Map<string, { r: number; c: number; cw: number; ch: number }>
  rows: number
  cols: number
}

/** Pack one configuration and close its holes; returns the tile grid. */
function packBento(items: Frame[], cols: number, heroCount: number, wideHero: boolean): Packing {
  // Heroes: the largest frames by area.
  const heroes = new Set(
    [...items]
      .filter((f) => f.type !== 'palette')
      .sort((a, b) => b.w * b.h - a.w * a.h)
      .slice(0, heroCount)
      .map((f) => f.id),
  )
  // Heroes go in first (top-left reads as most important), then reading order.
  const ordered = [...items.filter((f) => heroes.has(f.id)), ...items.filter((f) => !heroes.has(f.id))]

  const occ: (string | null)[][] = []
  const row = (r: number) => (occ[r] ??= Array(cols).fill(null))
  const free = (r: number, c: number, cw: number, ch: number) => {
    if (c + cw > cols) return false
    for (let dr = 0; dr < ch; dr++) for (let dc = 0; dc < cw; dc++) if (row(r + dr)[c + dc]) return false
    return true
  }
  const fill = (id: string, r: number, c: number, cw: number, ch: number) => {
    for (let dr = 0; dr < ch; dr++) for (let dc = 0; dc < cw; dc++) row(r + dr)[c + dc] = id
  }
  const place = new Map<string, { r: number; c: number; cw: number; ch: number }>()

  for (const f of ordered) {
    const [cw, ch] = tileFor(f, heroes.has(f.id), cols, wideHero)
    for (let r = 0; ; r++) {
      const c = Array.from({ length: cols }, (_, i) => i).find((i) => free(r, i, cw, ch))
      if (c !== undefined) {
        fill(f.id, r, c, cw, ch)
        place.set(f.id, { r, c, cw, ch })
        break
      }
    }
  }

  // Close every hole so the grid is one clean rectangle: grow a neighbor into the
  // empty cell (left neighbor rightward, or the one above downward), keeping tiles
  // rectangular. Repeat until nothing changes.
  const rows = occ.length
  for (let changed = true; changed; ) {
    changed = false
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (row(r)[c]) continue
        const left = c > 0 ? place.get(row(r)[c - 1] ?? '') : undefined
        const up = r > 0 ? place.get(row(r - 1)[c] ?? '') : undefined
        const tryGrowRight = (p?: { r: number; c: number; cw: number; ch: number }) =>
          p && p.c + p.cw === c && Array.from({ length: p.ch }, (_, d) => p.r + d < rows && !row(p.r + d)[c]).every(Boolean)
        const tryGrowDown = (p?: { r: number; c: number; cw: number; ch: number }) =>
          p && p.r + p.ch === r && Array.from({ length: p.cw }, (_, d) => !row(r)[p.c + d]).every(Boolean)
        if (tryGrowRight(left)) {
          for (let d = 0; d < left!.ch; d++) row(left!.r + d)[c] = row(r)[c - 1]
          left!.cw++
          changed = true
        } else if (tryGrowDown(up)) {
          for (let d = 0; d < up!.cw; d++) row(r)[up!.c + d] = row(r - 1)[c]
          up!.ch++
          changed = true
        }
      }
    }
  }

  return { place, rows, cols }
}

/** How far tiles stray from each frame's own shape, plus a nudge toward a 3:2 block. */
function bentoCost(items: Frame[], p: Packing) {
  let cost = 0
  for (const f of items) {
    const t = p.place.get(f.id)!
    cost += Math.abs(Math.log((t.cw + (t.cw - 1) * 0.1) / (t.ch + (t.ch - 1) * 0.1) / (f.w / f.h)))
  }
  return cost + Math.abs(Math.log(p.cols / p.rows / 1.5)) * 0.5
}

function bentoSection(items: Frame[], maxCols: number, width: number, x0: number, y0: number) {
  // Try the valid shapes of bento for this group and keep the one that closes into
  // a rectangle while distorting frames the least.
  let best: Packing | null = null
  let bestCost = Infinity
  const colOptions = [...new Set([Math.max(2, maxCols - 1), maxCols])]
  for (const cols of colOptions) {
    for (let heroes = 0; heroes <= Math.min(2, items.length >= 8 ? 2 : items.length >= 3 ? 1 : 0); heroes++) {
      for (const wide of [true, false]) {
        const p = packBento(items, cols, heroes, wide)
        // Hierarchy matters: prefer having a hero once there are a few frames.
        const cost = bentoCost(items, p) + (items.length >= 3 && heroes === 0 ? 0.6 : 0)
        if (cost < bestCost) {
          bestCost = cost
          best = p
        }
      }
    }
  }
  const { place, rows, cols } = best!
  const unit = (width - (cols - 1) * GAP) / cols
  const out = new Map<string, Rect>()
  for (const [id, p] of place) {
    out.set(id, {
      x: x0 + p.c * (unit + GAP),
      y: y0 + p.r * (unit + GAP),
      w: p.cw * unit + (p.cw - 1) * GAP,
      h: p.ch * unit + (p.ch - 1) * GAP,
    })
  }
  return { rects: out, height: rows ? rows * (unit + GAP) - GAP : 0 }
}

// ── masonry ────────────────────────────────────────────

function masonrySection(items: Frame[], cols: number, colW: number, x0: number, y0: number) {
  const heights = Array(cols).fill(0)
  const out = new Map<string, Rect>()
  for (const f of items) {
    // Span as many columns as its own width suggests; exact aspect for everything.
    const span = Math.max(1, Math.min(cols, Math.round((f.w + GAP) / (colW + GAP))))
    const w = span * colW + (span - 1) * GAP
    const h = Math.round((f.h / f.w) * w)
    // Lowest place where `span` neighboring columns are free.
    let c = 0
    let top = Infinity
    for (let i = 0; i + span <= cols; i++) {
      const t = Math.max(...heights.slice(i, i + span))
      if (t < top) {
        top = t
        c = i
      }
    }
    out.set(f.id, { x: x0 + c * (colW + GAP), y: y0 + top, w, h })
    for (let i = c; i < c + span; i++) heights[i] = top + h + GAP
  }
  return { rects: out, height: Math.max(0, ...heights) - GAP }
}

// ── rows ───────────────────────────────────────────────

function rowsSection(items: Frame[], targetW: number, x0: number, y0: number) {
  const out = new Map<string, Rect>()
  let x = x0
  let y = y0
  let rowH = 0
  for (const f of items) {
    if (x > x0 && x + f.w > x0 + targetW) {
      x = x0
      y += rowH + GAP
      rowH = 0
    }
    out.set(f.id, { x, y, w: f.w, h: f.h })
    x += f.w + GAP
    rowH = Math.max(rowH, f.h)
  }
  return { rects: out, height: y - y0 + rowH }
}

/** New rectangles for every frame in the selection. */
export function arrange(frames: Frame[], kind: LayoutKind): Map<string, Rect> {
  const ordered = readingOrder(frames)
  const x0 = Math.min(...frames.map((f) => f.x))
  let y = Math.min(...frames.map((f) => f.y))
  const unit = grid(frames)
  const media = ordered.filter((f) => f.type !== 'text')
  const area = media.reduce((n, f) => n + f.w * f.h, 0)
  // Columns: enough for a roughly 3:2 block, at least what the widest item needs.
  const cols = Math.max(2, Math.min(8, Math.round(Math.sqrt(area * 1.5) / (unit + GAP)) || 3))
  const width = cols * unit + (cols - 1) * GAP
  const out = new Map<string, Rect>()

  for (const s of sections(ordered)) {
    if (s.header) {
      out.set(s.header.id, { x: x0, y, w: Math.min(width, Math.max(s.header.w, 320)), h: s.header.h })
      y += s.header.h + HEADER_GAP
    }
    if (!s.items.length) continue
    const bc = bentoCols(media.length)
    const r =
      kind === 'bento'
        ? bentoSection(s.items, bc, width, x0, y)
        : kind === 'masonry'
          ? masonrySection(s.items, Math.max(2, Math.min(cols, 5)), Math.round((width - (Math.max(2, Math.min(cols, 5)) - 1) * GAP) / Math.max(2, Math.min(cols, 5))), x0, y)
          : rowsSection(s.items, Math.max(width, Math.max(...s.items.map((f) => f.w))), x0, y)
    r.rects.forEach((v, k) => out.set(k, v))
    y += r.height + GAP * 2
  }
  for (const v of out.values()) {
    v.x = Math.round(v.x)
    v.y = Math.round(v.y)
    v.w = Math.round(v.w)
    v.h = Math.round(v.h)
  }
  return out
}
