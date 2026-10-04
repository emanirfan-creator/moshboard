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
const changes = new BroadcastChannel('moshboard-folder')

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

let root = null
let rootLoaded = false
self.addEventListener('message', (e) => {
  if (e.data?.type === 'folder') rootLoaded = false
  // A hard reload loads the page without a worker; the page asks to be taken over.
  if (e.data?.type === 'claim') self.clients.claim()
})

function idbGet(key) {
  return new Promise((resolve) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => resolve(undefined)
    open.onsuccess = () => {
      const get = open.result.transaction(STORE).objectStore(STORE).get(key)
      get.onsuccess = () => resolve(get.result)
      get.onerror = () => resolve(undefined)
    }
  })
}

async function folder() {
  // With no folder yet, look again each time: one may have just been connected.
  if (!rootLoaded || !root) {
    root = (await idbGet('root')) ?? null
    rootLoaded = true
  }
  return root
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
    folder().then((dir) => {
      if (!dir) return fetch(e.request)
      return route(dir, e.request, url).catch(async (err) => {
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

// A folder that is itself one board (it has a board.json) holds just that board.
async function singleBoard(dir) {
  return (await exists(dir, 'board.json')) ? slugOf(dir.name) : null
}

async function boardDir(dir, board, create = false) {
  if (!NAME_RE.test(board)) throw new HttpError(400, `bad board name: ${board}`)
  if ((await singleBoard(dir)) === board) return dir
  try {
    return await dir.getDirectoryHandle(board, { create })
  } catch {
    throw new HttpError(404, 'canvas not found')
  }
}

function splitPath(rel) {
  const parts = rel.split('/').filter(Boolean)
  if (!parts.length || parts.some((p) => p === '..' || p === '.')) throw new HttpError(400, 'path escapes board')
  return parts
}

async function fileHandle(dir, rel, create = false) {
  const parts = splitPath(rel)
  let d = dir
  try {
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create })
    return await d.getFileHandle(parts[parts.length - 1], { create })
  } catch (err) {
    if (create) throw err
    throw new HttpError(404, 'not found')
  }
}

async function readText(dir, rel) {
  return (await (await fileHandle(dir, rel)).getFile()).text()
}

async function write(dir, rel, data) {
  const w = await (await fileHandle(dir, rel, true)).createWritable()
  await w.write(data)
  await w.close()
}

/** Writes a board's text file and tells the page, so its watcher doesn't echo the save back. */
async function writeOwn(dir, board, rel, text) {
  changes.postMessage({ type: 'own', board, file: rel, text })
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

async function listBoards(root) {
  const single = await singleBoard(root)
  const dirs = []
  if (single) dirs.push([single, root])
  else for await (const [name, h] of root.entries()) if (h.kind === 'directory' && NAME_RE.test(name)) dirs.push([name, h])
  const list = []
  for (const [id, d] of dirs) {
    let name = id
    let frames = 0
    try {
      const b = await readBoard(d)
      name = b.name || id
      frames = b.frames.length
    } catch {
      // missing or invalid board.json: still list it
    }
    list.push({ id, name, frames, created: 0 })
  }
  // Folders don't record when they were made, so the list is alphabetical.
  return list.sort((a, b) => a.name.localeCompare(b.name))
}

async function freeBoardId(root, title) {
  const base = slugOf(title)
  let id = base
  for (let i = 2; await exists(root, id, 'directory'); i++) id = `${base}-${i}`
  return id
}

async function createBoard(root, title) {
  const id = await freeBoardId(root, title)
  const dir = await root.getDirectoryHandle(id, { create: true })
  await dir.getDirectoryHandle('frames', { create: true })
  await dir.getDirectoryHandle('assets', { create: true })
  await writeOwn(dir, id, 'board.json', boardText({ name: title, frames: [] }))
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
  const ext = MEDIA_EXT[type] ?? /\.(mp4|webm|mov|m4v|jpe?g|png|gif|webp|avif)(?=$|\?)/i.exec(item.url)?.[0].toLowerCase()
  if (!ext) throw new HttpError(415, `That link isn’t an image or video (${type || 'unknown type'})`)
  const rel = uniqueAsset(`${item.title ?? title ?? 'media'}${ext}`)
  await write(dir, rel, blob)
  const kind = type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/.test(ext) ? 'video' : 'image'
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

async function route(root, request, url) {
  // Chrome can take access back between visits; the page shows "Reconnect" for this.
  if (root.queryPermission && (await root.queryPermission({ mode: 'readwrite' })) !== 'granted')
    throw new HttpError(409, 'Reconnect your Moshboard folder', { reconnect: true })

  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const method = request.method

  if (parts[0] === 'media') {
    const [, board, ...rel] = parts
    return serveFile(request, await boardDir(root, board), rel.join('/'))
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
      await createBoard(root, 'Moodboard')
      list = await listBoards(root)
    }
    return json(list)
  }
  if (kind === 'boards' && method === 'POST' && board === 'sample')
    throw new HttpError(501, 'The example board isn’t in the web version yet')
  if (kind === 'boards' && method === 'POST') {
    if (await singleBoard(root)) throw new HttpError(400, 'This folder holds a single board. Open its parent folder to keep several.')
    const { name } = await body()
    return json(await createBoard(root, String(name ?? '').trim() || 'Untitled'))
  }
  if (kind === 'board' && method === 'POST' && rest[0] === 'rename') {
    // The folder keeps its name; only the canvas name changes.
    const title = String((await body()).name ?? '').trim()
    if (!title) throw new HttpError(400, 'name required')
    const dir = await boardDir(root, board)
    await writeOwn(dir, board, 'board.json', boardText({ ...(await readBoard(dir)), name: title }))
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
    await writeOwn(dest, id, 'board.json', boardText({ ...b, name: title }))
    return json({ id, name: title })
  }
  if (kind === 'board' && method === 'DELETE') {
    if ((await singleBoard(root)) === board) throw new HttpError(400, 'This board is the whole folder, so it can’t be deleted here')
    // Never hard-delete: move the folder to .trash so it can be recovered.
    const src = await boardDir(root, board)
    const trash = await root.getDirectoryHandle(TRASH, { create: true })
    await copyDir(src, await trash.getDirectoryHandle(`${board}-${Date.now()}`, { create: true }))
    await root.removeEntry(board, { recursive: true })
    return json({ ok: true })
  }
  if (kind === 'board' && method === 'GET') {
    let dir
    try {
      dir = await boardDir(root, board)
      return json(await readBoard(dir))
    } catch (err) {
      // A board folder without a board.json opens as an empty canvas.
      if (dir && err instanceof HttpError && err.status === 404) {
        const b = { name: board, frames: [] }
        await writeOwn(dir, board, 'board.json', boardText(b))
        return json(b)
      }
      if (dir) throw err
      // No such canvas (`default` on first open, or a stale address): point at the first one.
      const first = (await listBoards(root))[0]?.id ?? (await createBoard(root, 'Moodboard')).id
      throw new HttpError(404, 'canvas not found', { moved: first })
    }
  }
  if (kind === 'board' && method === 'PUT') {
    const dir = await boardDir(root, board)
    const text = await request.text()
    JSON.parse(text) // validate
    await writeOwn(dir, board, 'board.json', text.endsWith('\n') ? text : text + '\n')
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
      await writeOwn(dir, board, rel, await request.text())
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
