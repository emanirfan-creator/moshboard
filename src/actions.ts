import { applyParams, defaults, parseParams, type ParamValue } from '../shared/params.ts'
import { autoParams } from '../shared/autoParams.ts'
import { writeBack } from '../shared/detect-motion.ts'
import { isRuntimeName, saveRuntime } from '../shared/runtime-motion.ts'
import { detectFor, parseModules } from './tuning/detection'
import { scanChirp, scanEmpty } from './ui/sound'
import type { Frame, FrameType, VideoAnalysis } from '../shared/types.ts'
import { looksLikeInstall } from '../shared/install.ts'
import { isMediaLink } from '../shared/links.ts'
import { arrange, type LayoutKind } from './layout'
import { copyText } from './clipboard'
import { generatePalette, nameColor, paletteFromSamples, parseCoolors, type PaletteColor } from '../shared/color.ts'
import { boardSamples, hasColors } from './boardColors'
import { api, mediaUrl } from './api'
import { ensureDefaultExport } from './frames/sandbox'
import { videos } from './frames/registry'
import {
  frameById,
  getState,
  mutateFrames,
  resetHistory,
  saveSoon,
  setCamera,
  setState,
  storedCamera,
  toast,
  updateFrame,
  viewLeft,
  viewportCenter,
} from './store'

export const newId = () => Math.random().toString(36).slice(2, 8)

// ── boards ──────────────────────────────────────────────

export async function loadBoard(name: string): Promise<void> {
  let board
  try {
    board = await api.board(name)
  } catch {
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
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`)
  const cam = storedCamera(name)
  if (cam) setCamera(cam)
  else requestAnimationFrame(fitBoard)
  // Analysis files are small; load them so strips and exports have them.
  for (const f of board.frames) if (f.analysis && !(f.analysis in getState().files)) loadFile(f.analysis)
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

export async function refreshCanvases() {
  setState({ canvases: await api.boards() })
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

export function renameCanvas(name: string) {
  const { board } = getState()
  const title = name.trim()
  if (!board || !title) return
  setState({ board: { ...board, name: title } })
  saveSoon()
  setState((s) => ({ canvases: s.canvases.map((c) => (c.id === s.boardName ? { ...c, name: title } : c)) }))
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
  toast(`Moved “${info?.name ?? id}” to boards/.trash`)
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

/**
 * New colors around the locked ones: suggested from the board when it has
 * anything to read colors from (each run varies a little), otherwise random harmony.
 */
export async function regeneratePalette(id = getState().selected[0]) {
  const f = frameById(id)
  if (f?.type !== 'palette') return
  const count = f.colors?.length || 5
  setPaletteColors(f.id, (await fromBoard(f.colors ?? [], count, f.id)) ?? generatePalette(f.colors ?? [], count))
}

/**
 * A balanced palette from the selected images/videos/sites/swatches (and
 * palettes) if any are selected, otherwise from everything on the board.
 * Null when there's nothing to read colors from.
 */
async function fromBoard(current: PaletteColor[], count: number, exclude?: string) {
  const { board, selected, boardName } = getState()
  const frames = (board?.frames ?? []).filter((f) => f.id !== exclude)
  const picked = frames.filter((f) => selected.includes(f.id) && hasColors(f, true))
  const sources = picked.length ? picked : frames.filter((f) => hasColors(f, false))
  if (!sources.length) return null
  const samples = await boardSamples(boardName, sources)
  return samples.length ? paletteFromSamples(samples, current, count) : null
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
  return addFrame({ type: 'swatch', font: 'Inter Variable', label: 'Body', ...place(260, 120, at) })
}

/**
 * Add any link: media pages (a Cosmos element, Dribbble shot, direct .mp4…) are
 * downloaded and become a video/image block; anything else is a website block.
 */
export async function addLink(href: string, at?: { x: number; y: number }) {
  const url = /^https?:\/\//.test(href) ? href : `https://${href}`
  const coolors = parseCoolors(url)
  if (coolors) return addPalette(coolors, at, 'Coolors palette')
  if (!isMediaLink(url)) return addUrl(url, at)
  const host = new URL(url).hostname.replace(/^www\./, '')
  toast(`Fetching from ${host}…`)
  try {
    const m = await api.mediaLink(getState().boardName, url)
    if (m.items && m.items.length > 1) return addPieces(m.items, m.title, m.source, host, at)
    const max = m.type === 'video' ? 480 : 360
    const w0 = m.width ?? 480
    const h0 = m.height ?? 300
    const k = Math.min(1, max / Math.max(w0, h0))
    const f = addFrame({ type: m.type, src: m.path, origin: m.source, label: m.title, ...place(w0 * k, h0 * k, at) })
    toast(`Added ${m.type} from ${host}`)
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
  const sized = items.map((it) => ({ ...it, w: Math.round(H * ((it.width ?? 4) / (it.height ?? 3))) }))
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
      h: H,
    } as Frame
    x += it.w + GAP
    return f
  })
  mutateFrames((fs) => [...fs, ...frames])
  setState({ selected: frames.map((f) => f.id), interact: null })
  toast(`Added ${frames.length} pieces from ${host}`)
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
  return addFrame({ type: 'url', src: url, label: host, viewport: 1280, ...place(640, 400, at) })
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
  const body = kind === 'tsx' ? ensureDefaultExport(text) : text
  await api.writeFile(getState().boardName, file, body)
  setState((s) => ({ files: { ...s.files, [file]: body } }))
  return addFrame({ type: 'code', file, label: opts.label ?? 'Component', ...place(420, 300), ...opts, id })
}

export const looksLikeCode = (t: string) =>
  /(^|\n)\s*(import|export)\s/.test(t) || /className=|=>\s*[({<]|<\/\w+>/.test(t) || /^\s*<[a-z!]/i.test(t)

/** Fetch a component from a shadcn-style registry ("npx shadcn@latest add …") and add it. */
export async function addFromRegistry(input: string) {
  toast('Fetching component from the registry…')
  try {
    const r = await api.registry(input)
    const f = await addCode('tsx', r.entry, { label: r.title, w: 520, h: 420 }, r.modules)
    const n = Object.keys(r.modules).length
    toast(`Added ${r.title}${n ? ` with ${n} supporting file${n > 1 ? 's' : ''}` : ''}`)
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
  toast('Fetching component from the registry…')
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
  } catch (e) {
    toast(`Couldn’t fetch it: ${(e as Error).message}`, true)
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
    return f
  }
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
    const size = await mediaSize(file, type as 'image' | 'video')
    const up = await api.upload(getState().boardName, file)
    const path = up.path
    addFrame({
      type: up.type ?? type,
      src: path,
      label: file.name.replace(/\.\w+$/, ''),
      ...place(size.w, size.h, { x: at.x + offset, y: at.y + offset }),
    })
    offset += 32
  }
}

export function deleteSelected() {
  const { selected, board, boardName } = getState()
  if (!selected.length || !board) return
  const doomed = board.frames.filter((f) => selected.includes(f.id))
  mutateFrames((fs) =>
    fs.filter((f) => !selected.includes(f.id)).map((f) => (f.link && selected.includes(f.link) ? { ...f, link: undefined } : f)),
  )
  setState({ selected: [], interact: null })
  // Code sources go too; uploaded assets stay on disk in case they're referenced elsewhere.
  for (const f of doomed) for (const rel of [f.file, f.modules]) if (rel) api.deleteFile(boardName, rel).catch(() => {})
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
  copyText(CLIP_MARK + JSON.stringify(clip)).catch(() => {})
  if (cut) deleteSelected()
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
}

// ── linking & replay ────────────────────────────────────

export function linkSelected() {
  const [a, b] = getState().selected.map(frameById)
  if (!a || !b) return toast('Select two frames: the reference, then its copy or note', true)
  // The code frame (or note) points at the other one.
  const [child, parent] = a.type === 'code' || a.type === 'note' ? (b.type === 'code' || b.type === 'note' ? [b, a] : [a, b]) : [b, a]
  updateFrame(child.id, { link: parent.id })
  toast(`Linked ${child.label ?? child.type} → ${parent.label ?? parent.type}`)
}

export function unlinkSelected() {
  for (const id of getState().selected) updateFrame(id, { link: undefined })
}

/** Replay selected frames together with anything they're linked to. */
export function replay(ids = getState().selected) {
  const frames = getState().board?.frames ?? []
  const set = new Set(ids)
  for (const f of frames) {
    if (set.has(f.id) && f.link) set.add(f.link)
    if (f.link && set.has(f.link)) set.add(f.id)
  }
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
  const tuned = Object.fromEntries(Object.entries(all).filter(([k]) => !isRuntimeName(k)))
  if (Object.keys(measured).length) {
    updateFrame(id, { runtime: saveRuntime(f.runtime, measured, getState().motion[id]) })
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
  const where = [
    main !== src && f.file.split('/').pop(),
    moduleChanged && 'its component files',
    Object.keys(measured).length && 'this canvas',
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
    `In Moshboard board "${s.boardName}", the component in boards/${s.boardName}/${f.file} (frame "${f.id}") doesn’t render:`,
    `"${s.errors[f.id] ?? 'it needs a provider or context'}"`,
    ``,
    `It needs its library’s provider or a React context around it. ${f.wrapper ? `Fix boards/${s.boardName}/${f.wrapper}` : `Create boards/${s.boardName}/${rel}`}, default-exporting \`function Wrapper({ children })\` that renders the providers it needs around children` +
      `${f.wrapper ? '' : `, and set "wrapper": "${rel}" on that frame in boards/${s.boardName}/board.json`}. Don’t change the component itself.`,
  ].join('\n')
  navigator.clipboard.writeText(prompt).then(
    () => toast('Copied a fix. Paste it into Claude Code'),
    () => toast('Couldn’t copy to the clipboard', true),
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
  toast('Analyzing motion…')
  try {
    const a = await api.analyze(getState().boardName, f.id, f.src, f.segment)
    const rel = `assets/${f.id}.analysis.json`
    setState((s) => ({ files: { ...s.files, [rel]: JSON.stringify(a) } }))
    updateFrame(f.id, { analysis: rel })
    toast(a.primary ? `Motion ≈ ${a.primary.durationMs}ms, ${a.primary.ease.nearest}` : 'No clear motion found in this segment')
  } catch (e) {
    toast(`Analysis failed: ${(e as Error).message}`, true)
  }
}

export const readAnalysis = (f?: Frame): VideoAnalysis | null => {
  const raw = f?.analysis ? getState().files[f.analysis] : ''
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function captureSelected(selector: string, trigger: string) {
  const f = frameById(getState().selected[0])
  if (!f || f.type !== 'url' || !f.src) return toast('Select a URL frame to capture', true)
  toast(`Capturing ${trigger} on ${selector}…`)
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
  } catch (e) {
    toast(`Capture failed: ${(e as Error).message}`, true)
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
  } catch (e) {
    toast(`Export failed: ${(e as Error).message}`, true)
  }
}

export function copyRecreate() {
  const id = getState().selected[0]
  if (!id) return
  const cmd = `/recreate ${getState().boardName} ${id}`
  navigator.clipboard.writeText(cmd).then(
    () => toast(`Copied "${cmd}". Run it in Claude Code`),
    () => toast(cmd),
  )
}

export const assetUrl = (rel: string) => mediaUrl(getState().boardName, rel)
