import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import type { ParamValue } from '../shared/params.ts'
import type { RuntimeItem } from '../shared/runtime-motion.ts'
import type { Board, BoardComment, Frame, Region } from '../shared/types.ts'
import { api, type CanvasInfo, type ExportResult } from './api'
import type { ClaudeTaskKind } from './folder/ClaudeTask'
import type { FolderEntry, FolderInfo, OnboardingStep } from './folder/folder'
import { cue } from './ui/sound'
import { layoutMembers, movedSince, settleLayouts, type Rect } from './layout'
import { linkNumbers } from '../shared/frame-links.ts'

export interface Camera {
  x: number
  y: number
  z: number
}

export interface State {
  boardName: string
  board: Board | null
  selected: string[]
  /** frame whose contents receive pointer input (double-click to enter, Esc to leave) */
  interact: string | null
  camera: Camera
  /** code frame sources and analysis json, keyed by board-relative path */
  files: Record<string, string>
  /** unlocked param tweaks per frame */
  overrides: Record<string, Record<string, ParamValue>>
  replay: Record<string, number>
  errors: Record<string, string>
  /** motion measured inside each running code frame */
  motion: Record<string, RuntimeItem[]>
  palette: boolean
  space: boolean
  /** 'canvas' = moving/resizing/panning (hides tuning), 'tune' = dragging a control */
  gesture: 'canvas' | 'tune' | null
  toast: { text: string; error?: boolean } | null
  canvases: CanvasInfo[]
  sidebar: boolean
  /** which Add dialog option is open, or null */
  add: AddKind | null
  shortcuts: boolean
  /** last export result, shown in the Export dialog */
  exported: ExportResult | null
  /** what the last export covered: the selection, the picked direction, or the whole canvas */
  exportScope: ExportScope
  /** Adjust-palette preview: the palette shows before/after rows until Apply/Cancel */
  paletteDraft: { id: string; colors: { hex: string; locked?: boolean }[] } | null
  /** palette column focused in the inspector (double-click a column) */
  paletteFocus: number | null
  /** text/note frame whose editor should select all its text when it opens (⌘A) */
  selectAllIn: string | null
  /** Hand tool: dragging the canvas pans instead of box-selecting */
  hand: boolean
  /** auto-replay entrance animations */
  loop: boolean
  /** site frame whose "Capture motion" picker is open */
  picking: string | null
  /** long jobs running on a frame (analyze, capture, fetch), by frame id: what it's doing */
  jobs: Record<string, string>
  /** blocks for frames still on their way (a link downloading, a component fetching) */
  pending: Pending[]
  /** folder mode: the folder on the user's computer that holds the boards (see src/folder/folder.ts) */
  folder: FolderInfo | null
  /** folder mode: every folder connected on this site, and which one is open */
  folders: FolderEntry[]
  folderId: string | null
  /** folder mode: the setup screen showing, if any */
  onboarding: OnboardingStep | null
  /** website: the "Ask Claude" sheet for a site frame (capture, snapshot, fonts), if open */
  claudeTask: { kind: ClaudeTaskKind; frameId: string } | null
  /** frame under the pointer (its link lines light up) */
  hover: string | null
  /** link whose number is under the pointer (a block's link tag): that link comes forward, the rest fade */
  hoverLink: number | null
  /** section a dragged block will land in, highlighted while dragging */
  dropSection: string | null
  /** section whose title is being edited (a new one starts here) */
  renaming: string | null
  /** Compare: sections shown side by side (see src/canvas/compare.ts) */
  compare: Compare | null
  /** a layout shape being hovered in the side panel: where blocks would go (and the section's box) */
  arrange: { rects: Record<string, Rect>; section: Rect; id: string | null } | null
  /** block a dragged block would swap with, inside a layout section */
  dropTile: string | null
  /** image/video whose crop is being moved (drag to pan, scroll to zoom) */
  crop: string | null
  /** Comment mode (C): clicks drop pins, the toolbar flips through comments */
  commenting: boolean
  /** whether open pins show outside comment mode (⇧C, remembered per board) */
  pins: boolean
  /** the comment whose thread is open */
  thread: string | null
  /** a pin being placed, before its first message */
  draft: { on?: string; x: number; y: number } | null
  /** which comments the toolbar flips through */
  commentView: 'open' | 'done'
  /** the toolbar shows every comment as a key instead of the counter */
  commentTray: boolean
  /** the comment last opened: the counter stays on it after its thread closes */
  commentCursor: string | null
  /** video whose analysis area is being drawn on the canvas */
  regionPick: string | null
  /** an image/video whose crop (`view`) is being dragged */
  viewPick: string | null
  /** the crop being dragged, until Done */
  viewDraft: Region | null
  /** a tab's sound being recorded: when it started (ms) */
  recording: number | null
  /** a pin being dragged: where it is (canvas units) and what dropping it would do */
  pinDrag: { id: string; at: { x: number; y: number }; target: PinTarget } | null
}

export interface Compare {
  /** the sections, left to right */
  ids: string[]
  /** where each shown frame is drawn, relative to where it is on the board; frames not in it are hidden */
  offsets: Record<string, { dx: number; dy: number }>
  /** the view to go back to */
  camera: Camera
}

export interface Pending {
  id: string
  x: number
  y: number
  w: number
  h: number
  label: string
}

/** Where a dragged pin would go: onto a block, to another side of its own block, or onto the canvas. */
export type PinTarget =
  | { kind: 'block'; on: string; x: number; y: number }
  | { kind: 'side'; side: 'l' | 'r' | 't' | 'b' }
  | { kind: 'canvas'; x: number; y: number }

export type ExportScope = 'selection' | 'chosen' | 'all'

export type AddKind = 'media' | 'sound' | 'code' | 'url' | 'note' | 'color' | 'font' | 'text' | 'section'

function storedFlag(key: string, fallback = true) {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v !== '0'
  } catch {
    return fallback
  }
}

let state: State = {
  boardName: 'default',
  board: null,
  selected: [],
  interact: null,
  camera: { x: 0, y: 0, z: 1 },
  files: {},
  overrides: {},
  replay: {},
  errors: {},
  motion: {},
  palette: false,
  space: false,
  gesture: null,
  toast: null,
  canvases: [],
  // The website starts with it closed (through the folder setup and onto the canvas) until the
  // user opens it; after that it remembers. The local app starts with it open.
  sidebar: storedFlag('mb:sidebar', import.meta.env.VITE_FOLDER_ONLY !== '1'),
  add: null,
  shortcuts: false,
  exported: null,
  exportScope: 'all',
  hand: false,
  selectAllIn: null,
  paletteDraft: null,
  paletteFocus: null,
  loop: storedFlag('mb:loop'),
  picking: null,
  jobs: {},
  pending: [],
  folder: null,
  folders: [],
  folderId: null,
  onboarding: null,
  claudeTask: null,
  hover: null,
  hoverLink: null,
  dropSection: null,
  renaming: null,
  compare: null,
  arrange: null,
  dropTile: null,
  crop: null,
  commenting: false,
  pins: true,
  thread: null,
  draft: null,
  commentView: 'open',
  commentTray: false,
  commentCursor: null,
  regionPick: null,
  viewPick: null,
  viewDraft: null,
  recording: null,
  pinDrag: null,
}

const subs = new Set<() => void>()
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}

export const getState = () => state

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  subs.forEach((f) => f())
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state))
}

// ── board mutations ─────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | undefined

// ── undo / redo ──
// Each save is one step: changes within the save debounce (a drag, a tidy, a burst
// of typing) undo together. History is per canvas and resets when you switch.
interface Snap {
  frames: Frame[]
  comments?: BoardComment[]
}
let committed: Snap | null = null
const undoStack: Snap[] = []
const redoStack: Snap[] = []
const HISTORY = 100
const snap = (b: Board): Snap => ({ frames: b.frames, comments: b.comments })
const isCommitted = (b: Board) => !!committed && b.frames === committed.frames && b.comments === committed.comments

/** Call when a board is (re)loaded from disk: that's the new baseline, not an undoable change. */
export function resetHistory(board: Board, keep = false) {
  committed = snap(board)
  settled = board.frames
  if (!keep) {
    undoStack.length = 0
    redoStack.length = 0
  }
}

function commit() {
  const board = state.board
  if (!board || isCommitted(board)) return
  if (committed) {
    undoStack.push(committed)
    if (undoStack.length > HISTORY) undoStack.shift()
    redoStack.length = 0
  }
  committed = snap(board)
}

function persist() {
  const { board, boardName } = state
  if (board) api.saveBoard(boardName, board).catch((e) => toast(`Save failed: ${e.message}`, true))
}

/** Writes a pending save now, for when something is about to read the board from disk. */
export async function flushSave() {
  if (saveTimer === undefined) return
  clearTimeout(saveTimer)
  saveTimer = undefined
  commit()
  const { board, boardName } = state
  if (board) await api.saveBoard(boardName, board)
}

export function saveSoon() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    commit()
    persist()
  }, 250)
}

function travel(from: Snap[], to: Snap[]) {
  clearTimeout(saveTimer)
  commit() // fold any pending change in first
  const prev = from.pop()
  if (!prev || !state.board) return false
  to.push(snap(state.board))
  committed = prev
  settled = prev.frames
  const ids = new Set(prev.frames.map((f) => f.id))
  const threads = new Set((prev.comments ?? []).map((c) => c.id))
  setState({
    board: { ...state.board, frames: prev.frames, comments: prev.comments },
    selected: state.selected.filter((id) => ids.has(id)),
    thread: state.thread && threads.has(state.thread) ? state.thread : null,
  })
  persist()
  return true
}

const step = (ok: boolean, sound: 'turn-back' | 'turn-forward') => (ok && cue(sound), ok)
export const undo = () => step(travel(undoStack, redoStack), 'turn-back')
export const redo = () => step(travel(redoStack, undoStack), 'turn-forward')

// Layout sections and their blocks are brought in line after every change (src/layout.ts),
// except while blocks are dragged on the canvas (they move freely until the drag ends) and while
// a paste is adding a section's blocks one by one. Dragging a control (the gap, a column count)
// does lay out live.
let layoutsHeld = 0
// The frames as layouts last saw them: what moved since then (a drag, a paste) may join one.
let settled: Frame[] | null = null
export const markSettled = (frames: Frame[]) => void (settled = frames)
export function holdLayouts<T>(p: Promise<T>): Promise<T> {
  layoutsHeld++
  return p.finally(() => {
    layoutsHeld--
    if (!layoutsHeld) mutateFrames((fs) => fs)
  })
}

export function mutateFrames(fn: (frames: Frame[]) => Frame[], save = true) {
  if (!state.board) return
  let frames = fn(state.board.frames)
  if (state.gesture !== 'canvas' && !layoutsHeld) settled = frames = settleLayouts(frames, movedSince(settled))
  setState({ board: { ...state.board, frames } })
  if (save) saveSoon()
}

export function updateFrame(id: string, patch: Partial<Frame>, save = true) {
  mutateFrames((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)), save)
}

/**
 * A size a block measures for itself (text wrapping, a font loading). Saved, but not an undo step
 * of its own: undoing to a state with an old size would re-measure, push a new step and wipe redo.
 * Folds into a pending edit when there is one.
 */
export function fitFrame(id: string, patch: Partial<Frame>) {
  const clean = saveTimer === undefined && !!state.board && isCommitted(state.board)
  updateFrame(id, patch)
  if (clean && state.board) committed = snap(state.board)
}

/** Comments change like frames do: saved, and one undo step per save. */
export function mutateComments(fn: (comments: BoardComment[]) => BoardComment[]) {
  if (!state.board) return
  setState({ board: { ...state.board, comments: fn(state.board.comments ?? []) } })
  saveSoon()
}

// id → frame, rebuilt only when the frames array changes (blocks look each other up on every store change).
const indexes = new WeakMap<Frame[], Map<string, Frame>>()
function frameIndex(frames: Frame[]) {
  let m = indexes.get(frames)
  if (!m) {
    m = new Map(frames.map((f) => [f.id, f]))
    indexes.set(frames, m)
  }
  return m
}
export const frameById = (id: string | null | undefined) =>
  id && state.board ? frameIndex(state.board.frames).get(id) : undefined

/** Whether two versions of a frame differ only in the given (geometry) fields: a move or resize. */
export function sameFrameExcept(a: Frame, b: Frame, ignore: readonly (keyof Frame)[]) {
  if (a === b) return true
  const ka = Object.keys(a) as (keyof Frame)[]
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => ignore.includes(k) || a[k] === b[k])
}

// ── camera ──────────────────────────────────────────────

// The camera changes on every pan/zoom event, so it has its own subscriber list:
// blocks never re-run their selectors while the view moves.
const cameraSubs = new Set<() => void>()
const subscribeCamera = (f: () => void) => {
  cameraSubs.add(f)
  return () => {
    cameraSubs.delete(f)
  }
}
export function onCamera(f: (c: Camera) => void) {
  return subscribeCamera(() => f(state.camera))
}
export function useCamera<T>(select: (c: Camera) => T): T {
  return useSyncExternalStore(subscribeCamera, () => select(state.camera))
}

export const MIN_ZOOM = 0.08
export const MAX_ZOOM = 4

let cameraTimer: ReturnType<typeof setTimeout> | undefined
export function setCamera(camera: Camera) {
  // Every view goes through here, so a fit in a narrow window (or a bad saved view) can't
  // flip the board with a zero or negative zoom.
  if (![camera.x, camera.y, camera.z].every(Number.isFinite)) return
  camera = { ...camera, z: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.z)) }
  state = { ...state, camera }
  cameraSubs.forEach((f) => f())
  // Persist once movement settles, not on every pan/zoom event.
  clearTimeout(cameraTimer)
  const board = state.boardName
  cameraTimer = setTimeout(() => {
    try {
      localStorage.setItem(`mb:camera:${board}`, JSON.stringify(camera))
    } catch {
      // storage unavailable
    }
  }, 300)
}

// A zoom gesture (pinch or ⌘-scroll) in progress. Live code frames show a still picture of
// themselves meanwhile (see CodeFrame), so nothing has to redraw at every zoom step.
let zooming = false
const zoomSubs = new Set<(on: boolean) => void>()
export const isZooming = () => zooming
export function onZoomGesture(f: (on: boolean) => void) {
  zoomSubs.add(f)
  return () => {
    zoomSubs.delete(f)
  }
}
export function setZooming(on: boolean) {
  if (on === zooming) return
  zooming = on
  zoomSubs.forEach((f) => f(on))
}

export function storedCamera(board: string): Camera | null {
  try {
    const raw = localStorage.getItem(`mb:camera:${board}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const screenToWorld = (sx: number, sy: number) => {
  const { x, y, z } = state.camera
  return { x: (sx - x) / z, y: (sy - y) / z }
}

/** sidebar width plus its inset from the screen edge */
export const SIDEBAR_W = 252
export const INSPECTOR_W = 300
const INSPECTED = new Set(['code', 'image', 'video', 'audio', 'text', 'palette'])
/** Whether the right-hand inspector is showing (one inspectable frame selected). */
export const inspectorOpen = (s: State) =>
  s.selected.length > 1 ||
  (s.selected.length === 1 && inspected(frameById(s.selected[0])))
const inspected = (f?: Frame) =>
  !!f &&
  (INSPECTED.has(f.type) ||
    f.type === 'swatch' ||
    f.type === 'section' ||
    // Blocks in a layout or a link: the panel has their place there, or their links.
    (!!state.board && (layoutMembers(state.board.frames).has(f.id) || linkNumbers(f.id, state.board.frames).length > 0)))
/** Left edge of the visible canvas (the sidebar sits on top of it). */
/**
 * Whether the sidebar is on screen: the user's setting, except that the website keeps it closed
 * until a folder is open (and behind the folder screens). Layout around it follows this.
 */
export const sidebarShown = (s: State) =>
  s.sidebar && !(import.meta.env.VITE_FOLDER_ONLY === '1' && (!s.folder || s.onboarding === 'reconnect' || s.onboarding === 'gone'))
export const viewLeft = () => (sidebarShown(state) ? SIDEBAR_W : 0)

export const viewportCenter = () => screenToWorld((viewLeft() + window.innerWidth) / 2, window.innerHeight / 2)

// ── jobs ────────────────────────────────────────────────

/** Shows the loader over a frame while a long job runs on it; call the result when it's done. */
export function startJob(id: string, label: string) {
  setState((s) => ({ jobs: { ...s.jobs, [id]: label } }))
  return () =>
    setState((s) => {
      const jobs = { ...s.jobs }
      delete jobs[id]
      return { jobs }
    })
}

/** A placeholder block where a frame will land; call the result to remove it. */
export function startPending(p: Omit<Pending, 'id'>) {
  const id = `pending-${Math.random().toString(36).slice(2, 8)}`
  setState((s) => ({ pending: [...s.pending, { ...p, id }] }))
  return () => setState((s) => ({ pending: s.pending.filter((x) => x.id !== id) }))
}

// ── toast ───────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(text: string, error = false) {
  clearTimeout(toastTimer)
  setState({ toast: { text, error } })
  if (error) cue('deny')
  toastTimer = setTimeout(() => setState({ toast: null }), error ? 5000 : 2400)
}

export function toggleSidebar(open = !state.sidebar) {
  if (open === state.sidebar) return
  // The bar morphs into the panel (and back): its box, mark and canvas name are shared
  // elements of a view transition (see "Sidebar morph" in theme.css).
  const root = document.documentElement
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.dataset.navMorph = open ? 'open' : 'close'
    const vt = document.startViewTransition(() => flushSync(() => setState({ sidebar: open })))
    // Skipped (hidden tab, a second toggle mid-flight): the state change still lands.
    vt.ready.catch(() => {})
    vt.finished.finally(() => {
      if (root.dataset.navMorph === (open ? 'open' : 'close')) delete root.dataset.navMorph
    })
  } else setState({ sidebar: open })
  try {
    localStorage.setItem('mb:sidebar', open ? '1' : '0')
  } catch {
    // storage unavailable
  }
}

/** ⇧C: open pins on or off outside comment mode, remembered per canvas. */
export function togglePins(on = !state.pins) {
  if (on !== state.pins) cue(on ? 'toggle-on' : 'toggle-off')
  setState({ pins: on })
  try {
    localStorage.setItem(`mb:pins:${state.boardName}`, on ? '1' : '0')
  } catch {
    // storage unavailable
  }
}
export const storedPins = (board: string) => storedFlag(`mb:pins:${board}`)

export function toggleLoop(on = !state.loop) {
  if (on !== state.loop) cue(on ? 'toggle-on' : 'toggle-off')
  setState({ loop: on })
  try {
    localStorage.setItem('mb:loop', on ? '1' : '0')
  } catch {
    // storage unavailable
  }
}
