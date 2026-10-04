import { applyParams, defaults, parseParams, type Bezier, type ParamValue } from '../shared/params.ts'
import { autoParams } from '../shared/autoParams.ts'
import { writeBack } from '../shared/detect-motion.ts'
import { easingBezier, isRuntimeName, saveRuntime } from '../shared/runtime-motion.ts'
import { detectProps, isPropName, PROP_PREFIX } from '../shared/props.ts'
import { detectFor, parseModules } from './tuning/detection'
import { cue, scanChirp, scanEmpty } from './ui/sound'
import type { Frame, FrameType, MotionCapture, VideoAnalysis } from '../shared/types.ts'
import { looksLikeInstall } from '../shared/install.ts'
import { isMediaLink } from '../shared/links.ts'
import { arrange, type LayoutKind } from './layout'
import { copyText } from './clipboard'
import { generatePalette, nameColor, paletteFromSamples, type PaletteColor } from '../shared/color.ts'
import { boardSamples, hasColors } from './boardColors'
import { DEFAULT_FONT, SWATCH_SIZE, swatchBox, swatchFont } from '../shared/fonts.ts'
import { api, mediaUrl } from './api'
import { boardLabel, boardsLabel, FOLDER_ONLY } from './folder/folder'
import { ensureDefaultExport } from './frames/sandbox'
import { buildSnippet, packageTypes, parseSnippet } from '../shared/snippet.ts'
import { videos } from './frames/registry'
import { BLOCK_HEAD, BLOCK_PAD } from './canvas/blocks'
import {
  flushSave,
  frameById,
  getState,
  mutateFrames,
  resetHistory,
  saveSoon,
  setCamera,
  setState,
  startJob,
  startPending,
  storedCamera,
  toast,
  updateFrame,
  viewLeft,
  viewportCenter,
} from './store'

export const newId = () => Math.random().toString(36).slice(2, 8)

/** Frame size for a block whose content is w×h: the content plus the block's header and padding. */
const blockBox = (w: number, h: number) => ({ w: Math.round(w + BLOCK_PAD * 2), h: Math.round(h + BLOCK_HEAD + BLOCK_PAD) })

// ── boards ──────────────────────────────────────────────

// Opening a canvas twice at once (React's dev double-mount, a hash change mid-load) shares one
// request. Reloads of the open canvas (an edit on disk) always fetch again.
const opening = new Map<string, Promise<void>>()
export function loadBoard(name: string): Promise<void> {
  const s = getState()
  if (s.boardName === name && s.board) return readBoard(name)
  let p = opening.get(name)
  if (!p) {
    p = readBoard(name).finally(() => opening.delete(name))
    opening.set(name, p)
  }
  return p
}

async function readBoard(name: string): Promise<void> {
  let board
  try {
    board = await api.board(name)
  } catch (e) {
    // A renamed canvas: follow it to its new address.
    const moved = (e as { moved?: string }).moved
    if (moved && moved !== name) return loadBoard(moved)
    // Deleted or unknown canvas (e.g. a stale tab): open the first one instead.
    const first = (await api.boards())[0]?.id ?? 'default'
    if (first !== name) return loadBoard(first)
    throw new Error(`Canvas ${name} not found`)
  }
  const sameBoardReload = getState().boardName === name && !!getState().board
  setState((s) => ({
    boardName: name,
    board,
    selected: s.boardName === name ? s.selected.filter((id) => board.frames.some((f) => f.id === id)) : [],
    interact: s.boardName === name ? s.interact : null,
    files: s.boardName === name ? s.files : {},
    overrides: s.boardName === name ? s.overrides : {},
  }))
  resetHistory(board.frames, getState().boardName === name && sameBoardReload)
  // Undo history starts fresh here, so files no block uses can't come back: they go to the canvas's trash.
  if (!sameBoardReload) api.sweep(name).catch(() => {})
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`)
  const cam = storedCamera(name)
  if (cam) setCamera(cam)
  else requestAnimationFrame(fitBoard)
  // Analysis files are small; load them so strips and exports have them.
  for (const f of board.frames) if (f.analysis) ensureFile(f.analysis)
  convertGifs(name)
}

/** Animated GIF image frames become video frames (once; still GIFs stay images). */
async function convertGifs(board: string) {
  const gifs = (getState().board?.frames ?? []).filter((f) => f.type === 'image' && f.src && /\.gif$/i.test(f.src))
  for (const f of gifs) {
    try {
      const { path } = await api.gifToVideo(board, f.src!)
      if (path && getState().boardName === board) updateFrame(f.id, { type: 'video', src: path })
    } catch {
      // leave it as an image
    }
  }
}

export async function loadFile(rel: string) {
  try {
    const text = await api.file(getState().boardName, rel)
    setState((s) => ({ files: { ...s.files, [rel]: text } }))
  } catch {
    setState((s) => ({ files: { ...s.files, [rel]: '' } }))
  }
}

// Loads a file once: skips it when it's already in the store or on its way.
const loading = new Set<string>()
export function ensureFile(rel: string) {
  if (rel in getState().files || loading.has(rel)) return
  loading.add(rel)
  loadFile(rel).finally(() => loading.delete(rel))
}

export async function refreshCanvases() {
  // Before a folder is connected (website) there are no canvases to list yet.
  if (FOLDER_ONLY && !getState().folder) return
  const canvases = await api.boards().catch(() => null)
  if (canvases) setState({ canvases })
}

export async function switchBoard(id: string) {
  setState({ add: null, palette: false })
  await loadBoard(id)
  refreshCanvases()
}

export async function createCanvas(name: string) {
  const { id } = await api.createBoard(name)
  await switchBoard(id)
  toast(`Created “${name.trim() || 'Untitled'}”`)
}

/** Adds the sample board (a reference measured, recreated and tuned) and opens it. */
export async function openSample() {
  try {
    const { id } = await api.addSample()
    await switchBoard(id)
  } catch (e) {
    toast(`Couldn’t add the sample: ${(e as Error).message}`, true)
  }
}

/** Copies a canvas (frames, code, uploads) and opens the copy. */
export async function duplicateCanvas(id: string) {
  if (id === getState().boardName) await flushSave()
  try {
    const copy = await api.duplicateBoard(id)
    await switchBoard(copy.id)
    toast(`Duplicated as “${copy.name}”`)
  } catch (e) {
    toast(`Couldn’t duplicate: ${(e as Error).message}`, true)
  }
}

/** Renames the open canvas. Its folder (and so its address) follows the name; the old address still opens it. */
export async function renameCanvas(name: string) {
  const { board, boardName } = getState()
  const title = name.trim()
  if (!board || !title || title === board.name) return
  await flushSave()
  try {
    const r = await api.renameBoard(boardName, title)
    if (r.id !== boardName) history.replaceState(null, '', `#${r.id}`)
    setState((s) => ({
      boardName: r.id,
      board: s.board && { ...s.board, name: title },
      canvases: s.canvases.map((c) => (c.id === boardName ? { ...c, id: r.id, name: title } : c)),
    }))
    // Settle the camera under the new address too.
    setCamera(getState().camera)
  } catch (e) {
    toast(`Couldn’t rename: ${(e as Error).message}`, true)
  }
}

export async function deleteCanvas(id: string) {
  const info = getState().canvases.find((c) => c.id === id)
  await api.deleteBoard(id)
  const rest = (await api.boards()).filter((c) => c.id !== id)
  setState({ canvases: rest })
  if (getState().boardName === id) {
    if (rest.length) await switchBoard(rest[0].id)
    else await createCanvas('Untitled')
  }
  toast(`Moved “${info?.name ?? id}” to ${boardsLabel()}/.trash`)
}

// ── frames ──────────────────────────────────────────────

const GAP = 32

/**
 * Nearest spot to the viewport center where a w×h frame overlaps nothing, panning to it
 * if it's off screen. `readable` (things you type into right away) also zooms in to 100%
 * when the view is zoomed too far out to read what you type.
 */
function freeSpot(w: number, h: number, readable = false) {
  const c = viewportCenter()
  const frames = getState().board?.frames ?? []
  const clear = (x: number, y: number) =>
    !frames.some((f) => x < f.x + f.w + GAP && x + w + GAP > f.x && y < f.y + f.h + GAP && y + h + GAP > f.y)
  // Rings of candidates around the center, closest first.
  for (let r = 0; r <= 60; r++) {
    const ring: [number, number][] = []
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++) if (Math.max(Math.abs(i), Math.abs(j)) === r) ring.push([i * GAP, j * GAP])
    ring.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))
    for (const [dx, dy] of ring) {
      const x = Math.round(c.x - w / 2 + dx)
      const y = Math.round(c.y - h / 2 + dy)
      if (!clear(x, y)) continue
      const cam = getState().camera
      const z = readable && cam.z < 0.6 ? 1 : cam.z
      const tl = { x: (viewLeft() - cam.x) / cam.z, y: -cam.y / cam.z }
      const br = { x: tl.x + (window.innerWidth - viewLeft()) / cam.z, y: tl.y + window.innerHeight / cam.z }
      if (z !== cam.z || x < tl.x || y < tl.y || x + w > br.x || y + h > br.y) {
        const sx = (viewLeft() + window.innerWidth) / 2
        setCamera({ x: sx - (x + w / 2) * z, y: window.innerHeight / 2 - (y + h / 2) * z, z })
      }
      return { x, y }
    }
  }
  return { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2) }
}

/** At a given point (a drop or paste), or else the nearest empty spot in view. */
function place(w: number, h: number, at?: { x: number; y: number }, readable = false) {
  const p = at ? { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2) } : freeSpot(w, h, readable)
  return { ...p, w: Math.round(w), h: Math.round(h) }
}

export function addFrame(f: Omit<Frame, 'id'> & { id?: string }) {
  const frame = { ...f, id: f.id ?? newId() } as Frame
  mutateFrames((fs) => [...fs, frame])
  setState({ selected: [frame.id], interact: null })
  return frame
}

export function addNote(at?: { x: number; y: number }, text = '') {
  const f = addFrame({ type: 'note', text, ...place(280, 64, at, true) })
  if (!text) setState({ interact: f.id })
  return f
}

/** Free text on the canvas, placed in edit mode. */
export function addText(at?: { x: number; y: number }, centered = true) {
  const p = at ? { x: Math.round(centered ? at.x - 160 : at.x), y: Math.round(at.y - 16) } : freeSpot(320, 36, true)
  const f = addFrame({ type: 'text', text: '', size: 24, ...p, w: 320, h: 36 })
  setState({ interact: f.id })
  return f
}

// ── arrange ──────────────────────────────────────────────

const LAYOUT_KEY = 'mb:layout'
export function lastLayout(): LayoutKind {
  try {
    const v = localStorage.getItem(LAYOUT_KEY)
    return v === 'masonry' || v === 'rows' ? v : 'bento'
  } catch {
    return 'bento'
  }
}

/**
 * Arrange the selection (see src/layout.ts): bento grid by default, or masonry /
 * rows. Text frames become section headers. One undo step (⌘Z).
 */
export function tidySelection(kind: LayoutKind = lastLayout()) {
  const frames = getState()
    .selected.map(frameById)
    .filter((f): f is Frame => !!f)
  if (frames.length < 2) return toast('Select two or more frames to tidy up')
  try {
    localStorage.setItem(LAYOUT_KEY, kind)
  } catch {
    // storage unavailable
  }
  // Lay out from each frame's own size (remembered the first time it's arranged), so
  // re-tidying is stable and Rows can restore original sizes.
  const natural = new Map(frames.map((f) => [f.id, f.natural ?? { w: f.w, h: f.h }]))
  const rects = arrange(
    frames.map((f) => ({ ...f, ...natural.get(f.id)! })),
    kind,
  )
  mutateFrames((fs) =>
    fs.map((f) => {
      const r = rects.get(f.id)
      if (!r) return f
      const nat = natural.get(f.id)!
      return { ...f, ...r, natural: nat }
    }),
  )
  toast(`Arranged as ${kind} · ⌘Z to undo`)
}

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

export function alignSelection(edge: AlignEdge) {
  const frames = getState()
    .selected.map(frameById)
    .filter((f): f is Frame => !!f)
  if (frames.length < 2) return
  const x0 = Math.min(...frames.map((f) => f.x))
  const x1 = Math.max(...frames.map((f) => f.x + f.w))
  const y0 = Math.min(...frames.map((f) => f.y))
  const y1 = Math.max(...frames.map((f) => f.y + f.h))
  const ids = new Set(frames.map((f) => f.id))
  mutateFrames((fs) =>
    fs.map((f) => {
      if (!ids.has(f.id)) return f
      switch (edge) {
        case 'left':
          return { ...f, x: x0 }
        case 'right':
          return { ...f, x: x1 - f.w }
        case 'hcenter':
          return { ...f, x: Math.round((x0 + x1) / 2 - f.w / 2) }
        case 'top':
          return { ...f, y: y0 }
        case 'bottom':
          return { ...f, y: y1 - f.h }
        case 'vcenter':
          return { ...f, y: Math.round((y0 + y1) / 2 - f.h / 2) }
      }
    }),
  )
}

/** Space the selection evenly along one axis, keeping the outer two in place. */
export function distributeSelection(axis: 'x' | 'y') {
  const frames = getState()
    .selected.map(frameById)
    .filter((f): f is Frame => !!f)
    .sort((a, b) => a[axis] - b[axis])
  if (frames.length < 3) return
  const size = axis === 'x' ? 'w' : 'h'
  const start = frames[0][axis]
  const end = frames[frames.length - 1][axis] + frames[frames.length - 1][size]
  const total = frames.reduce((n, f) => n + f[size], 0)
  const gap = (end - start - total) / (frames.length - 1)
  const pos = new Map<string, number>()
  let at = start
  for (const f of frames) {
    pos.set(f.id, Math.round(at))
    at += f[size] + gap
  }
  mutateFrames((fs) => fs.map((f) => (pos.has(f.id) ? { ...f, [axis]: pos.get(f.id)! } : f)))
}

// ── palettes ─────────────────────────────────────────────

/** Palette blocks size to their colors: one column width per color plus the block's padding. */
const PALETTE_COL = 140
export const paletteWidth = (n: number) => n * PALETTE_COL + 16

export function setPaletteColors(id: string, colors: PaletteColor[]) {
  updateFrame(id, { colors, w: paletteWidth(colors.length) })
}

/**
 * A new palette. Without given colors it's suggested from the board (or the
 * selected frames); a board with nothing to read from gets a harmony palette.
 */
export function addPalette(colors?: PaletteColor[], at?: { x: number; y: number }, label = 'Palette') {
  if (!colors) return void addSuggestedPalette(at, label)
  return addFrame({ type: 'palette', colors, label, ...place(paletteWidth(colors.length), 360, at) })
}

async function addSuggestedPalette(at: { x: number; y: number } | undefined, label: string) {
  const c = (await fromBoard([], 5)) ?? generatePalette([], 5)
  addFrame({ type: 'palette', colors: c, label, ...place(paletteWidth(c.length), 360, at) })
}

/** Each palette's recent Generate results, so generating again moves on to other combos. */
const generated = new Map<string, string[][]>()

/**
 * New colors around the locked ones, picked from the board when it has anything
 * to read colors from (a different combination each time), otherwise random harmony.
 */
export async function regeneratePalette(id = getState().selected[0]) {
  const f = frameById(id)
  if (f?.type !== 'palette') return
  const count = f.colors?.length || 5
  const recent = generated.get(f.id) ?? []
  const next = (await fromBoard(f.colors ?? [], count, f.id, recent)) ?? generatePalette(f.colors ?? [], count)
  generated.set(f.id, [next.map((c) => c.hex), ...recent].slice(0, 8))
  setPaletteColors(f.id, next)
  cue('sparkle')
}

/** New colors around the locked ones from a random harmony, ignoring the board. */
export function randomizePalette(id = getState().selected[0]) {
  const f = frameById(id)
  if (f?.type !== 'palette') return
  setPaletteColors(f.id, generatePalette(f.colors ?? [], f.colors?.length || 5))
  cue('droplet')
}

/**
 * A balanced palette from the selected images/videos/sites/swatches (and
 * palettes) if any are selected, otherwise from everything on the board.
 * Null when there's nothing to read colors from.
 */
async function fromBoard(current: PaletteColor[], count: number, exclude?: string, avoid: string[][] = []) {
  const { board, selected, boardName } = getState()
  const frames = (board?.frames ?? []).filter((f) => f.id !== exclude)
  const picked = frames.filter((f) => selected.includes(f.id) && hasColors(f, true))
  const sources = picked.length ? picked : frames.filter((f) => hasColors(f, false))
  if (!sources.length) return null
  const samples = await boardSamples(boardName, sources)
  return samples.length ? paletteFromSamples(samples, current, count, avoid) : null
}

/**
 * Selected palettes and/or swatches → one palette (left-to-right order, duplicate
 * colors dropped, up to 10), replacing them. One undo step.
 */
export function combineSwatches() {
  const sources = getState()
    .selected.map(frameById)
    .filter((f): f is Frame => !!f && ((f.type === 'swatch' && !!f.color) || (f.type === 'palette' && !!f.colors?.length)))
    .sort((a, b) => a.x - b.x || a.y - b.y)
  if (sources.length < 2) return toast('Select two or more palettes or swatches', true)
  const seen = new Set<string>()
  const all: PaletteColor[] = []
  for (const f of sources) {
    const cs = f.type === 'palette' ? f.colors! : [{ hex: f.color! }]
    for (const c of cs) {
      const hex = c.hex.toLowerCase()
      if (seen.has(hex)) continue
      seen.add(hex)
      all.push({ ...c, hex })
    }
  }
  const colors = all.slice(0, 10)
  const at = { x: sources[0].x, y: sources[0].y }
  const ids = new Set(sources.map((s) => s.id))
  mutateFrames((fs) => fs.filter((f) => !ids.has(f.id)))
  const palettes = sources.filter((f) => f.type === 'palette').length
  const p = addFrame({
    type: 'palette',
    label: palettes === 1 ? sources.find((f) => f.type === 'palette')!.label ?? 'Palette' : 'Palette',
    colors,
    x: at.x,
    y: at.y,
    w: paletteWidth(colors.length),
    h: 360,
  })
  toast(
    all.length > 10
      ? `Kept the first 10 colors (a palette’s limit)`
      : `Merged ${sources.length} into one palette · ⌘Z to undo`,
  )
  return p
}

/** A palette → one swatch per color, laid out in a row. */
export function splitPalette(id = getState().selected[0]) {
  const f = frameById(id)
  if (f?.type !== 'palette' || !f.colors?.length) return
  const made = f.colors.map((c, i) => ({
    id: newId(),
    type: 'swatch' as const,
    color: c.hex,
    label: nameColor(c.hex),
    x: f.x + i * 136,
    y: f.y,
    w: 120,
    h: 120,
  }))
  mutateFrames((fs) => [...fs.filter((x) => x.id !== f.id), ...made])
  setState({ selected: made.map((m) => m.id) })
}

export function addSwatch(kind: 'color' | 'font', at?: { x: number; y: number }) {
  if (kind === 'color') return addFrame({ type: 'swatch', color: '#d0d6e0', label: 'Color', ...place(120, 120, at) })
  const box = swatchBox(SWATCH_SIZE, DEFAULT_FONT.family)
  return addFrame({ type: 'swatch', ...swatchFont(DEFAULT_FONT), label: 'Body', ...place(box.w, box.h, at) })
}

/**
 * Add any link: media pages (a Cosmos element, Dribbble shot, direct .mp4…) are
 * downloaded and become a video/image block; anything else is a website block.
 */
export async function addLink(href: string, at?: { x: number; y: number }) {
  const url = /^https?:\/\//.test(href) ? href : `https://${href}`
  if (!isMediaLink(url)) return addUrl(url, at)
  const host = new URL(url).hostname.replace(/^www\./, '')
  // A placeholder where it will land, so the canvas shows it's coming (and you can keep working).
  const spot = place(blockBox(480, 300).w, blockBox(480, 300).h, at)
  at = { x: spot.x + spot.w / 2, y: spot.y + spot.h / 2 }
  const done = startPending({ ...spot, label: `Fetching from ${host}` })
  try {
    const m = await api.mediaLink(getState().boardName, url).finally(done)
    if (m.items && m.items.length > 1) return addPieces(m.items, m.title, m.source, host, at)
    const max = m.type === 'video' ? 480 : 360
    const w0 = m.width ?? 480
    const h0 = m.height ?? 300
    const k = Math.min(1, max / Math.max(w0, h0))
    const box = blockBox(w0 * k, h0 * k)
    const f = addFrame({ type: m.type, src: m.path, origin: m.source, label: m.title, ...place(box.w, box.h, at) })
    toast(`Added ${m.type} from ${host}`)
    cue('ready')
    return f
  } catch (e) {
    toast(`${(e as Error).message}. Added as a website.`, true)
    return addUrl(url, at)
  }
}

/** A project's pieces side by side at a shared height, centered on `at`, as one undo step. */
function addPieces(
  items: { path: string; type: 'video' | 'image'; width?: number; height?: number }[],
  title: string,
  source: string,
  host: string,
  at = viewportCenter(),
) {
  const H = 360
  const GAP = 24
  const sized = items.map((it) => ({ ...it, w: blockBox(H * ((it.width ?? 4) / (it.height ?? 3)), H).w }))
  let x = Math.round(at.x - (sized.reduce((n, it) => n + it.w, 0) + GAP * (sized.length - 1)) / 2)
  const frames = sized.map((it, i) => {
    const f = {
      id: newId(),
      type: it.type,
      src: it.path,
      origin: source,
      label: `${title} · ${i + 1}/${sized.length}`,
      x,
      y: Math.round(at.y - H / 2),
      w: it.w,
      h: blockBox(0, H).h,
    } as Frame
    x += it.w + GAP
    return f
  })
  mutateFrames((fs) => [...fs, ...frames])
  setState({ selected: frames.map((f) => f.id), interact: null })
  toast(`Added ${frames.length} pieces from ${host}`)
  cue('ready')
  return frames[0]
}

export function addUrl(href: string, at?: { x: number; y: number }) {
  const url = /^https?:\/\//.test(href) ? href : `https://${href}`
  let host = url
  try {
    host = new URL(url).host
  } catch {
    // keep raw
  }
  // The 1280px-wide page shown at half size, 16:10.
  const box = blockBox(624, 390)
  return addFrame({ type: 'url', src: url, label: host, viewport: 1280, ...place(box.w, box.h, at) })
}

const DEFAULT_TSX = `/* @param duration 420ms 80..1600 */
/* @param ease cubic-bezier(0.16, 1, 0.3, 1) */
/* @trigger mount */
/* @animates transform, opacity */
export default function Frame() {
  return (
    <div
      className="size-24 rounded-2xl bg-primary"
      style={{ animation: "enter var(--p-duration) var(--p-ease) both" }}
    >
      <style>{\`@keyframes enter { from { opacity: 0; transform: translateY(16px) scale(.96) } }\`}</style>
    </div>
  )
}
`

const DEFAULT_HTML = `<!-- @param duration 420ms 80..1600 -->
<!-- @param ease cubic-bezier(0.16, 1, 0.3, 1) -->
<div class="box"></div>
<style>
  .box { width: 96px; height: 96px; border-radius: 16px; background: #5e6ad2;
         animation: enter var(--p-duration) var(--p-ease) both; }
  @keyframes enter { from { opacity: 0; transform: translateY(16px) scale(.96) } }
</style>
`

export async function addCode(
  kind: 'tsx' | 'html',
  source?: string,
  opts: Partial<Frame> = {},
  modules?: Record<string, string>,
) {
  const id = opts.id ?? newId()
  const file = `frames/${id}.${kind}`
  if (modules && Object.keys(modules).length) {
    const rel = `frames/${id}.modules.json`
    const json = JSON.stringify(modules, null, 2)
    await api.writeFile(getState().boardName, rel, json)
    setState((s) => ({ files: { ...s.files, [rel]: json } }))
    opts = { ...opts, modules: rel }
  }
  const text = source ?? (kind === 'tsx' ? DEFAULT_TSX : DEFAULT_HTML)
  const snippet = kind === 'tsx' ? parseSnippet(text) : null
  // A README snippet: its props become controls, typed from the package when it publishes types.
  const body = snippet ? buildSnippet(snippet, await packageTypes(snippet).catch(() => ({}))) : kind === 'tsx' ? ensureDefaultExport(text) : text
  await api.writeFile(getState().boardName, file, body)
  setState((s) => ({ files: { ...s.files, [file]: body } }))
  // `fit`: sized to what it renders once it first loads (see CodeFrame).
  return addFrame({ type: 'code', file, label: opts.label ?? 'Component', fit: opts.w === undefined, ...place(420, 300), ...opts, id })
}

export const looksLikeCode = (t: string) =>
  /(^|\n)\s*(import|export)\s/.test(t) || /className=|=>\s*[({<]|<\/\w+>/.test(t) || /^\s*<[a-z!]/i.test(t)

/** Fetch a component from a shadcn-style registry ("npx shadcn@latest add …") and add it. */
export async function addFromRegistry(input: string) {
  const spot = place(520, 420)
  const done = startPending({ ...spot, label: 'Fetching component' })
  try {
    const r = await api.registry(input).finally(done)
    const f = await addCode('tsx', r.entry, { label: r.title, ...spot }, r.modules)
    const n = Object.keys(r.modules).length
    toast(`Added ${r.title}${n ? ` with ${n} supporting file${n > 1 ? 's' : ''}` : ''}`)
    cue('ready')
    return f
  } catch (e) {
    toast(`Couldn’t add it: ${(e as Error).message}`, true)
  }
}

/**
 * Fetch a registry component into an existing frame, in place:
 * - frame holds the install command itself → it becomes the component;
 * - frame holds code that imports missing `@/…` files (e.g. a pasted demo) → keep that
 *   code and add the fetched files (the component and everything it imports).
 */
export async function fetchIntoFrame(id: string, input: string) {
  const f = frameById(id)
  if (!f?.file) return
  const done = startJob(id, 'Fetching component')
  try {
    // Read the block's code from disk if it hasn't been loaded yet (off-screen blocks):
    // never mistake "not loaded" for "empty" and overwrite someone's code.
    const current = getState().files[f.file] ?? (await api.file(getState().boardName, f.file).catch(() => null))
    if (current === null) throw new Error('could not read this block’s code')
    // The block's own code goes along so its imports get resolved too.
    const r = await api.registry(input, looksLikeInstall(current) ? '' : current)
    const b = getState().boardName
    const replace = !current.trim() || looksLikeInstall(current)
    const existing = f.modules ? JSON.parse(getState().files[f.modules] || '{}') : {}
    const modules: Record<string, string> = replace ? r.modules : { ...existing, ...r.modules, [r.entrySpec]: r.entry }
    const modulesRel = `frames/${id}.modules.json`
    const json = JSON.stringify(modules, null, 2)
    if (replace) await api.writeFile(b, f.file, r.entry)
    if (Object.keys(modules).length) await api.writeFile(b, modulesRel, json)
    setState((s) => ({
      files: { ...s.files, ...(replace ? { [f.file!]: r.entry } : {}), [modulesRel]: json },
      errors: Object.fromEntries(Object.entries(s.errors).filter(([k]) => k !== id)),
    }))
    updateFrame(id, {
      label: replace ? r.title : f.label,
      modules: Object.keys(modules).length ? modulesRel : undefined,
    })
    replay([id])
    const n = Object.keys(r.modules).length + (replace ? 0 : 1)
    toast(replace ? `Fetched ${r.title}` : `Added ${n} missing file${n === 1 ? '' : 's'} · your code is unchanged`)
    cue('ready')
  } catch (e) {
    toast(`Couldn’t fetch it: ${(e as Error).message}`, true)
  } finally {
    done()
  }
}

/** Selected code frame that's waiting for missing files, if any. */
function brokenSelection() {
  const s = getState()
  const f = s.selected.length === 1 ? frameById(s.selected[0]) : undefined
  return f?.type === 'code' && s.errors[f.id] ? f : undefined
}

export async function pasteText(text: string, at?: { x: number; y: number }) {
  const t = text.trim()
  if (!t) return
  if (looksLikeInstall(t)) {
    // Pasting an install command while a broken component is selected fixes that one.
    const broken = brokenSelection()
    return broken ? fetchIntoFrame(broken.id, t) : addFromRegistry(t)
  }
  if (/^https?:\/\/\S+$/.test(t)) return addLink(t, at)
  if (looksLikeCode(t)) {
    const kind = /(^|\n)\s*(import|export)\s|className=/.test(t) || !/^\s*</.test(t) ? 'tsx' : 'html'
    const name = /export\s+(?:default\s+)?(?:function|const)\s+([A-Z]\w*)/.exec(t)?.[1]
    const f = await addCode(kind, t, { label: name ?? 'Pasted component' })
    toast(`Added ${kind === 'tsx' ? 'React' : 'HTML'} component`)
    cue('paste')
    return f
  }
  cue('paste')
  return addNote(at, t)
}

function mediaSize(file: File, kind: 'image' | 'video'): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const done = (w: number, h: number) => {
      URL.revokeObjectURL(url)
      const max = kind === 'video' ? 480 : 360
      const s = Math.min(1, max / Math.max(w, h || 1))
      resolve({ w: w * s || 320, h: h * s || 240 })
    }
    if (kind === 'image') {
      const img = new Image()
      img.onload = () => done(img.naturalWidth, img.naturalHeight)
      img.onerror = () => done(320, 240)
      img.src = url
    } else {
      const v = document.createElement('video')
      v.onloadedmetadata = () => done(v.videoWidth, v.videoHeight)
      v.onerror = () => done(480, 270)
      v.src = url
    }
  })
}

export async function uploadFiles(files: File[], at = viewportCenter()) {
  let offset = 0
  for (const file of files) {
    const type: FrameType | null = file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('video/')
        ? 'video'
        : null
    if (!type) {
      if (/\.(tsx|jsx|html?)$/i.test(file.name)) {
        const kind = /\.html?$/i.test(file.name) ? 'html' : 'tsx'
        await addCode(kind, await file.text(), { label: file.name.replace(/\.\w+$/, '') })
      } else toast(`Skipped ${file.name}: unsupported type`, true)
      continue
    }
    const media = await mediaSize(file, type as 'image' | 'video')
    const size = blockBox(media.w, media.h)
    // Big clips take a moment to copy in: show where they'll land meanwhile.
    const done = startPending({ ...place(size.w, size.h, { x: at.x + offset, y: at.y + offset }), label: `Adding ${file.name}` })
    const up = await api.upload(getState().boardName, file).finally(done)
    const path = up.path
    addFrame({
      type: up.type ?? type,
      src: path,
      label: file.name.replace(/\.\w+$/, ''),
      ...place(size.w, size.h, { x: at.x + offset, y: at.y + offset }),
    })
    offset += 32
  }
  if (offset) cue('paste')
}

export function deleteSelected() {
  if (removeSelection()) cue('remove')
}

/** Removes the selected frames (and their code files). False when nothing was selected. */
function removeSelection() {
  const { selected, board } = getState()
  if (!selected.length || !board) return false
  mutateFrames((fs) =>
    fs.filter((f) => !selected.includes(f.id)).map((f) => (f.link && selected.includes(f.link) ? { ...f, link: undefined } : f)),
  )
  setState({ selected: [], interact: null })
  // Its files stay on disk so undo can bring it back whole; the canvas's next open clears them out (server/sweep.ts).
  return true
}

export async function duplicateSelected() {
  for (const id of getState().selected) {
    const f = frameById(id)
    if (!f) continue
    const { id: _old, ...rest } = f
    if (f.type === 'code' && f.file) {
      const kind = f.file.endsWith('.html') ? 'html' : 'tsx'
      const raw = f.modules ? getState().files[f.modules] : undefined
      const modules = raw ? (JSON.parse(raw) as Record<string, string>) : undefined
      await addCode(
        kind,
        getState().files[f.file],
        { ...rest, modules: undefined, x: f.x + 32, y: f.y + 32, label: `${f.label ?? 'Component'} copy` },
        modules,
      )
    } else addFrame({ ...rest, x: f.x + 32, y: f.y + 32 })
  }
}

// ── copy / paste frames ──────────────────────────────────

interface Clip {
  board: string
  frames: Frame[]
  /** code frame sources and module bundles, by file path */
  files: Record<string, string>
}
const CLIP_MARK = 'moodboard/frames:'
let clip: Clip | null = null
let pasteCount = 0

/** ⌘C / ⌘X: copy the selection (internal + system clipboard, so it also pastes in another tab). */
export async function copySelection(cut = false) {
  const s = getState()
  const frames = s.selected.map(frameById).filter((f): f is Frame => !!f)
  if (!frames.length) return
  const files: Record<string, string> = {}
  for (const f of frames) {
    for (const rel of [f.file, f.modules]) {
      if (!rel) continue
      files[rel] = s.files[rel] ?? (await api.file(s.boardName, rel).catch(() => ''))
    }
  }
  clip = { board: s.boardName, frames, files }
  pasteCount = 0
  // The in-app copy works even when the system clipboard refuses, so it sounds either way.
  copyText(CLIP_MARK + JSON.stringify(clip)).then((ok) => ok || cue('copy'), () => cue('copy'))
  if (cut) removeSelection()
  toast(`${cut ? 'Cut' : 'Copied'} ${frames.length} frame${frames.length > 1 ? 's' : ''} · ⌘V to paste`)
}

/** Parse frames copied by Moshboard out of clipboard text, if that's what it is. */
export function readClip(text: string): Clip | null {
  if (!text.startsWith(CLIP_MARK)) return null
  try {
    return JSON.parse(text.slice(CLIP_MARK.length)) as Clip
  } catch {
    return null
  }
}

/** ⌘V: paste copied frames. Each paste steps further out so copies don't stack exactly. */
export async function pasteFrames(from: Clip | null = clip) {
  if (!from?.frames.length) return
  if (from !== clip) {
    clip = from
    pasteCount = 0
  }
  pasteCount++
  const s = getState()
  const fs = from.frames
  const x0 = Math.min(...fs.map((f) => f.x))
  const y0 = Math.min(...fs.map((f) => f.y))
  const x1 = Math.max(...fs.map((f) => f.x + f.w))
  const y1 = Math.max(...fs.map((f) => f.y + f.h))
  // Next to the originals if they're on screen, otherwise centered in view.
  const { x: cx, y: cy } = viewportCenter()
  const { z } = s.camera
  const visible =
    from.board === s.boardName && Math.abs((x0 + x1) / 2 - cx) * z < window.innerWidth / 2 && Math.abs((y0 + y1) / 2 - cy) * z < window.innerHeight / 2
  const dx = visible ? 32 * pasteCount : Math.round(cx - (x0 + x1) / 2) + 24 * (pasteCount - 1)
  const dy = visible ? 32 * pasteCount : Math.round(cy - (y0 + y1) / 2) + 24 * (pasteCount - 1)

  const ids = new Map(fs.map((f) => [f.id, newId()]))
  const made: string[] = []
  for (const f of fs) {
    const id = ids.get(f.id)!
    // Links inside the copied group follow it; links to frames outside stay if the target is here.
    const link = f.link ? (ids.get(f.link) ?? (frameById(f.link) ? f.link : undefined)) : undefined
    let src = f.src
    if (src && from.board !== s.boardName && (f.type === 'image' || f.type === 'video')) {
      src = (await api.copyAsset(s.boardName, from.board, src).catch(() => ({ path: src! }))).path
    }
    const base = { ...f, id, link, src, x: f.x + dx, y: f.y + dy, analysis: from.board === s.boardName ? f.analysis : undefined }
    if (f.type === 'code' && f.file) {
      const kind = f.file.endsWith('.html') ? 'html' : 'tsx'
      const modules = f.modules && from.files[f.modules] ? (JSON.parse(from.files[f.modules]) as Record<string, string>) : undefined
      const { file: _f, modules: _m, ...rest } = base
      await addCode(kind, from.files[f.file] ?? '', rest, modules)
    } else {
      addFrame(base)
    }
    made.push(id)
  }
  setState({ selected: made, interact: null })
  cue('paste')
}

// ── linking & replay ────────────────────────────────────

// A link is a group: one reference, with any number of copies and notes pointing at it.

/** The reference a frame's link group hangs off (the frame itself when it is the reference or unlinked). */
export const linkRoot = (f: Frame) => (f.link && frameById(f.link) ? f.link : f.id)

/** Whether a frame is in a link group: it points at a reference, or something points at it. */
export const isLinked = (f: Frame) => !!f.link || linkTargets(getState().board?.frames ?? []).has(f.id)

// Ids something links to, rebuilt only when the frames array changes.
const targets = new WeakMap<Frame[], Set<string>>()
function linkTargets(frames: Frame[]) {
  let t = targets.get(frames)
  if (!t) targets.set(frames, (t = new Set(frames.flatMap((f) => (f.link ? [f.link] : [])))))
  return t
}

/** Everything in the same link group as these frames, including them. */
export function linkGroup(ids: string[]) {
  const roots = new Set(ids.map(frameById).filter((f): f is Frame => !!f).map(linkRoot))
  const set = new Set(ids)
  for (const f of getState().board?.frames ?? []) if (roots.has(f.id) || (f.link && roots.has(f.link))) set.add(f.id)
  return set
}

/** Selected frames that aren't all in one group already can be linked (or added to a group). */
export function canLinkSelected() {
  const sel = getState().selected.map(frameById).filter((f): f is Frame => !!f)
  return sel.length >= 2 && new Set(sel.map(linkRoot)).size > 1
}

/**
 * Link the selected frames into one group. If any of them is already linked,
 * the others join that group (keeping its reference); otherwise the reference is
 * the first selected frame that isn't a code copy or a note. Groups that meet
 * are merged, so everything points straight at one reference.
 */
export function linkSelected() {
  const sel = getState().selected.map(frameById).filter((f): f is Frame => !!f)
  if (sel.length < 2) return toast('Select a reference and its copies or notes', true)
  const grouped = sel.find(isLinked)
  const root = frameById(grouped ? linkRoot(grouped) : (sel.find((f) => f.type !== 'code' && f.type !== 'note') ?? sel[0]).id)!
  const members = linkGroup(sel.map((f) => f.id))
  mutateFrames((fs) =>
    fs.map((f) => {
      if (!members.has(f.id)) return f
      if (f.id === root.id) return f.link ? { ...f, link: undefined } : f
      return f.link === root.id ? f : { ...f, link: root.id }
    }),
  )
  toast(`${grouped ? 'Added to' : 'Linked to'} ${root.label ?? root.type} · ${members.size} linked`)
}

/**
 * A selected copy or note leaves its group; a selected reference releases
 * everything linked to it.
 */
export function unlinkSelected() {
  const ids = new Set(getState().selected)
  mutateFrames((fs) => fs.map((f) => (f.link && (ids.has(f.id) || ids.has(f.link)) ? { ...f, link: undefined } : f)))
  toast('Unlinked · ⌘Z to undo')
}

/** Replay selected frames together with everything they're linked to. */
export function replay(ids = getState().selected) {
  const set = linkGroup(ids)
  setState((s) => {
    const replay = { ...s.replay }
    for (const id of set) replay[id] = (replay[id] ?? 0) + 1
    return { replay }
  })
  for (const id of set) {
    const v = videos.get(id)
    if (!v) continue
    const f = frameById(id)
    v.currentTime = f?.segment?.in ?? 0
    v.play().catch(() => {})
  }
}

// ── params ──────────────────────────────────────────────

export function setParam(id: string, name: string, value: ParamValue) {
  setState((s) => ({ overrides: { ...s.overrides, [id]: { ...s.overrides[id], [name]: value } } }))
}

/** One control back to where it started (drops its unsaved tweak). */
export function resetParam(id: string, name: string) {
  setState((s) => {
    const mine = { ...s.overrides[id] }
    delete mine[name]
    const overrides = { ...s.overrides }
    if (Object.keys(mine).length) overrides[id] = mine
    else delete overrides[id]
    return { overrides }
  })
}

/** Name a control in the side panel; an empty name goes back to the one read from the code. */
export function renameParam(id: string, name: string, label: string) {
  const f = frameById(id)
  if (!f) return
  const labels = { ...f.labels }
  if (label) labels[name] = label
  else delete labels[name]
  updateFrame(id, { labels: Object.keys(labels).length ? labels : undefined })
}

/**
 * Timing measured on the reference a copy is linked to: a video's analysis, or a site's
 * captured transition. Shown on the copy's controls so tuning can aim at it.
 */
export function referenceTiming(f: Frame): { duration?: number; ease?: Bezier } | null {
  const ref = f.link ? frameById(f.link) : undefined
  if (!ref?.analysis) return null
  if (ref.type === 'video') {
    const p = readAnalysis(ref)?.primary
    return p ? { duration: p.durationMs, ease: p.ease.bezier } : null
  }
  if (ref.type === 'url') {
    try {
      const c = parseFile<MotionCapture>(ref.analysis)
      if (!c) return null
      const t = c.transitions.find((x) => parseFloat(x.duration) > 0)
      if (t) {
        const ms = parseFloat(t.duration) * (t.duration.trim().endsWith('ms') ? 1 : 1000)
        return { duration: ms, ease: easingBezier(t.timingFunction.split(',')[0]) ?? undefined }
      }
      const a = c.animations.find((x) => x.duration > 0)
      return a ? { duration: a.duration, ease: easingBezier(a.easing) ?? undefined } : null
    } catch {
      return null
    }
  }
  return null
}

export function resetParams(id = getState().selected[0]) {
  setState((s) => {
    const overrides = { ...s.overrides }
    delete overrides[id]
    return { overrides }
  })
}

/** Read a frame file from disk if it isn't loaded yet; never treat "not loaded" as empty. */
async function ensureLoaded(rel: string): Promise<string> {
  const have = getState().files[rel]
  if (have !== undefined) return have
  const text = await api.file(getState().boardName, rel)
  setState((s) => ({ files: { ...s.files, [rel]: text } }))
  return text
}

export async function lockParams(id = getState().selected[0]) {
  const f = frameById(id)
  const s = getState()
  if (!f?.file || !s.overrides[id]) return toast('Nothing to lock')
  let src: string
  let modulesRaw: string | undefined
  try {
    src = await ensureLoaded(f.file)
    modulesRaw = f.modules ? await ensureLoaded(f.modules) : undefined
  } catch {
    return toast('Couldn’t read the file. Nothing was saved', true)
  }
  const all = getState().overrides[id] ?? {}
  // Measured values (from a library or stylesheet) have no literal to write back: they're saved on the frame.
  const measured = Object.fromEntries(Object.entries(all).filter(([k]) => isRuntimeName(k)))
  // Values for the component's own props aren't in the code either: they're saved on the frame.
  const propValues = Object.entries(all).filter(([k]) => isPropName(k))
  const tuned = Object.fromEntries(Object.entries(all).filter(([k]) => !isRuntimeName(k) && !isPropName(k)))
  if (Object.keys(measured).length) {
    updateFrame(id, { runtime: saveRuntime(f.runtime, measured, getState().motion[id]) })
  }
  if (propValues.length) {
    const defs = detectProps(src, parseModules(modulesRaw))
    const props = { ...f.props }
    for (const [k, v] of propValues) {
      const name = k.slice(PROP_PREFIX.length)
      // Back to the component's own default: nothing to keep.
      if (JSON.stringify(v) === JSON.stringify(defs.find((d) => d.name === name)?.value)) delete props[name]
      else props[name] = v
    }
    updateFrame(id, { props: Object.keys(props).length ? props : undefined })
  }

  // Explicit @param annotations first, then detected values in their original literals.
  const params = parseParams(src)
  const explicit = Object.fromEntries(Object.entries(tuned).filter(([k]) => params.some((p) => p.name === k)))
  const detection = detectFor(f, src, modulesRaw)
  const detected = Object.fromEntries(Object.entries(tuned).filter(([k]) => detection.params.some((p) => p.name === k)))
  const modules = parseModules(modulesRaw)
  const written = writeBack(detection, { main: src, modules }, detected)
  const main = Object.keys(explicit).length ? applyParams(written.main, params, { ...defaults(params), ...explicit }) : written.main

  const b = s.boardName
  const files: Record<string, string> = {}
  if (main !== src) {
    await api.writeFile(b, f.file, main)
    files[f.file] = main
  }
  const moduleChanged = Object.keys(written.modules).some((k) => written.modules[k] !== modules[k])
  if (f.modules && moduleChanged) {
    const json = JSON.stringify(written.modules, null, 2)
    await api.writeFile(b, f.modules, json)
    files[f.modules] = json
  }
  setState((st) => {
    const overrides = { ...st.overrides }
    delete overrides[id]
    return { files: { ...st.files, ...files }, overrides }
  })
  // A linked copy that's been saved has been tuned: its reference moves on to the last step.
  if (f.link && !frameById(id)?.tuned) updateFrame(id, { tuned: true })
  const where = [
    main !== src && f.file.split('/').pop(),
    moduleChanged && 'its component files',
    (Object.keys(measured).length || propValues.length) && 'this canvas',
  ].filter(Boolean)
  toast(where.length ? `Saved to ${where.join(' and ')}` : 'Saved to code')
}

/**
 * Re-read a component's files and look for motion values again. The inspector's
 * fallback when nothing showed up on its own.
 */
export async function detectMotionValues(id = getState().selected[0]) {
  const f = frameById(id)
  if (!f?.file) return toast('Select a component', true)
  const b = getState().boardName
  try {
    const src = await api.file(b, f.file)
    const mods = f.modules ? await api.file(b, f.modules) : undefined
    setState((s) => ({ files: { ...s.files, [f.file!]: src, ...(f.modules ? { [f.modules]: mods! } : {}) } }))
    const d = detectFor(f, src, mods)
    const n = d.params.length
    if (n) scanChirp(d.groups.length)
    else scanEmpty()
    toast(
      n
        ? `Found ${n} motion value${n > 1 ? 's' : ''} in ${d.groups.length} animation${d.groups.length > 1 ? 's' : ''}`
        : 'No motion values found. Try Add controls to code',
      !n,
    )
  } catch {
    toast('Couldn’t read this component’s files', true)
  }
}

/** Add live controls to a code frame that has none (pasted before auto-detection, or edited by hand). */
export async function makeTunable(id = getState().selected[0]) {
  const f = frameById(id)
  if (!f?.file || !f.file.endsWith('.tsx')) return toast('Select a React code frame', true)
  const s = getState()
  let src: string
  try {
    src = await ensureLoaded(f.file)
  } catch {
    return toast('Couldn’t read the code from disk', true)
  }
  const r = autoParams(src)
  if (!r) return toast('No tunable values found. Try /recreate', true)
  await api.writeFile(s.boardName, f.file, r.source)
  setState((st) => ({ files: { ...st.files, [f.file!]: r.source } }))
  toast(`Added ${r.names.length} control${r.names.length > 1 ? 's' : ''}: ${r.names.join(', ')}`)
}

/**
 * A component that only renders inside its library's setup (a provider or context) that
 * Moshboard doesn't know yet. Designers shouldn't have to know what that means: copy a ready
 * prompt for Claude Code, which writes the frame's wrapper (frames/<id>.wrapper.tsx).
 */
export function copySetupFix(id = getState().selected[0]) {
  const f = frameById(id)
  if (!f?.file) return
  const s = getState()
  const rel = `frames/${f.id}.wrapper.tsx`
  const prompt = [
    `In Moshboard board "${s.boardName}", the component in ${boardLabel(s.boardName)}/${f.file} (frame "${f.id}") doesn’t render:`,
    `"${s.errors[f.id] ?? 'it needs a provider or context'}"`,
    ``,
    `It needs its library’s provider or a React context around it. ${f.wrapper ? `Fix ${boardLabel(s.boardName)}/${f.wrapper}` : `Create ${boardLabel(s.boardName)}/${rel}`}, default-exporting \`function Wrapper({ children })\` that renders the providers it needs around children` +
      `${f.wrapper ? '' : `, and set "wrapper": "${rel}" on that frame in ${boardLabel(s.boardName)}/board.json`}. Don’t change the component itself.`,
  ].join('\n')
  copyText(prompt).then((ok) =>
    ok ? toast('Copied a fix. Paste it into Claude Code') : toast('Couldn’t copy to the clipboard', true),
  )
}

// ── video ───────────────────────────────────────────────

export function markSegment(edge: 'in' | 'out') {
  const id = getState().selected[0]
  const f = frameById(id)
  const v = videos.get(id)
  if (!f || f.type !== 'video' || !v) return
  const t = Math.round(v.currentTime * 100) / 100
  const seg = f.segment ?? { in: 0, out: v.duration || t }
  const next = edge === 'in' ? { in: t, out: Math.max(t + 0.05, seg.out) } : { in: Math.min(seg.in, t - 0.05), out: t }
  updateFrame(id, { segment: { in: Math.max(0, next.in), out: next.out } })
}

export async function analyzeSelected() {
  const f = frameById(getState().selected[0])
  if (!f || f.type !== 'video' || !f.src) return toast('Select a video to analyze', true)
  const done = startJob(f.id, 'Measuring motion')
  try {
    const a = await api.analyze(getState().boardName, f.id, f.src, f.segment)
    const rel = `assets/${f.id}.analysis.json`
    setState((s) => ({ files: { ...s.files, [rel]: JSON.stringify(a) } }))
    updateFrame(f.id, { analysis: rel })
    toast(a.primary ? `Motion ≈ ${a.primary.durationMs}ms, ${a.primary.ease.nearest}` : 'No clear motion found in this segment')
    cue(a.primary ? 'ready' : 'deny')
  } catch (e) {
    toast(`Analysis failed: ${(e as Error).message}`, true)
  } finally {
    done()
  }
}

// Parsed json files, kept until the file's text changes: analysis files are read from
// store selectors, which run on every store change (each pointer move of a drag).
const parsed = new Map<string, { raw: string; value: unknown }>()
function parseFile<T>(rel: string): T | null {
  const raw = getState().files[rel]
  if (!raw) return null
  const hit = parsed.get(rel)
  if (hit?.raw === raw) return hit.value as T | null
  let value: unknown = null
  try {
    value = JSON.parse(raw)
  } catch {
    // not valid json yet
  }
  parsed.set(rel, { raw, value })
  return value as T | null
}

export const readAnalysis = (f?: Frame): VideoAnalysis | null => (f?.analysis ? parseFile<VideoAnalysis>(f.analysis) : null)

export async function captureSelected(selector: string, trigger: string) {
  const f = frameById(getState().selected[0])
  if (!f || f.type !== 'url' || !f.src) return toast('Select a URL frame to capture', true)
  const done = startJob(f.id, `Capturing ${trigger === 'load' ? 'page load' : trigger}`)
  try {
    const { capture, path, scaffold } = await api.capture(getState().boardName, f.id, { url: f.src, selector, trigger })
    setState((s) => ({ files: { ...s.files, [path]: JSON.stringify(capture) } }))
    updateFrame(f.id, { analysis: path })
    const n = capture.transitions.length + capture.animations.length
    await addCode('html', scaffold, {
      label: `${f.label ?? 'Site'}: ${trigger}`,
      link: f.id,
      x: f.x + f.w + 48,
      y: f.y,
      w: 420,
      h: 300,
    })
    toast(n ? `Captured ${n} timing${n > 1 ? 's' : ''}. Scaffold added` : 'No transitions fired. Try another selector or trigger')
    cue(n ? 'ready' : 'deny')
  } catch (e) {
    toast(`Capture failed: ${(e as Error).message}`, true)
  } finally {
    done()
  }
}

// ── view ────────────────────────────────────────────────

export function fitBoard() {
  const frames = getState().board?.frames ?? []
  if (!frames.length) return setCamera({ x: (viewLeft() + window.innerWidth) / 2, y: window.innerHeight / 2, z: 1 })
  const x0 = Math.min(...frames.map((f) => f.x))
  const y0 = Math.min(...frames.map((f) => f.y))
  const x1 = Math.max(...frames.map((f) => f.x + f.w))
  const y1 = Math.max(...frames.map((f) => f.y + f.h))
  const pad = 96
  const left = viewLeft()
  const width = window.innerWidth - left
  const z = Math.min(1, (width - pad * 2) / (x1 - x0), (window.innerHeight - pad * 2) / (y1 - y0))
  setCamera({
    x: left + width / 2 - ((x0 + x1) / 2) * z,
    y: window.innerHeight / 2 - ((y0 + y1) / 2) * z,
    z,
  })
}

export function setViewport(width: number | undefined) {
  for (const id of getState().selected) {
    const f = frameById(id)
    if (f && (f.type === 'code' || f.type === 'url')) updateFrame(id, { viewport: width })
  }
}

/** Export the selection (plus what it's linked to) if anything is selected, else the whole canvas. */
export async function exportBoard(scope: 'auto' | 'all' = 'auto') {
  const ids = scope === 'all' ? [] : getState().selected
  toast('Exporting…')
  try {
    const r = await api.exportBoard(getState().boardName, ids.length ? ids : undefined)
    setState({ exported: r, toast: null })
    cue('ready')
  } catch (e) {
    toast(`Export failed: ${(e as Error).message}`, true)
  }
}

export function copyRecreate() {
  const id = getState().selected[0]
  if (!id) return
  const cmd = `/recreate ${getState().boardName} ${id}`
  copyText(cmd).then((ok) => toast(ok ? `Copied "${cmd}". Run it in Claude Code` : cmd))
}

export const assetUrl = (rel: string) => mediaUrl(getState().boardName, rel)
