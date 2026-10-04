// Folder mode: boards live in a folder on the user's computer instead of next to a local server.
//
// The folder is picked in the browser (File System Access, Chrome/Edge/Arc) and its handle kept in
// IndexedDB. `public/folder-sw.js` answers the app's `/api/…` and `/media/…` requests from it, so
// the rest of the app is unchanged. Edits made on disk (Claude Code, Codex) are watched here and
// show up live, like `server/plugin.ts`'s watcher does for the local app. On connect, the folder
// gets the /recreate skill and an AGENTS.md, so an assistant opened there knows the workflow.

import skill from '../../.claude/skills/recreate/SKILL.md?raw'
import { getState, setState } from '../store'

/** Hosted build: there's no local server, so a folder is required. */
export const FOLDER_ONLY = import.meta.env.VITE_FOLDER_ONLY === '1'
export const folderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

export type OnboardingStep = 'welcome' | 'reconnect' | 'ready' | 'claude'

export interface FolderInfo {
  name: string
  /** The folder is itself one board (it has a board.json). */
  single: boolean
  /** Whether the Claude/Codex instructions are in the folder (false when we left the user's own alone). */
  assistant: boolean
}

// File System Access isn't in TypeScript's DOM types yet.
type Perm = 'granted' | 'denied' | 'prompt'
type Dir = FileSystemDirectoryHandle & {
  queryPermission(o: { mode: 'readwrite' }): Promise<Perm>
  requestPermission(o: { mode: 'readwrite' }): Promise<Perm>
  entries(): AsyncIterable<[string, FileSystemHandle]>
}
type ObserverRecord = { type: string; relativePathComponents: string[] }
type Observer = { observe(d: Dir, o: { recursive: boolean }): Promise<void>; disconnect(): void }
declare global {
  interface Window {
    showDirectoryPicker(o?: { mode?: 'readwrite'; id?: string }): Promise<Dir>
    FileSystemObserver?: new (cb: (records: ObserverRecord[]) => void) => Observer
  }
}

// ── handle storage ──────────────────────────────────────

const DB = 'moshboard'
const STORE = 'kv'

function idb<T>(run: (s: IDBObjectStore) => IDBRequest, mode: IDBTransactionMode = 'readonly'): Promise<T | undefined> {
  return new Promise((resolve) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => resolve(undefined)
    open.onsuccess = () => {
      const req = run(open.result.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => resolve(undefined)
    }
  })
}
const idbGet = <T>(key: string) => idb<T>((s) => s.get(key))
const idbSet = (key: string, value: unknown) => idb((s) => s.put(value, key), 'readwrite')
const idbDel = (key: string) => idb((s) => s.delete(key), 'readwrite')

// ── service worker ──────────────────────────────────────

async function ensureWorker() {
  const sw = navigator.serviceWorker
  await sw.register('/folder-sw.js', { scope: '/' })
  const reg = await sw.ready
  // A hard reload loads the page without the worker; ask it to take over.
  if (!sw.controller) {
    const claimed = new Promise((r) => sw.addEventListener('controllerchange', r, { once: true }))
    reg.active?.postMessage({ type: 'claim' })
    await claimed
  }
  sw.controller?.postMessage({ type: 'folder' })
}

// ── connecting ──────────────────────────────────────────

let root: Dir | null = null

/** The folder as people read it in toasts and copied prompts, and where a board sits in it. */
export function boardsLabel() {
  return getState().folder?.name ?? __BOARDS__
}
export function boardLabel(board: string) {
  const f = getState().folder
  return f?.single ? f.name : `${boardsLabel()}/${board}`
}

async function isSingle(dir: Dir) {
  try {
    await dir.getFileHandle('board.json')
    return true
  } catch {
    return false
  }
}

/**
 * Called once on load. True when the app can open a board now: a connected folder Chrome still
 * lets us use, or (in the local app) no folder at all. Otherwise shows the right onboarding step.
 */
export async function startFolder(): Promise<boolean> {
  window.addEventListener('mb:reconnect', () => setState({ onboarding: 'reconnect' }))
  const saved = await idbGet<Dir>('root')
  if (saved) {
    if ((await saved.queryPermission({ mode: 'readwrite' })) === 'granted') {
      await activate(saved)
      return true
    }
    setState({ folder: { name: saved.name, single: false, assistant: false }, onboarding: 'reconnect' })
    return false
  }
  if (FOLDER_ONLY) {
    setState({ onboarding: 'welcome' })
    return false
  }
  return true
}

async function activate(dir: Dir) {
  root = dir
  await ensureWorker()
  const assistant = await installAssistant(dir)
  setState({ folder: { name: dir.name, single: await isSingle(dir), assistant } })
  watch(dir)
}

/** Opens the boards in the connected folder (first canvas, or the one in the address). */
async function openBoards() {
  const { loadBoard, refreshCanvases } = await import('../actions')
  await refreshCanvases()
  const hash = decodeURIComponent(location.hash.slice(1))
  await loadBoard(hash || 'default')
}

/** "Choose folder": pick a folder, keep it, and open its boards. */
export async function chooseFolder() {
  let dir: Dir
  try {
    dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'moshboard' })
  } catch {
    return // closed the picker
  }
  await idbSet('root', dir)
  history.replaceState(null, '', location.pathname)
  await activate(dir)
  await openBoards()
  setState({ onboarding: 'ready' })
}

/** "Reconnect": Chrome asks again for the folder it already knows. Needs a click. */
export async function reconnectFolder() {
  const saved = root ?? (await idbGet<Dir>('root'))
  if (!saved) return setState({ onboarding: 'welcome' })
  if ((await saved.requestPermission({ mode: 'readwrite' })) !== 'granted') return
  const first = !root
  await activate(saved)
  setState({ onboarding: null })
  if (first) await openBoards()
  else {
    const { loadBoard } = await import('../actions')
    await loadBoard(getState().boardName)
  }
}

/** Local app only: go back to the boards next to the server. */
export async function disconnectFolder() {
  await idbDel('root')
  navigator.serviceWorker.controller?.postMessage({ type: 'folder' })
  location.hash = ''
  location.reload()
}

// ── watching ────────────────────────────────────────────

type Change = { board: string; file: string }
const listeners = new Set<(c: Change) => void>()
/** Files changed on disk by something other than the app (Claude Code, Codex, a text editor). */
export function onFolderChange(f: (c: Change) => void) {
  listeners.add(f)
  return () => listeners.delete(f)
}

// What the app itself last wrote, so its own saves aren't reported back as outside edits.
const own = new Map<string, string>()
new BroadcastChannel('moshboard-folder').onmessage = (e) => {
  if (e.data?.type === 'own') own.set(`${e.data.board}/${e.data.file}`, e.data.text)
}

let stopWatching = () => {}
const pending = new Map<string, ReturnType<typeof setTimeout>>()

async function readRel(dir: Dir, parts: string[]) {
  let d: FileSystemDirectoryHandle = dir
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p)
  return (await d.getFileHandle(parts[parts.length - 1])).getFile()
}

/** Where a path in the folder lands: which board, and the path inside it. */
function locate(parts: string[]): Change | null {
  const f = getState().folder
  const [board, ...rest] = f?.single ? [getState().boardName, ...parts] : parts
  const file = rest.join('/')
  if (!board || !(file === 'board.json' || file.startsWith('frames/'))) return null
  return { board, file }
}

function report(dir: Dir, change: Change) {
  const key = `${change.board}/${change.file}`
  clearTimeout(pending.get(key))
  pending.set(
    key,
    setTimeout(async () => {
      pending.delete(key)
      const parts = getState().folder?.single ? change.file.split('/') : key.split('/')
      let text: string | null = null
      try {
        text = await (await readRel(dir, parts)).text()
      } catch {
        // deleted
      }
      if (text !== null && own.get(key) === text) return
      own.delete(key)
      listeners.forEach((f) => f(change))
    }, 60),
  )
}

function watch(dir: Dir) {
  stopWatching()
  const Observer = window.FileSystemObserver
  if (Observer) {
    const observer = new Observer((records) => {
      for (const r of records) {
        const change = locate(r.relativePathComponents)
        if (change) report(dir, change)
        // The observer lost track (too many changes at once): reread the open board.
        else if (r.type === 'errored' || r.type === 'unknown') report(dir, { board: getState().boardName, file: 'board.json' })
      }
    })
    observer.observe(dir, { recursive: true }).catch(() => {})
    stopWatching = () => observer.disconnect()
    return
  }
  // No observer in this browser: check the open board's files every second or so.
  const seen = new Map<string, number>()
  const timer = setInterval(async () => {
    const s = getState()
    for (const file of ['board.json', ...Object.keys(s.files).filter((f) => f.startsWith('frames/'))]) {
      const parts = s.folder?.single ? file.split('/') : [s.boardName, ...file.split('/')]
      try {
        const t = (await readRel(dir, parts)).lastModified
        const key = `${s.boardName}/${file}`
        if (seen.has(key) && seen.get(key) !== t) report(dir, { board: s.boardName, file })
        seen.set(key, t)
      } catch {
        // not there (yet)
      }
    }
  }, 1200)
  stopWatching = () => clearInterval(timer)
}

// ── Claude Code / Codex instructions ────────────────────

const AGENTS = `# Moshboard

This folder holds Moshboard boards: a moodboard where references can be live (videos, websites,
runnable components). Each board is a folder with a \`board.json\`, \`frames/\` (code frame
sources) and \`assets/\` (uploads and analysis). The app watches these files, so edits show up live.

To recreate a reference as a tunable code frame (\`/recreate <board> <frameId>\`), follow
\`.claude/skills/recreate/SKILL.md\`.
`

const FILES: [string, string][] = [
  ['.claude/skills/recreate/SKILL.md', skill],
  ['AGENTS.md', AGENTS],
]

function hash(text: string) {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * Writes the instructions into the folder, and keeps them current as the app updates. A file the
 * user wrote or changed themselves (their own AGENTS.md, an edited skill) is left alone. True when
 * the skill is in place.
 */
async function installAssistant(dir: Dir): Promise<boolean> {
  const written = (await idbGet<Record<string, string>>('installed')) ?? {}
  let ready = true
  for (const [rel, content] of FILES) {
    const parts = rel.split('/')
    let current: string | null = null
    try {
      current = await (await readRel(dir, parts)).text()
    } catch {
      // not there yet
    }
    const key = `${dir.name}/${rel}`
    if (current === content) {
      written[key] = hash(content)
      continue
    }
    if (current !== null && written[key] !== hash(current)) continue
    try {
      let d: FileSystemDirectoryHandle = dir
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true })
      const w = await (await d.getFileHandle(parts[parts.length - 1], { create: true })).createWritable()
      await w.write(content)
      await w.close()
      written[key] = hash(content)
    } catch {
      if (rel.endsWith('SKILL.md')) ready = false
    }
  }
  await idbSet('installed', written)
  return ready
}
