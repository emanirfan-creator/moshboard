// Folder mode: boards live in a folder on the user's computer, picked in the browser.
//
// This service worker answers the app's `/api/…` and `/media/…` requests from that folder, the
// way `server/plugin.ts` answers them from disk in the local app, so the rest of the client
// doesn't know the difference. The folder's handle is kept in IndexedDB by `src/folder/folder.ts`.
// With no folder connected every request goes to the network as usual.

const NAME_RE = /^[\w-]+$/
const TRASH = '.trash'
const DB = 'moshboard'
const STORE = 'kv'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// Each tab has its own folder open (src/folder/folder.ts tells us which, by its id in the
// 'folders' list). Kept in IndexedDB too: the worker can be stopped and restarted at any time.
const tabFolder = new Map()
self.addEventListener('message', (e) => {
  if (e.data?.type === 'folder') e.waitUntil(setTabFolder(e.source?.id, e.data.id ?? null).then(() => e.ports[0]?.postMessage('ok')))
  // A hard reload loads the page without a worker; the page asks to be taken over.
  if (e.data?.type === 'claim') self.clients.claim()
})

async function setTabFolder(clientId, id) {
  if (id) handles.delete(id)
  lastRoot = undefined
  if (!clientId) return
  tabFolder.set(clientId, id)
  const open = new Set((await self.clients.matchAll()).map((c) => c.id))
  const saved = (await idbGet('tabFolders')) ?? {}
  const next = { [clientId]: id }
  for (const [c, f] of Object.entries(saved)) if (open.has(c) && c !== clientId) next[c] = f
  await idbSet('tabFolders', next)
}

// One connection for the worker's life, opened on first use (again if the browser closes it).
let db
function idb() {
  db ??= new Promise((resolve) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => {
      db = undefined
      resolve(null)
    }
    open.onsuccess = () => {
      open.result.onclose = open.result.onversionchange = () => {
        open.result.close()
        db = undefined
      }
      resolve(open.result)
    }
  })
  return db
}

async function idbSet(key, value) {
  const d = await idb()
  if (!d) return
  await new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = tx.onerror = tx.onabort = () => resolve()
  })
}

async function idbGet(key) {
  const d = await idb()
  if (!d) return undefined
  return new Promise((resolve) => {
    const get = d.transaction(STORE).objectStore(STORE).get(key)
    get.onsuccess = () => resolve(get.result)
    get.onerror = () => resolve(undefined)
  })
}

// Folder id → its handle, until a tab opens that folder again.
const handles = new Map()
// The last folder opened, for requests from tabs that never said (until a tab says).
let lastRoot

/** The folder of the tab that asked (a request with no tab, or from a tab that never said: the last one opened). */
async function folder(clientId) {
  let id = tabFolder.get(clientId)
  if (id === undefined && clientId) {
    id = ((await idbGet('tabFolders')) ?? {})[clientId]
    if (id !== undefined) tabFolder.set(clientId, id)
  }
  if (id === null) return null
  if (id === undefined) return (lastRoot ??= idbGet('root').then((h) => h ?? null))
  if (!handles.has(id)) handles.set(id, ((await idbGet('folders')) ?? []).find((f) => f.id === id)?.handle ?? null)
  return handles.get(id)
}

// Requests the local server answers without touching boards: they still go to the network.
const STATELESS = new Set(['tailwind', 'registry', 'embeddable', 'site-fonts', 'fonts', 'media-find', 'media-proxy'])
// Features that still need the local app (ffmpeg, a browser it drives, the disk).
const LOCAL_ONLY = {
  analyze: 'Motion analysis',
  pick: 'Capture motion',
  capture: 'Capture motion',
  snapshot: 'Site snapshots',
  'gif-to-video': 'GIF to video',
  export: 'Export',
  reveal: 'Show in Finder',
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (url.origin !== location.origin) return
  const [top, kind] = url.pathname.split('/').filter(Boolean)
  if (top !== 'media' && top !== 'api') return
  if (top === 'api' && STATELESS.has(kind)) return
  e.respondWith(
    folder(e.clientId).then((dir) => {
      if (!dir) return fetch(e.request)
      return route(dir, e.request, url, e.clientId).catch(async (err) => {
        // The folder itself was deleted or moved: the page goes back to "Pick a home for your boards".
        if (err?.name === 'NotFoundError' && (await gone(dir))) return json({ error: 'Your folder is gone', folderGone: true }, 410)
        const status = err instanceof HttpError ? err.status : 500
        return json({ error: err instanceof Error ? err.message : String(err), ...(err.extra ?? {}) }, status)
      })
    }),
  )
})

async function gone(dir) {
  try {
    for await (const _ of dir.keys()) break
    return false
  } catch (err) {
    return err?.name === 'NotFoundError'
  }
}

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  json: 'application/json',
  html: 'text/html; charset=utf-8',
  tsx: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
}

const slugOf = (title) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'canvas'

async function exists(dir, name, kind = 'file') {
  try {
    await (kind === 'file' ? dir.getFileHandle(name) : dir.getDirectoryHandle(name))
    return true
  } catch {
    return false
  }
}

// A folder that is itself one board (it has a board.json) holds just that board. Asked on every
// request, so the answer is kept for a moment.
const singles = new WeakMap()
async function singleBoard(dir) {
  const hit = singles.get(dir)
  if (hit && performance.now() - hit.at < 3000) return hit.id
  const id = (await exists(dir, 'board.json')) ? slugOf(dir.name) : null
  singles.set(dir, { id, at: performance.now() })
  return id
}

async function boardDir(dir, board, create = false) {
  if (!NAME_RE.test(board)) throw new HttpError(400, `bad board name: ${board}`)
  if ((await singleBoard(dir)) === board) return dir
  try {
    return await subdir(dir, [board], create)
  } catch {
    throw new HttpError(404, 'canvas not found')
  }
}

// Folder handles by path under a handle, so a board's images don't each walk the path from the
// top (every step is a trip to the browser's file system). Handles follow their path, except
// after move(): a board moved to the trash forgets its folder's handles (see DELETE). Should a
// kept one still fail, fileHandle walks the path afresh.
const dirCache = new WeakMap()
async function subdir(dir, parts, create = false) {
  if (!parts.length) return dir
  let known = dirCache.get(dir)
  if (!known) dirCache.set(dir, (known = new Map()))
  const key = parts.join('/')
  let d = known.get(key)
  if (!d) {
    d = (async () => (await subdir(dir, parts.slice(0, -1), create)).getDirectoryHandle(parts[parts.length - 1], { create }))()
    known.set(key, d)
    d.catch(() => known.get(key) === d && known.delete(key))
  }
  return d
}
const forgetDirs = (dir) => dirCache.delete(dir)

function splitPath(rel) {
  const parts = rel.split('/').filter(Boolean)
  if (!parts.length || parts.some((p) => p === '..' || p === '.')) throw new HttpError(400, 'path escapes board')
  return parts
}

async function fileHandle(dir, rel, create = false) {
  const parts = splitPath(rel)
  const name = parts[parts.length - 1]
  try {
    return await (await subdir(dir, parts.slice(0, -1), create)).getFileHandle(name, { create })
  } catch {
    // Usually the file just isn't there; walking the path afresh tells that from a stale handle.
    try {
      let d = dir
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create })
      const h = await d.getFileHandle(name, { create })
      forgetDirs(dir)
      return h
    } catch (err) {
      if (create) throw err
      throw new HttpError(404, 'not found')
    }
  }
}

async function readText(dir, rel) {
  return (await (await fileHandle(dir, rel)).getFile()).text()
}

// Writes to one file finish in the order they were asked for: two saves of board.json close in
// that order, so the newest one is what ends up on disk.
const writing = new Map()
function write(dir, rel, data) {
  const key = `${dir.name}/${rel}`
  const run = (writing.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const w = await (await fileHandle(dir, rel, true)).createWritable()
    await w.write(data)
    await w.close()
  })
  writing.set(key, run)
  run.then(
    () => writing.get(key) === run && writing.delete(key),
    () => writing.get(key) === run && writing.delete(key),
  )
  return run
}

/**
 * Writes a board's text file and tells the tab that saved it, so its watcher doesn't echo the
 * save back. Only that tab: another tab with the board open should see the change and reload.
 */
async function writeOwn(dir, board, rel, text, clientId) {
  if (clientId) self.clients.get(clientId).then((c) => c?.postMessage({ type: 'own', board, file: rel, text }))
  await write(dir, rel, text)
}

async function remove(dir, rel) {
  const parts = splitPath(rel)
  let d = dir
  try {
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p)
    await d.removeEntry(parts[parts.length - 1])
  } catch {
    // already gone
  }
}

async function copyDir(from, to, skip = () => false) {
  for await (const [name, h] of from.entries()) {
    if (skip(name)) continue
    if (h.kind === 'directory') await copyDir(h, await to.getDirectoryHandle(name, { create: true }))
    else {
      const w = await (await to.getFileHandle(name, { create: true })).createWritable()
      await w.write(await h.getFile())
      await w.close()
    }
  }
}

async function readBoard(dir) {
  return JSON.parse(await readText(dir, 'board.json'))
}

const boardText = (b) => JSON.stringify(b, null, 2) + '\n'

// Each canvas as the list shows it, kept until its board.json changes: the list is asked for again
// whenever a canvas is saved from outside, and reading every board each time adds up.
const listed = new Map()
async function listing(id, d) {
  let name = id
  let frames = 0
  try {
    const file = await (await fileHandle(d, 'board.json')).getFile()
    const key = `${d.name}:${id}`
    const hit = listed.get(key)
    if (hit && hit.modified === file.lastModified && hit.size === file.size) return hit.entry
    const b = JSON.parse(await file.text())
    name = b.name || id
    frames = b.frames.length
    const entry = { id, name, frames, created: 0 }
    listed.set(key, { modified: file.lastModified, size: file.size, entry })
    return entry
  } catch {
    // missing or invalid board.json: still list it
  }
  return { id, name, frames, created: 0 }
}

async function listBoards(root) {
  const single = await singleBoard(root)
  const dirs = []
  if (single) dirs.push([single, root])
  else for await (const [name, h] of root.entries()) if (h.kind === 'directory' && NAME_RE.test(name)) dirs.push([name, h])
  const list = await Promise.all(dirs.map(([id, d]) => listing(id, d)))
  // Folders don't record when they were made, so the list is alphabetical.
  return list.sort((a, b) => a.name.localeCompare(b.name))
}

async function freeBoardId(root, title) {
  const base = slugOf(title)
  let id = base
  for (let i = 2; await exists(root, id, 'directory'); i++) id = `${base}-${i}`
  return id
}

async function createBoard(root, title, clientId) {
  const id = await freeBoardId(root, title)
  const dir = await root.getDirectoryHandle(id, { create: true })
  await dir.getDirectoryHandle('frames', { create: true })
  await dir.getDirectoryHandle('assets', { create: true })
  await writeOwn(dir, id, 'board.json', boardText({ name: title, frames: [] }), clientId)
  return { id, name: title }
}

function uniqueAsset(original) {
  const dot = original.lastIndexOf('.')
  const ext = dot > 0 ? original.slice(dot).toLowerCase() : '.bin'
  const base =
    (dot > 0 ? original.slice(0, dot) : original)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'asset'
  return `assets/${base}-${Math.random().toString(36).slice(2, 6)}${ext}`
}

const MEDIA_EXT = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/flac': '.flac',
}

/** Downloads a found piece (straight from its host when it allows that, else through api/media-proxy) into assets/. */
async function saveMedia(dir, item, title) {
  let blob
  try {
    const r = await fetch(item.url, { mode: 'cors' })
    if (r.ok) blob = await r.blob()
  } catch {
    // the host doesn't allow browsers to download it
  }
  if (!blob) {
    const r = await fetch(`/api/media-proxy?url=${encodeURIComponent(item.url)}`)
    if (!r.ok) throw new HttpError(r.status, (await r.json().catch(() => ({}))).error ?? `Download failed (${r.status})`)
    blob = await r.blob()
  }
  const type = blob.type.split(';')[0]
  const ext = MEDIA_EXT[type] ?? /\.(mp4|webm|mov|m4v|jpe?g|png|gif|webp|avif|mp3|wav|m4a|aac|ogg|oga|opus|flac)(?=$|\?)/i.exec(item.url)?.[0].toLowerCase()
  if (!ext) throw new HttpError(415, `That link isn’t an image, video or sound (${type || 'unknown type'})`)
  const rel = uniqueAsset(`${item.title ?? title ?? 'media'}${ext}`)
  await write(dir, rel, blob)
  const kind = type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac)$/i.test(ext) ? 'audio' : type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/.test(ext) ? 'video' : 'image'
  let { width, height } = item
  if (kind === 'image' && !width) {
    try {
      const bmp = await createImageBitmap(blob)
      ;({ width, height } = bmp)
      bmp.close()
    } catch {
      // size unknown: the block uses a default
    }
  }
  return { path: rel, type: kind, width, height }
}

const THUMB_SIZES = [320, 640, 1280, 2048]
const thumbJobs = new Map()
// Images already no wider than a size: served as they are without decoding them again.
const smallEnough = new Map()
// Decoding a big screenshot takes a lot of memory: a few at a time, not a whole board at once.
let decoding = 0
const decodeQueue = []
async function decodeSlot(run) {
  if (decoding >= 3) await new Promise((r) => decodeQueue.push(r))
  decoding++
  try {
    return await run()
  } finally {
    decoding--
    decodeQueue.shift()?.()
  }
}

/** A resized copy in assets/.thumbs (JPEG, or PNG for PNGs to keep transparency), as the local server makes them. Falls back to the original. */
function thumbnail(dir, rel, want) {
  const w = THUMB_SIZES.find((s) => s >= want) ?? THUMB_SIZES[THUMB_SIZES.length - 1]
  const png = /\.png$/i.test(rel)
  const folder = rel.split('/').slice(0, -1).join('/')
  const name = rel.split('/').pop().replace(/\.\w+$/, '')
  const out = `${folder ? folder + '/' : ''}.thumbs/${name}-w${w}.${png ? 'png' : 'jpg'}`
  const key = `${dir.name}/${out}`
  let job = thumbJobs.get(key)
  if (!job) {
    job = makeThumb(dir, rel, out, w, png)
      .catch(() => rel)
      .finally(() => thumbJobs.delete(key))
    thumbJobs.set(key, job)
  }
  return job
}

async function makeThumb(dir, rel, out, w, png) {
  const src = await (await fileHandle(dir, rel)).getFile()
  try {
    const have = await (await fileHandle(dir, out)).getFile()
    if (have.lastModified >= src.lastModified) return out
  } catch {
    // not made yet
  }
  const small = `${dir.name}/${rel}:${src.lastModified}`
  if (smallEnough.get(small) >= w) return rel
  const blob = await decodeSlot(async () => {
    const bmp = await createImageBitmap(src)
    if (bmp.width <= w) {
      smallEnough.set(small, bmp.width)
      bmp.close()
      return null
    }
    const h = Math.max(2, Math.round((bmp.height * w) / bmp.width / 2) * 2)
    const canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
    bmp.close()
    return canvas.convertToBlob(png ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.85 })
  })
  if (!blob) return rel
  await write(dir, out, blob)
  return out
}

async function serveFile(request, dir, rel) {
  const file = await (await fileHandle(dir, rel)).getFile()
  const ext = rel.split('.').pop().toLowerCase()
  const type = MIME[ext] ?? 'application/octet-stream'
  const size = file.size
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '')
  // Video seeking needs byte ranges.
  if (range) {
    let start = range[1] ? +range[1] : 0
    let end = range[2] ? +range[2] : size - 1
    if (!range[1] && range[2]) {
      start = size - +range[2]
      end = size - 1
    }
    end = Math.min(end, size - 1)
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      },
    })
  }
  return new Response(file, {
    headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' },
  })
}

// Access asked of the browser at most once every few seconds, not before every image.
const granted = new WeakMap()
async function permitted(root) {
  if (!root.queryPermission) return true
  const at = granted.get(root)
  if (at && performance.now() - at < 5000) return true
  const ok = (await root.queryPermission({ mode: 'readwrite' })) === 'granted'
  if (ok) granted.set(root, performance.now())
  else granted.delete(root)
  return ok
}

async function route(root, request, url, clientId) {
  // Chrome can take access back between visits; the page shows "Reconnect" for this.
  if (!(await permitted(root))) throw new HttpError(409, 'Reconnect your Moshboard folder', { reconnect: true })

  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const method = request.method

  if (parts[0] === 'media') {
    const [, board, ...rel] = parts
    const dir = await boardDir(root, board)
    const w = Number(url.searchParams.get('w'))
    // ?w=N: a resized copy of a large image, so the canvas doesn't decode a 4000px screenshot to show it 400px wide.
    if (w && /\.(png|jpe?g|webp|avif)$/i.test(rel.join('/'))) return serveFile(request, dir, await thumbnail(dir, rel.join('/'), w))
    return serveFile(request, dir, rel.join('/'))
  }
  const [, kind, board, ...rest] = parts
  const body = async () => {
    const text = await request.text()
    return text ? JSON.parse(text) : {}
  }

  if (kind in LOCAL_ONLY) throw new HttpError(501, `${LOCAL_ONLY[kind]} isn’t in the web version yet`)

  if (kind === 'boards' && method === 'GET') {
    let list = await listBoards(root)
    // First run in an empty folder: start with one canvas.
    if (!list.length) {
      await createBoard(root, 'Moodboard', clientId)
      list = await listBoards(root)
    }
    return json(list)
  }
  if (kind === 'boards' && method === 'POST' && board === 'sample')
    throw new HttpError(501, 'The example board isn’t in the web version yet')
  if (kind === 'boards' && method === 'POST') {
    if (await singleBoard(root)) throw new HttpError(400, 'This folder holds a single board. Open its parent folder to keep several.')
    const { name } = await body()
    return json(await createBoard(root, String(name ?? '').trim() || 'Untitled', clientId))
  }
  if (kind === 'board' && method === 'POST' && rest[0] === 'rename') {
    // The folder keeps its name; only the canvas name changes.
    const title = String((await body()).name ?? '').trim()
    if (!title) throw new HttpError(400, 'name required')
    const dir = await boardDir(root, board)
    await writeOwn(dir, board, 'board.json', boardText({ ...(await readBoard(dir)), name: title }), clientId)
    return json({ id: board, name: title })
  }
  if (kind === 'board' && method === 'POST' && rest[0] === 'sweep') {
    // Unused files stay put in folder mode for now.
    await boardDir(root, board)
    return json({ trashed: [], emptied: [] })
  }
  if (kind === 'board' && method === 'POST' && rest[0] === 'duplicate') {
    if (await singleBoard(root)) throw new HttpError(400, 'This folder holds a single board. Open its parent folder to keep several.')
    const src = await boardDir(root, board)
    let b = { name: board, frames: [] }
    try {
      b = await readBoard(src)
    } catch {
      // copies as an empty canvas, like it shows
    }
    const title = `${b.name || board} copy`
    const id = await freeBoardId(root, title)
    const dest = await root.getDirectoryHandle(id, { create: true })
    await copyDir(src, dest, (name) => name === 'export' || name === TRASH)
    await writeOwn(dest, id, 'board.json', boardText({ ...b, name: title }), clientId)
    return json({ id, name: title })
  }
  if (kind === 'board' && method === 'DELETE') {
    if ((await singleBoard(root)) === board) throw new HttpError(400, 'This board is the whole folder, so it can’t be deleted here')
    // Never hard-delete: move the folder to .trash so it can be recovered.
    const src = await boardDir(root, board)
    const trash = await root.getDirectoryHandle(TRASH, { create: true })
    const name = `${board}-${Date.now()}`
    forgetDirs(root)
    forgetDirs(src)
    try {
      // A move is instant; copying a board full of videos isn't.
      await src.move(trash, name)
    } catch {
      await copyDir(src, await trash.getDirectoryHandle(name, { create: true }))
      await root.removeEntry(board, { recursive: true })
    }
    return json({ ok: true })
  }
  if (kind === 'board' && method === 'GET') {
    let dir
    try {
      dir = await boardDir(root, board)
      // Sent as it is on disk (checked, not parsed and written out again).
      const text = await readText(dir, 'board.json')
      JSON.parse(text)
      return new Response(text, { headers: { 'Content-Type': 'application/json' } })
    } catch (err) {
      // A board folder without a board.json opens as an empty canvas.
      if (dir && err instanceof HttpError && err.status === 404) {
        const b = { name: board, frames: [] }
        await writeOwn(dir, board, 'board.json', boardText(b), clientId)
        return json(b)
      }
      if (dir) throw err
      // No such canvas (`default` on first open, or a stale address): point at the first one.
      const first = (await listBoards(root))[0]?.id ?? (await createBoard(root, 'Moodboard', clientId)).id
      throw new HttpError(404, 'canvas not found', { moved: first })
    }
  }
  if (kind === 'board' && method === 'PUT') {
    const dir = await boardDir(root, board)
    const text = await request.text()
    JSON.parse(text) // validate
    await writeOwn(dir, board, 'board.json', text.endsWith('\n') ? text : text + '\n', clientId)
    return json({ ok: true })
  }
  if (kind === 'file') {
    const dir = await boardDir(root, board)
    const rel = rest.join('/')
    if (method === 'GET')
      return new Response(await readText(dir, rel), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
      })
    if (method === 'PUT') {
      await writeOwn(dir, board, rel, await request.text(), clientId)
      return json({ ok: true })
    }
    if (method === 'DELETE') {
      await remove(dir, rel)
      return json({ ok: true })
    }
  }
  if (kind === 'upload' && method === 'POST') {
    const dir = await boardDir(root, board)
    const rel = uniqueAsset(url.searchParams.get('name') ?? 'upload')
    await write(dir, rel, await request.blob())
    return json({ path: rel })
  }
  if (kind === 'media-link' && method === 'POST') {
    // A pin, Cosmos element, Dribbble shot…: the server finds the media (api/media-find) and the
    // files are saved here, into the folder. Same answer as the local server's route.
    const dir = await boardDir(root, board)
    const link = String((await body()).url ?? '')
    const r = await fetch(`/api/media-find?url=${encodeURIComponent(link)}`)
    const found = await r.json().catch(() => ({}))
    if (!r.ok) throw new HttpError(r.status, found.error ?? `Couldn’t read that link (${r.status})`)
    const items = []
    for (const it of found.items) {
      try {
        items.push(await saveMedia(dir, it, found.title))
      } catch (err) {
        // A multi-piece project keeps the pieces that came through.
        if (found.items.length === 1) throw err
      }
    }
    if (!items.length) throw new HttpError(502, 'Couldn’t download any pieces from that project')
    return json({ ...items[0], title: found.title, source: found.source, ...(items.length > 1 ? { items } : {}) })
  }
  if (kind === 'copy-asset' && method === 'POST') {
    // Pasting frames from another canvas: bring their media along.
    const { from, src } = await body()
    const file = await (await fileHandle(await boardDir(root, String(from)), String(src))).getFile()
    const rel = uniqueAsset(String(src).split('/').pop())
    await write(await boardDir(root, board), rel, file)
    return json({ path: rel })
  }
  throw new HttpError(404, `no route: ${method} ${url.pathname}`)
}
