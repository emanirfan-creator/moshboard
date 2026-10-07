import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'
import type { Board } from '../shared/types.ts'
import { analyzeVideo } from './analyze-video.ts'
import { BOARDS_DIR } from './boards-dir.ts'
import { exportBoard } from './export.ts'
import { listFonts } from './fonts.ts'
import { sweepBoard, TRASH } from './sweep.ts'

export { BOARDS_DIR }
const NAME_RE = /^[\w-]+$/

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

const THUMB_SIZES = [320, 640, 1280, 2048]
const thumbJobs = new Map<string, Promise<string>>()

/** Resized copy in assets/.thumbs (JPEG, or PNG for PNG sources to keep transparency). */
function thumbnail(abs: string, want: number): Promise<string> {
  const w = THUMB_SIZES.find((s) => s >= want) ?? THUMB_SIZES[THUMB_SIZES.length - 1]
  const png = /\.png$/i.test(abs)
  const out = path.join(path.dirname(abs), '.thumbs', `${path.basename(abs).replace(/\.\w+$/, '')}-w${w}.${png ? 'png' : 'jpg'}`)
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(abs).mtimeMs) return Promise.resolve(out)
  let job = thumbJobs.get(out)
  if (!job) {
    fs.mkdirSync(path.dirname(out), { recursive: true })
    job = new Promise<string>((resolve) => {
      const p = spawn('ffmpeg', ['-v', 'error', '-y', '-i', abs, '-vf', `scale='min(${w},iw)':-2`, ...(png ? [] : ['-q:v', '3']), out])
      // On any failure just serve the original.
      p.on('close', (code) => resolve(code === 0 && fs.existsSync(out) ? out : abs))
      p.on('error', () => resolve(abs))
    }).finally(() => thumbJobs.delete(out))
    thumbJobs.set(out, job)
  }
  return job
}

export function boardPath(board: string, ...rel: string[]) {
  if (!NAME_RE.test(board)) throw new HttpError(400, `bad board name: ${board}`)
  const dir = path.join(BOARDS_DIR, board)
  const p = path.resolve(dir, ...rel)
  if (p !== dir && !p.startsWith(dir + path.sep)) throw new HttpError(400, 'path escapes board')
  return p
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function serveFile(req: IncomingMessage, res: ServerResponse, abs: string) {
  const stat = fs.statSync(abs, { throwIfNoEntry: false })
  if (!stat?.isFile()) throw new HttpError(404, 'not found')
  const size = stat.size
  // `no-cache` still revalidates every load; the validator turns that into a 304 instead of
  // re-sending every video on the board.
  const etag = `"${size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`
  const cache = { ETag: etag, 'Last-Modified': stat.mtime.toUTCString(), 'Cache-Control': 'no-cache' }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, cache)
    res.end()
    return
  }
  const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream'
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  if (range) {
    let start = range[1] ? +range[1] : 0
    let end = range[2] ? +range[2] : size - 1
    if (!range[1] && range[2]) {
      start = size - +range[2]
      end = size - 1
    }
    end = Math.min(end, size - 1)
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      ...cache,
    })
    fs.createReadStream(abs, { start, end }).pipe(res)
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', ...cache })
    fs.createReadStream(abs).pipe(res)
  }
}

function ensureBoard(board: string): Board {
  const file = boardPath(board, 'board.json')
  if (!fs.existsSync(file)) {
    fs.mkdirSync(boardPath(board, 'frames'), { recursive: true })
    fs.mkdirSync(boardPath(board, 'assets'), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ name: board, frames: [] }, null, 2) + '\n')
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** Content we wrote ourselves, so the watcher doesn't echo our own saves back. */
const ownWrites = new Map<string, string>()
function writeOwn(abs: string, content: string) {
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  ownWrites.set(abs, content)
  fs.writeFileSync(abs, content)
}

function watchBoards(server: ViteDevServer) {
  fs.mkdirSync(BOARDS_DIR, { recursive: true })
  const pending = new Map<string, NodeJS.Timeout>()
  fs.watch(BOARDS_DIR, { recursive: true }, (_event, filename) => {
    if (!filename) return
    const rel = filename.split(path.sep)
    const [board, ...rest] = rel
    const file = rest.join('/')
    if (!board || !(file === 'board.json' || file.startsWith('frames/'))) return
    const abs = path.join(BOARDS_DIR, filename)
    clearTimeout(pending.get(abs))
    pending.set(
      abs,
      setTimeout(() => {
        pending.delete(abs)
        let content: string | null = null
        try {
          content = fs.readFileSync(abs, 'utf8')
        } catch {
          // deleted
        }
        if (content !== null && ownWrites.get(abs) === content) return
        ownWrites.delete(abs)
        server.ws.send({ type: 'custom', event: 'mb:change', data: { board, file } })
      }, 60),
    )
  })
}

function uniqueAsset(board: string, original: string) {
  const ext = path.extname(original).toLowerCase() || '.bin'
  const base =
    path
      .basename(original, path.extname(original))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'asset'
  return `assets/${base}-${Math.random().toString(36).slice(2, 6)}${ext}`
}

const slugOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'canvas'

/** A folder slug for a canvas name that no canvas uses yet ("Moodboard" → `moodboard`, then `moodboard-2`). */
function freeBoardId(title: string) {
  const base = slugOf(title)
  let id = base
  for (let i = 2; fs.existsSync(path.join(BOARDS_DIR, id)); i++) id = `${base}-${i}`
  return id
}

/** Copies the sample board (samples/starter) in as a new canvas and returns it. */
function addSample(): { id: string; name: string } {
  const src = path.resolve('samples/starter')
  const b: Board = JSON.parse(fs.readFileSync(path.join(src, 'board.json'), 'utf8'))
  const id = freeBoardId(b.name)
  fs.cpSync(src, path.join(BOARDS_DIR, id), { recursive: true })
  return { id, name: b.name }
}

// A renamed canvas moves to a folder named after it; its old address keeps working through this map.
const ALIASES = () => path.join(BOARDS_DIR, '.aliases.json')
function readAliases(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(ALIASES(), 'utf8'))
  } catch {
    return {}
  }
}
/** Where an old canvas address points now, if it moved. */
function movedTo(board: string) {
  const aliases = readAliases()
  let id = aliases[board]
  for (let i = 0; id && aliases[id] && i < 10; i++) id = aliases[id]
  return id && fs.existsSync(path.join(BOARDS_DIR, id, 'board.json')) ? id : undefined
}

/** Renames a canvas, and moves its folder so the address matches the name (`#moodboard-tester`). */
function renameBoard(board: string, title: string): { id: string; name: string } {
  const file = boardPath(board, 'board.json')
  if (!fs.existsSync(file)) throw new HttpError(404, 'canvas not found')
  const b: Board = JSON.parse(fs.readFileSync(file, 'utf8'))
  let id = board
  // `moodboard-2` named "Moodboard" already matches; only move when the slug would change.
  if (slugOf(title) !== board.replace(/-\d+$/, '')) {
    id = freeBoardId(title)
    fs.renameSync(boardPath(board), path.join(BOARDS_DIR, id))
    const aliases = readAliases()
    for (const k of Object.keys(aliases)) if (aliases[k] === board) aliases[k] = id
    aliases[board] = id
    delete aliases[id]
    fs.writeFileSync(ALIASES(), JSON.stringify(aliases, null, 2) + '\n')
  }
  writeOwn(boardPath(id, 'board.json'), JSON.stringify({ ...b, name: title }, null, 2) + '\n')
  return { id, name: title }
}

async function route(server: ViteDevServer, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://local')
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const method = req.method ?? 'GET'

  if (parts[0] === 'media') {
    const [, board, ...rel] = parts
    const w = Number(url.searchParams.get('w'))
    const abs = boardPath(board, ...rel)
    // ?w=N serves a resized copy of a large image (cached), so the canvas doesn't
    // decode a 4000px screenshot to show it 400px wide.
    if (w && /\.(png|jpe?g|webp|avif)$/i.test(abs) && fs.existsSync(abs)) {
      serveFile(req, res, await thumbnail(abs, w))
      return true
    }
    serveFile(req, res, abs)
    return true
  }
  if (parts[0] !== 'api') return false
  const [, kind, board, ...rest] = parts

  if (kind === 'boards' && method === 'GET') {
    fs.mkdirSync(BOARDS_DIR, { recursive: true })
    // First run: start with the sample board rather than an empty canvas.
    if (!fs.readdirSync(BOARDS_DIR).some((d) => NAME_RE.test(d)) && fs.existsSync('samples/starter')) addSample()
    const list = fs
      .readdirSync(BOARDS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && NAME_RE.test(d.name))
      .map((d) => {
        const file = boardPath(d.name, 'board.json')
        let name = d.name
        let frames = 0
        try {
          const b: Board = JSON.parse(fs.readFileSync(file, 'utf8'))
          name = b.name || d.name
          frames = b.frames.length
        } catch {
          // missing or invalid board.json: still list it
        }
        const created = fs.statSync(path.join(BOARDS_DIR, d.name)).birthtimeMs
        return { id: d.name, name, frames, created }
      })
      .sort((a, b) => a.created - b.created)
    json(res, list)
    return true
  }
  if (kind === 'boards' && method === 'POST' && board === 'sample') {
    json(res, addSample())
    return true
  }
  if (kind === 'boards' && method === 'POST') {
    // Create a canvas from a display name; the folder gets a unique slug.
    const { name } = JSON.parse((await readBody(req)).toString() || '{}')
    const title = String(name ?? '').trim() || 'Untitled'
    const id = freeBoardId(title)
    ensureBoard(id)
    const file = boardPath(id, 'board.json')
    writeOwn(file, JSON.stringify({ name: title, frames: [] }, null, 2) + '\n')
    json(res, { id, name: title })
    return true
  }
  if (kind === 'board' && method === 'POST' && rest[0] === 'rename') {
    const { name } = JSON.parse((await readBody(req)).toString() || '{}')
    const title = String(name ?? '').trim()
    if (!title) throw new HttpError(400, 'name required')
    json(res, renameBoard(board, title))
    return true
  }
  if (kind === 'board' && method === 'POST' && rest[0] === 'sweep') {
    if (!fs.existsSync(boardPath(board, 'board.json'))) throw new HttpError(404, 'canvas not found')
    json(res, sweepBoard(boardPath(board)))
    return true
  }
  if (kind === 'board' && method === 'POST' && rest[0] === 'duplicate') {
    // Copy the whole canvas folder (frames, code, uploads, analysis) under a new
    // slug. Paths in board.json are relative, so the copy stands on its own. The
    // export folder (generated output) and the trash are left behind.
    const src = boardPath(board)
    if (!fs.existsSync(src)) throw new HttpError(404, 'canvas not found')
    // A listed folder without a board.json copies as an empty canvas, like it shows.
    const file = path.join(src, 'board.json')
    const b: Board = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { name: board, frames: [] }
    const title = `${b.name || board} copy`
    const id = freeBoardId(title)
    const dest = path.join(BOARDS_DIR, id)
    fs.cpSync(src, dest, { recursive: true, filter: (p) => p !== path.join(src, 'export') && p !== path.join(src, TRASH) })
    writeOwn(path.join(dest, 'board.json'), JSON.stringify({ ...b, name: title }, null, 2) + '\n')
    json(res, { id, name: title })
    return true
  }
  if (kind === 'board' && method === 'DELETE') {
    // Never hard-delete: move the folder to boards/.trash so it can be recovered.
    const dir = boardPath(board)
    if (fs.existsSync(dir)) {
      const trash = path.join(BOARDS_DIR, '.trash')
      fs.mkdirSync(trash, { recursive: true })
      fs.renameSync(dir, path.join(trash, `${board}-${Date.now()}`))
    }
    json(res, { ok: true })
    return true
  }
  if (kind === 'board' && method === 'GET') {
    if (!fs.existsSync(boardPath(board, 'board.json'))) {
      // No `default` canvas: open an existing one, or on first run the sample board.
      let moved = movedTo(board)
      if (!moved && board === 'default') {
        fs.mkdirSync(BOARDS_DIR, { recursive: true })
        const ids = fs.readdirSync(BOARDS_DIR).filter((d) => NAME_RE.test(d) && fs.existsSync(path.join(BOARDS_DIR, d, 'board.json')))
        moved = ids[0] ?? (fs.existsSync('samples/starter') ? addSample().id : undefined)
      }
      if (moved) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'canvas moved', moved }))
        return true
      }
      // Only the default canvas is created on demand; a deleted canvas stays deleted.
      if (board !== 'default') throw new HttpError(404, 'canvas not found')
    }
    json(res, ensureBoard(board))
    return true
  }
  if (kind === 'board' && method === 'PUT') {
    if (!fs.existsSync(boardPath(board, 'board.json'))) throw new HttpError(404, 'canvas not found')
    const body = (await readBody(req)).toString()
    JSON.parse(body) // validate
    writeOwn(boardPath(board, 'board.json'), body.endsWith('\n') ? body : body + '\n')
    json(res, { ok: true })
    return true
  }
  if (kind === 'file') {
    const abs = boardPath(board, ...rest)
    if (method === 'GET') {
      if (!fs.existsSync(abs)) throw new HttpError(404, 'not found')
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' })
      res.end(fs.readFileSync(abs, 'utf8'))
    } else if (method === 'PUT') {
      writeOwn(abs, (await readBody(req)).toString())
      json(res, { ok: true })
    } else if (method === 'DELETE') {
      if (fs.existsSync(abs)) fs.rmSync(abs)
      json(res, { ok: true })
    }
    return true
  }
  if (kind === 'upload' && method === 'POST') {
    const rel = uniqueAsset(board, url.searchParams.get('name') ?? 'upload')
    const abs = boardPath(board, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, await readBody(req))
    const { gifToVideo } = await import('./gif.ts')
    const video = /\.gif$/i.test(rel) ? await gifToVideo(boardPath(board), rel) : null
    json(res, video ? { path: video, type: 'video' } : { path: rel })
    return true
  }
  if (kind === 'analyze' && method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString() || '{}')
    const result = await analyzeVideo(boardPath(board), String(body.src), String(rest[0]), body.segment, body.region)
    json(res, result)
    return true
  }
  if (kind === 'pick' && method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString() || '{}')
    const { pickTargets } = await import('./pick-element.ts')
    json(res, await pickTargets(boardPath(board), String(rest[0]), String(body.url)))
    return true
  }
  if (kind === 'capture' && method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString() || '{}')
    const { captureUrl } = await import('./capture-url.ts')
    json(res, await captureUrl(boardPath(board), String(rest[0]), body))
    return true
  }
  if (kind === 'copy-asset' && method === 'POST') {
    // Pasting frames from another canvas: bring their media along.
    const { from, src } = JSON.parse((await readBody(req)).toString() || '{}')
    const source = boardPath(String(from), String(src))
    if (!fs.existsSync(source)) throw new HttpError(404, 'asset not found')
    const rel = uniqueAsset(board, path.basename(source))
    fs.copyFileSync(source, boardPath(board, rel))
    json(res, { path: rel })
    return true
  }
  if (kind === 'gif-to-video' && method === 'POST') {
    const { src } = JSON.parse((await readBody(req)).toString() || '{}')
    const { gifToVideo } = await import('./gif.ts')
    json(res, { path: await gifToVideo(boardPath(board), String(src)) })
    return true
  }
  if (kind === 'media-link' && method === 'POST') {
    const { url: link } = JSON.parse((await readBody(req)).toString() || '{}')
    const { resolveMediaLink } = await import('./media-link.ts')
    json(res, await resolveMediaLink(boardPath(board), String(link)))
    return true
  }
  if ((kind === 'media-find' || kind === 'media-proxy') && method === 'GET') {
    // The website's functions (server/web), answered here too so folder mode works the same locally.
    const { default: run } = kind === 'media-find' ? await import('./web/media-find.ts') : await import('./web/media-proxy.ts')
    await run(req, res)
    return true
  }
  if (kind === 'embeddable' && method === 'GET') {
    const { checkEmbeddable } = await import('./snapshot.ts')
    json(res, await checkEmbeddable(String(url.searchParams.get('url'))))
    return true
  }
  if (kind === 'site-fonts' && method === 'POST') {
    const { url: href } = JSON.parse((await readBody(req)).toString() || '{}')
    const { siteFonts } = await import('./snapshot.ts')
    json(res, await siteFonts(String(href)))
    return true
  }
  if (kind === 'snapshot' && method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString() || '{}')
    const { snapshotUrl } = await import('./snapshot.ts')
    json(res, await snapshotUrl(boardPath(board), String(rest[0]), String(body.url), Number(body.width) || 1280))
    return true
  }
  if (kind === 'tailwind' && method === 'POST') {
    const { sources } = JSON.parse((await readBody(req)).toString() || '{}')
    const { buildFrameCss } = await import('./tailwind.ts')
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' })
    res.end(await buildFrameCss((sources as string[]) ?? []))
    return true
  }
  if (kind === 'registry' && method === 'POST') {
    const { input, context } = JSON.parse((await readBody(req)).toString() || '{}')
    const { resolveInstall } = await import('./registry.ts')
    json(res, await resolveInstall(String(input ?? ''), String(context ?? '')))
    return true
  }
  if (kind === 'export' && method === 'POST') {
    const { ids } = JSON.parse((await readBody(req)).toString() || '{}')
    const result = await exportBoard(BOARDS_DIR, board, undefined, Array.isArray(ids) ? ids.map(String) : undefined)
    json(res, { ...result, absDir: boardPath(board, 'export') })
    return true
  }
  if (kind === 'fonts' && method === 'GET') {
    json(res, await listFonts())
    return true
  }
  if (kind === 'reveal' && method === 'POST') {
    // Show the export folder in Finder (local app on macOS).
    const dir = boardPath(board, 'export')
    if (!fs.existsSync(dir)) throw new HttpError(404, 'nothing exported yet')
    spawn('open', [dir], { detached: true, stdio: 'ignore' }).unref()
    json(res, { ok: true })
    return true
  }
  throw new HttpError(404, `no route: ${method} ${url.pathname}`)
}

export function moodboardServer(): Plugin {
  return {
    name: 'moodboard-server',
    configureServer(server) {
      watchBoards(server)
      server.middlewares.use((req, res, next) => {
        route(server, req, res)
          .then((handled) => {
            if (!handled) next()
          })
          .catch((err: unknown) => {
            const status = err instanceof HttpError ? err.status : 500
            const message = err instanceof Error ? err.message : String(err)
            if (status === 500) server.config.logger.error(`[moodboard] ${message}`)
            if (!res.headersSent) json(res, { error: message }, status)
            else res.end()
          })
      })
    },
  }
}
