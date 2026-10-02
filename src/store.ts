import { useSyncExternalStore } from 'react'
import type { ParamValue } from '../shared/params.ts'
import type { Board, Frame } from '../shared/types.ts'
import { api, type CanvasInfo, type ExportResult } from './api'

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
}

export type AddKind = 'media' | 'code' | 'url' | 'note' | 'color' | 'font' | 'text'

function storedFlag(key: string) {
  try {
    return localStorage.getItem(key) !== '0'
  } catch {
    return true
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
  palette: false,
  space: false,
  gesture: null,
  toast: null,
  canvases: [],
  sidebar: storedFlag('mb:sidebar'),
  add: null,
  shortcuts: false,
  exported: null,
  hand: false,
  selectAllIn: null,
  paletteDraft: null,
  paletteFocus: null,
  loop: storedFlag('mb:loop'),
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
let committed: Frame[] | null = null
const undoStack: Frame[][] = []
const redoStack: Frame[][] = []
const HISTORY = 100

/** Call when a board is (re)loaded from disk: that's the new baseline, not an undoable change. */
export function resetHistory(frames: Frame[], keep = false) {
  committed = frames
  if (!keep) {
    undoStack.length = 0
    redoStack.length = 0
  }
}

function commit() {
  const frames = state.board?.frames
  if (!frames || frames === committed) return
  if (committed) {
    undoStack.push(committed)
    if (undoStack.length > HISTORY) undoStack.shift()
    redoStack.length = 0
  }
  committed = frames
}

function persist() {
  const { board, boardName } = state
  if (board) api.saveBoard(boardName, board).catch((e) => toast(`Save failed: ${e.message}`, true))
}

export function saveSoon() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    commit()
    persist()
  }, 250)
}

function travel(from: Frame[][], to: Frame[][]) {
  clearTimeout(saveTimer)
  commit() // fold any pending change in first
  const prev = from.pop()
  if (!prev || !state.board) return false
  to.push(state.board.frames)
  committed = prev
  const ids = new Set(prev.map((f) => f.id))
  setState({ board: { ...state.board, frames: prev }, selected: state.selected.filter((id) => ids.has(id)) })
  persist()
  return true
}

export const undo = () => travel(undoStack, redoStack)
export const redo = () => travel(redoStack, undoStack)

export function mutateFrames(fn: (frames: Frame[]) => Frame[], save = true) {
  if (!state.board) return
  setState({ board: { ...state.board, frames: fn(state.board.frames) } })
  if (save) saveSoon()
}

export function updateFrame(id: string, patch: Partial<Frame>, save = true) {
  mutateFrames((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)), save)
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

let cameraTimer: ReturnType<typeof setTimeout> | undefined
export function setCamera(camera: Camera) {
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

export const SIDEBAR_W = 240
export const INSPECTOR_W = 300
const INSPECTED = new Set(['code', 'video', 'text', 'palette'])
/** Whether the right-hand inspector is showing (one inspectable frame selected). */
export const inspectorOpen = (s: State) =>
  s.selected.length > 1 ||
  (s.selected.length === 1 && INSPECTED.has(s.board?.frames.find((f) => f.id === s.selected[0])?.type ?? ''))
/** Left edge of the visible canvas (the sidebar sits on top of it). */
export const viewLeft = () => (state.sidebar ? SIDEBAR_W : 0)

export const viewportCenter = () => screenToWorld((viewLeft() + window.innerWidth) / 2, window.innerHeight / 2)

// ── toast ───────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(text: string, error = false) {
  clearTimeout(toastTimer)
  setState({ toast: { text, error } })
  toastTimer = setTimeout(() => setState({ toast: null }), error ? 5000 : 2400)
}

export function toggleSidebar(open = !state.sidebar) {
  setState({ sidebar: open })
  try {
    localStorage.setItem('mb:sidebar', open ? '1' : '0')
  } catch {
    // storage unavailable
  }
}

export function toggleLoop(on = !state.loop) {
  setState({ loop: on })
  try {
    localStorage.setItem('mb:loop', on ? '1' : '0')
  } catch {
    // storage unavailable
  }
}
