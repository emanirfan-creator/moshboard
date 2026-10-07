// Folder mode: boards live in a folder on the user's computer instead of next to a local server.
//
// The folder is picked in the browser (File System Access, Chrome/Edge/Arc) and its handle kept in
// IndexedDB. `public/folder-sw.js` answers the app's `/api/…` and `/media/…` requests from it, so
// the rest of the app is unchanged. Edits made on disk (Claude Code, Codex) are watched here and
// show up live, like `server/plugin.ts`'s watcher does for the local app. On connect, the folder
// gets the /recreate skill and an AGENTS.md, so an assistant opened there knows the workflow.

import skill from '../../.claude/skills/recreate/SKILL.md?raw'
import { api } from '../api'
import type { Region, Segment } from '../../shared/types.ts'
import { getState, setState, toast, toggleSidebar } from '../store'

/** Website build (and `pnpm dev:web`): boards live in a folder the user picks. The local app never uses one. */
export const FOLDER_ONLY = import.meta.env.VITE_FOLDER_ONLY === '1'
export const folderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

export type OnboardingStep = 'welcome' | 'reconnect' | 'gone' | 'ready' | 'claude' | 'repo'

/** A folder in the switcher: its name as shown (the folder's own, or the repo's for a design folder inside one). */
export interface FolderEntry {
  id: string
  name: string
  /** moved or deleted since it was added */
  missing?: boolean
}

export interface FolderInfo {
  name: string
  /** The folder is itself one board (it has a board.json). */
  single: boolean
  /** Whether the Claude/Codex instructions are in the folder (false when we left the user's own alone). */
  assistant: boolean
  /** Where it really is, for prompts to Claude (a repo's design folder: "client-app/design"). Never shown as the name. */
  path?: string
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

// ── the folder list ─────────────────────────────────────
// Every folder connected on this site, so a designer can keep one per project (a repo's design
// folder) and switch between them. Kept in IndexedDB and shared by every tab: a change re-reads
// the list first and tells the other tabs. Each tab has its own open folder, which it tells the
// service worker (by id); 'root' remembers the last one opened, for the next visit.

// `missing`: found moved or deleted (kept with the list: after a reload it can't be checked without a click).
// `used`: when it was last opened, to offer the most recent one when the open folder goes away.
type Saved = { id: string; name: string; path?: string; handle: Dir; missing?: boolean; used?: number }
let saved: Saved[] = []

let root: Dir | null = null
let rootId: string | null = null
/** The connected folder (website), for the features that read and write it from the page (src/folder/files.ts). */
export const folderRoot = () => root

function publish() {
  setState({ folders: saved.map(({ id, name, missing }) => ({ id, name, missing })), folderId: rootId })
}

const listChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('moshboard-folders')
listChannel?.addEventListener('message', async () => {
  saved = (await idbGet<Saved[]>('folders')) ?? []
  const open = saved.find((f) => f.id === rootId)
  if (open) setState((s) => ({ folder: s.folder && { ...s.folder, name: open.name } }))
  publish()
})

/** Changes the list: re-read (another tab may have changed it), change, save, tell the other tabs. */
async function change(edit: (list: Saved[]) => Saved[]) {
  saved = edit((await idbGet<Saved[]>('folders')) ?? saved)
  await idbSet('folders', saved)
  listChannel?.postMessage('changed')
  publish()
}
const byId = (id: string | null) => saved.find((f) => f.id === id)
const patch = (id: string, p: Partial<Saved>) => change((list) => list.map((f) => (f.id === id ? { ...f, ...p } : f)))

/** The list, from before there was one: the single folder this site knew becomes its first entry. */
async function loadSaved() {
  saved = (await idbGet<Saved[]>('folders')) ?? []
  if (!saved.length) {
    const one = await idbGet<Dir>('root')
    if (one) await change(() => [{ id: newFolderId(), name: one.name, handle: one }])
  }
}
const newFolderId = () => Math.random().toString(36).slice(2, 8)
/** The other folders that can still be opened, most recently used first. */
const others = () => saved.filter((f) => f.id !== rootId && !f.missing).sort((a, b) => (b.used ?? 0) - (a.used ?? 0))
/** The folder to offer when the open one is gone. */
export const recentFolder = () => {
  const f = others()[0]
  return f && { id: f.id, name: f.name }
}

async function findSame(dir: Dir) {
  for (const f of saved) if (await f.handle.isSameEntry(dir).catch(() => false)) return f
}

// ── service worker ──────────────────────────────────────

/** Tells the worker which folder this tab has open (null: none), and waits until it knows. */
async function tellWorker(id: string | null) {
  const sw = navigator.serviceWorker
  await sw.register('/folder-sw.js', { scope: '/' })
  const reg = await sw.ready
  // A hard reload loads the page without the worker; ask it to take over.
  if (!sw.controller) {
    const claimed = new Promise((r) => sw.addEventListener('controllerchange', r, { once: true }))
    reg.active?.postMessage({ type: 'claim' })
    await claimed
  }
  const { port1, port2 } = new MessageChannel()
  const known = new Promise((r) => {
    port1.onmessage = r
    setTimeout(r, 1000)
  })
  sw.controller?.postMessage({ type: 'folder', id }, [port2])
  await known
}

// ── connecting ──────────────────────────────────────────

/** The folder as people read it in toasts and copied prompts, and where a board sits in it. */
export function boardsLabel() {
  const f = getState().folder
  return f?.path ?? f?.name ?? __BOARDS__
}
export function boardLabel(board: string) {
  const f = getState().folder
  return f?.single ? boardsLabel() : `${boardsLabel()}/${board}`
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
  // The local app always uses the boards next to its server. Drop a worker left from a website test.
  if (!FOLDER_ONLY) {
    navigator.serviceWorker?.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()))
    return true
  }
  window.addEventListener('mb:reconnect', () => setState({ onboarding: 'reconnect' }))
  window.addEventListener('mb:folder-gone', () => folderGone())
  await loadSaved()
  const last = await idbGet<Dir>('root')
  // The last one opened (none, e.g. it was deleted: the first in the list).
  const open = (last ? await findSame(last) : undefined) ?? saved[0]
  if (open) {
    rootId = open.id
    publish()
    if ((await open.handle.queryPermission({ mode: 'readwrite' })) === 'granted') {
      if (await isGone(open.handle)) {
        await folderGone(open.name)
        return false
      }
      await activate(open)
      return true
    }
    setState({ folder: { name: open.name, single: false, assistant: false }, onboarding: 'reconnect' })
    return false
  }
  publish()
  setState({ onboarding: 'welcome' })
  return false
}

// The features the local server does with the disk and ffmpeg run in the page instead (features.ts).
let installed = false
function useFolderFeatures() {
  if (installed) return
  installed = true
  const load = () => import('./features')
  Object.assign(api, {
    exportBoard: (b: string, ids?: string[]) => load().then((m) => m.exportInFolder(b, ids)),
    analyze: (b: string, id: string, src: string, segment?: Segment, region?: Region) => load().then((m) => m.analyzeInFolder(b, id, src, segment, region)),
    gifToVideo: (b: string, src: string) => load().then(async (m) => ({ path: await m.gifToVideoInFolder(b, src) })),
    sweep: (b: string) => load().then((m) => m.sweepInFolder(b)),
  } satisfies Partial<typeof api>)
}

async function activate(entry: Saved) {
  root = entry.handle
  rootId = entry.id
  useFolderFeatures()
  await idbSet('root', entry.handle)
  await tellWorker(entry.id)
  const assistant = await installAssistant(entry.handle)
  setState({ folder: { name: entry.name, path: entry.path, single: await isSingle(entry.handle), assistant } })
  publish()
  watch(entry.handle)
}

/** Adds a folder to the list (once: picking one already there just opens it) and opens it. */
async function addAndOpen(dir: Dir, name: string, path?: string) {
  saved = (await idbGet<Saved[]>('folders')) ?? saved
  const known = await findSame(dir)
  const id = known?.id ?? newFolderId()
  if (known) await patch(id, { missing: undefined })
  else await change((list) => [...list, { id, name, path, handle: dir }])
  if (id === rootId) return setState({ onboarding: null })
  // The setup screens are for the first folder only; more folders just open.
  const firstEver = !known && saved.length === 1
  // A first folder is a fresh start: the side nav stays closed through setup and onto the canvas,
  // until it's opened (even if it was left open before, e.g. the last folder was removed).
  if (firstEver) toggleSidebar(false)
  await openFolder(id, firstEver)
  if (!known && !firstEver) toast(`Added “${name}”`)
}

/** Closes the open canvas (saving it first, into its own folder) and opens a folder's boards. */
async function openFolder(id: string, first: boolean) {
  await patch(id, { used: Date.now() })
  const entry = byId(id)
  if (!entry) return
  const { flushSave } = await import('../store')
  await flushSave().catch(() => {})
  stopWatching()
  setState({ board: null, boardName: '', canvases: [], files: {}, overrides: {}, selected: [], interact: null })
  history.replaceState(null, '', location.pathname)
  await activate(entry)
  await openBoards()
  setState({ onboarding: first ? 'ready' : null })
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
  // A repo (it has .git): boards go in a design folder inside it, not all over the repo. One
  // that's already there is used; otherwise the designer is asked (the 'repo' step).
  if (!(await isSingle(dir)) && (await hasEntry(dir, '.git'))) {
    if (await hasEntry(dir, 'design')) return addAndOpen((await dir.getDirectoryHandle('design')) as Dir, dir.name, `${dir.name}/design`)
    pendingRepo = dir
    return setState({ onboarding: 'repo' })
  }
  await addAndOpen(dir, dir.name)
}

let pendingRepo: Dir | null = null
/** The folder being asked about in the 'repo' step. */
export const pendingRepoName = () => pendingRepo?.name ?? ''

/** The 'repo' step's answer: a design folder inside the repo (named after the repo), or the repo itself. */
export async function answerRepo(inDesignFolder: boolean) {
  const repo = pendingRepo
  if (!repo) return
  pendingRepo = null
  const dir = inDesignFolder ? ((await repo.getDirectoryHandle('design', { create: true })) as Dir) : repo
  await addAndOpen(dir, repo.name, inDesignFolder ? `${repo.name}/design` : undefined)
}

async function hasEntry(dir: Dir, name: string) {
  for await (const [n] of dir.entries()) if (n === name) return true
  return false
}

/** Opens another folder from the list. Chrome may ask for access again: this needs a click. */
export async function switchFolder(id: string) {
  const entry = byId(id)
  if (!entry || id === rootId) return
  const perm = await entry.handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied' as Perm)
  // (Chrome may refuse a folder that no longer exists: that still counts as gone, not as "no".)
  if (await isGone(entry.handle)) {
    // Already marked and still gone: the click takes it off the list.
    if (entry.missing) {
      await removeFolder(id)
      return toast(`“${entry.name}” is gone. Removed from the list`)
    }
    await patch(id, { missing: true })
    return toast('That folder was moved or deleted', true)
  }
  if (perm !== 'granted') return
  // Back where it was.
  if (entry.missing) await patch(id, { missing: undefined })
  await openFolder(id, false)
}

/** Takes a folder off the list (nothing in it is touched). Removing the open one opens another, or the picker. */
export async function removeFolder(id: string) {
  await change((list) => list.filter((f) => f.id !== id))
  if (id !== rootId) return
  const next = others()[0]
  if (next && (await next.handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied')) === 'granted' && !(await isGone(next.handle)))
    return openFolder(next.id, false)
  await closeFolder()
  setState({ folder: null, onboarding: 'welcome' })
}

/** No folder open in this tab. */
async function closeFolder() {
  stopWatching()
  root = null
  rootId = null
  await idbDel('root')
  await tellWorker(null).catch(() => {})
  history.replaceState(null, '', location.pathname)
  setState({ board: null, canvases: [], selected: [] })
  publish()
}

/** The name shown for a folder in the list (two folders can share one). */
export async function renameFolder(id: string, name: string) {
  if (!name.trim()) return
  await patch(id, { name: name.trim() })
  if (id === rootId) setState((s) => ({ folder: s.folder && { ...s.folder, name: name.trim() } }))
}

/** "Reconnect": Chrome asks again for the folder it already knows. Needs a click. */
export async function reconnectFolder() {
  const last = await idbGet<Dir>('root')
  let entry = byId(rootId) ?? (last ? await findSame(last) : undefined)
  if (!entry && last) {
    const id = newFolderId()
    await change((list) => [...list, { id, name: last.name, handle: last }])
    entry = byId(id)
  }
  if (!entry) return setState({ onboarding: 'welcome' })
  if ((await entry.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return
  const first = !root
  await activate(entry)
  setState({ onboarding: null })
  if (first) await openBoards()
  else {
    const { loadBoard } = await import('../actions')
    await loadBoard(getState().boardName)
  }
}

async function isGone(dir: Dir) {
  try {
    for await (const _ of dir.entries()) break
    return false
  } catch (err) {
    return (err as DOMException).name === 'NotFoundError'
  }
}

/**
 * The open folder was deleted or moved: forget it, and open another one or go back to picking.
 * The watcher and a failed request can both report it, at once or late: one run at a time, and
 * only while the open folder really is gone.
 */
let goneRun: Promise<void> | null = null
function folderGone(name?: string) {
  return (goneRun ??= handleGone(name).finally(() => (goneRun = null)))
}
async function handleGone(name = getState().folder?.name ?? '') {
  if (getState().onboarding === 'gone') return
  if (root && !(await isGone(root))) return
  stopWatching()
  const gone = rootId
  if (gone) await change((list) => list.filter((f) => f.id !== gone))
  rootId = null
  root = null
  // Another folder Chrome still lets us use (no click needed): just open it.
  for (const f of others()) {
    if ((await f.handle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied')) !== 'granted' || (await isGone(f.handle))) continue
    await openFolder(f.id, false)
    return toast(`“${name}” was moved or deleted. Opened “${f.name}”`, true)
  }
  await closeFolder()
  setState({ folder: { name, single: false, assistant: false }, onboarding: 'gone' })
}

// ── watching ────────────────────────────────────────────

type Change = { board: string; file: string }
const listeners = new Set<(c: Change) => void>()
/** Files changed on disk by something other than the app (Claude Code, Codex, a text editor). */
export function onFolderChange(f: (c: Change) => void) {
  listeners.add(f)
  return () => listeners.delete(f)
}

// What this tab itself recently wrote (the worker tells only the tab that saved), so its own saves
// aren't reported back as outside edits. A few per file: saves can land on disk after the next one
// was already sent.
const own = new Map<string, string[]>()
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type !== 'own') return
  const key = `${e.data.board}/${e.data.file}`
  own.set(key, [e.data.text, ...(own.get(key) ?? [])].slice(0, 3))
})

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
      // The folder was forgotten in the meantime (it was deleted): nothing to reload.
      if (root !== dir) return
      const parts = getState().folder?.single ? change.file.split('/') : key.split('/')
      let text: string | null = null
      try {
        text = await (await readRel(dir, parts)).text()
      } catch {
        // deleted
      }
      if (text !== null && own.get(key)?.includes(text)) return
      if (text === null && (await isGone(dir))) return void folderGone()
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
        // The folder itself went away (deleted, or moved out from under us).
        if (r.type === 'disappeared' && !r.relativePathComponents.length) return void folderGone()
        const change = locate(r.relativePathComponents)
        if (change) report(dir, change)
        // The observer lost track (too many changes at once): reread the open board.
        else if (r.type === 'errored' || r.type === 'unknown') report(dir, { board: getState().boardName, file: 'board.json' })
      }
    })
    // Watching can fail to start (e.g. a folder Chrome won't observe): check by polling instead.
    observer.observe(dir, { recursive: true }).catch(() => watchByPolling(dir))
    stopWatching = () => observer.disconnect()
    return
  }
  watchByPolling(dir)
}

/** No observer in this browser: check the open board's files every second or so. */
function watchByPolling(dir: Dir) {
  stopWatching()
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
        // not there (yet), or the whole folder is gone
        if (await isGone(dir)) return void folderGone()
      }
    }
  }, 1200)
  stopWatching = () => clearInterval(timer)
}

// ── Claude Code / Codex instructions ────────────────────

const AGENTS = `# Moshboard

This folder holds Moshboard boards: a moodboard where references can be live (videos, websites,
sounds, runnable components). Each board is a folder with a \`board.json\`, \`frames/\` (code frame
sources) and \`assets/\` (uploads and analysis). The app watches these files, so edits show up live.
\`board.json\`'s \`comments\` are the user's own review notes, pinned on blocks (\`on\` is the frame id).
When asked to address them, make the change, then set \`"resolved": true\` on each one handled.

To recreate a reference as a tunable code frame (\`/recreate <board> <frameId>\`), follow
\`.claude/skills/recreate/SKILL.md\`.

To capture a website's motion, snapshot a site, or read its fonts, follow
\`.claude/skills/moshboard-site/SKILL.md\` (it runs a script with the installed Chrome).
`

const FILES: [string, string][] = [
  ['.claude/skills/recreate/SKILL.md', skill],
  ['AGENTS.md', AGENTS],
]

/** The live-site tools and their skill, built by scripts/build-tools.ts and served with the site. */
async function siteTools(): Promise<[string, string][]> {
  const get = (name: string) => fetch(`/tools/${name}`).then((r) => (r.ok ? r.text() : Promise.reject()))
  try {
    const [skillText, script] = await Promise.all([get('SKILL.md'), get('moshboard-tools.mjs')])
    return [
      ['.claude/skills/moshboard-site/SKILL.md', skillText],
      ['.claude/skills/moshboard-site/moshboard-tools.mjs', script],
      // The browser driver it sets up on first run stays out of git.
      ['.claude/skills/moshboard-site/.gitignore', '.deps/\n'],
    ]
  } catch {
    return []
  }
}

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
  for (const [rel, content] of [...FILES, ...(FOLDER_ONLY ? await siteTools() : [])]) {
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
