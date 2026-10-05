// The website's versions of features the local server does with the disk, ffmpeg and node:
// the spec export, motion analysis, GIF → video, and clearing out unused files. They run in the
// page against the connected folder, and replace those `api` calls when a folder is connected
// (folder.ts). The logic is shared with the server where it can be (shared/export.ts,
// shared/analyze-motion.ts); what differs is how files and frames are read.
import { analyzeFrames } from '../../shared/analyze-motion.ts'
import { buildExport } from '../../shared/export.ts'
import type { Board, Region, Segment, VideoAnalysis } from '../../shared/types.ts'
import { mediaUrl, type ExportResult } from '../api'
import { getState } from '../store'
import { boardDir, listFiles, readFile, removeEntry, writeFile, type Dir } from './files'
import { boardLabel } from './folder'

const readBoard = async (dir: Dir): Promise<Board> => JSON.parse((await (await readFile(dir, 'board.json'))?.text()) ?? '{"frames":[]}')

// ── export ──────────────────────────────────────────────

/** design.md, motion.md, tokens… into `<board>/export/`, like the local app (server/export.ts). */
export async function exportInFolder(board: string, ids?: string[]): Promise<ExportResult> {
  const dir = await boardDir(board)
  const full = await readBoard(dir)
  const present = new Set((await listFiles(dir, (rel) => rel === 'export' || rel === '.trash' || rel.endsWith('/.thumbs'))).map((f) => f.rel))
  // The export reads these as text; everything else it only copies.
  const texts = new Map<string, string>()
  for (const f of full.frames)
    for (const rel of [f.file, f.modules, f.analysis])
      if (rel && present.has(clean(rel))) texts.set(clean(rel), await (await readFile(dir, rel))!.text())
  const built = buildExport(full, { exists: (rel) => present.has(clean(rel)), text: (rel) => texts.get(clean(rel)) ?? null }, ids)

  await removeEntry(dir, 'export', true)
  for (const [rel, o] of built.outputs) {
    if ('text' in o) await writeFile(dir, `export/${rel}`, o.text)
    else {
      const file = await readFile(dir, o.from)
      if (file) await writeFile(dir, `export/${rel}`, file)
    }
  }
  const single = getState().folder?.single
  return {
    dir: `${boardLabel(board)}/export`,
    // As Claude Code opened in the folder sees it.
    absDir: single ? 'export' : `${board}/export`,
    files: built.files,
    warnings: built.warnings,
    scope: built.scope,
  }
}

const clean = (rel: string) => rel.replace(/^\.\//, '')

// ── motion analysis ─────────────────────────────────────

const FPS = 30
const W = 192
/** Long clips are sampled up to this many seconds (mark a segment with I/O to choose which part). */
const MAX_SECONDS = 20

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.onloadeddata = () => resolve(v)
    v.onerror = () => reject(new Error('Couldn’t open that video'))
    v.src = src
  })
}

const seek = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((resolve) => {
    if (Math.abs(v.currentTime - t) < 1e-4) return resolve()
    v.onseeked = () => resolve()
    v.currentTime = t
  })

/** Same result as the local app's analysis (server/analyze-video.ts), with frames drawn from a <video>. */
export async function analyzeInFolder(board: string, id: string, src: string, segment?: Segment, region?: Region): Promise<VideoAnalysis> {
  const dir = await boardDir(board)
  const v = await loadVideo(mediaUrl(board, src))
  const seg: Segment = segment && segment.out > segment.in ? segment : { in: 0, out: v.duration }
  const span = Math.min(seg.out - seg.in, MAX_SECONDS)
  // An area picked on the video: only that part is read.
  const r = region && region.w > 0.02 && region.h > 0.02 ? region : undefined
  const sx = (r?.x ?? 0) * v.videoWidth
  const sy = (r?.y ?? 0) * v.videoHeight
  const sw = (r?.w ?? 1) * v.videoWidth
  const sh = (r?.h ?? 1) * v.videoHeight
  const h = Math.max(2, Math.round((W * sh) / sw / 2) * 2)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  // Smooth downscaling, like ffmpeg's scale filter: a rough resize adds pixel noise that reads as motion.
  ctx.imageSmoothingQuality = 'high'
  const count = Math.max(2, Math.floor(span * FPS))
  const size = W * h
  const raw = new Uint8Array(size * count)
  for (let i = 0; i < count; i++) {
    await seek(v, seg.in + i / FPS)
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, W, h)
    const px = ctx.getImageData(0, 0, W, h).data
    // Grey as ffmpeg's `format=gray` makes it (BT.601 luma).
    for (let p = 0; p < size; p++) raw[i * size + p] = Math.round(0.299 * px[p * 4] + 0.587 * px[p * 4 + 1] + 0.114 * px[p * 4 + 2])
  }
  const { bursts, primary, energy, read } = analyzeFrames(raw, W, h, seg, FPS)

  // Contact sheet: 6×4 frames evenly across the segment, as ffmpeg's tile filter lays them out.
  const tileW = 240
  const tileH = Math.max(2, Math.round((tileW * v.videoHeight) / v.videoWidth / 2) * 2)
  const PAD = 6
  const sheet = document.createElement('canvas')
  sheet.width = 6 * tileW + 5 * PAD + 2 * PAD
  sheet.height = 4 * tileH + 3 * PAD + 2 * PAD
  const sctx = sheet.getContext('2d')!
  sctx.imageSmoothingQuality = 'high'
  sctx.fillStyle = '#2a2b30'
  sctx.fillRect(0, 0, sheet.width, sheet.height)
  const sheetFps = Math.min(FPS, 24 / Math.max(0.1, seg.out - seg.in))
  for (let k = 0; k < 24; k++) {
    const t = seg.in + k / sheetFps
    if (t >= seg.out) break
    await seek(v, t)
    sctx.drawImage(v, PAD + (k % 6) * (tileW + PAD), PAD + Math.floor(k / 6) * (tileH + PAD), tileW, tileH)
  }
  const png = await new Promise<Blob>((resolve) => sheet.toBlob((b) => resolve(b!), 'image/png'))
  const sheetRel = `assets/${id}.sheet.png`
  await writeFile(dir, sheetRel, png)
  v.removeAttribute('src')
  v.load()

  const analysis: VideoAnalysis = { source: src, fps: FPS, segment: seg, bursts, primary, energy, contactSheet: sheetRel, read, ...(r ? { region: r } : {}) }
  await writeFile(dir, `assets/${id}.analysis.json`, JSON.stringify(analysis, null, 2) + '\n')
  return analysis
}

// ── GIF → video ─────────────────────────────────────────

type DecodedFrame = { image: VideoFrame }
type GifDecoder = {
  completed: Promise<void>
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null }
  decode(o: { frameIndex: number }): Promise<DecodedFrame>
  close(): void
}
declare global {
  interface Window {
    ImageDecoder?: new (o: { data: ReadableStream<Uint8Array>; type: string }) => GifDecoder
  }
}

const RECORD_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
const converting = new Map<string, Promise<string | null>>()

/** An animated GIF becomes a video (so it can be segmented and analyzed), like the local app does. Null for a still GIF. */
export function gifToVideoInFolder(board: string, rel: string): Promise<string | null> {
  const key = `${board}/${rel}`
  let job = converting.get(key)
  if (!job) {
    job = convertGif(board, rel).finally(() => converting.delete(key))
    converting.set(key, job)
  }
  return job
}

async function convertGif(board: string, rel: string): Promise<string | null> {
  const Decoder = window.ImageDecoder
  const type = RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
  if (!Decoder || !type) return null
  const dir = await boardDir(board)
  const gif = await readFile(dir, rel)
  if (!gif) return null
  const decoder = new Decoder({ data: gif.stream(), type: 'image/gif' })
  // The frame count grows as the file is read: wait for all of it.
  await decoder.tracks.ready
  await decoder.completed
  const count = decoder.tracks.selectedTrack?.frameCount ?? 1
  if (count <= 1) {
    decoder.close()
    return null
  }
  const first = (await decoder.decode({ frameIndex: 0 })).image
  const canvas = document.createElement('canvas')
  // Even dimensions, as video encoders want.
  canvas.width = Math.max(2, Math.floor(first.displayWidth / 2) * 2)
  canvas.height = Math.max(2, Math.floor(first.displayHeight / 2) * 2)
  const ctx = canvas.getContext('2d')!
  const stream = canvas.captureStream(0)
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame(): void }
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise((r) => (recorder.onstop = r))
  recorder.start()
  // Played once at the GIF's own timing (the recorder keeps real time). Each frame is due at a
  // time measured from the start, so small delays don't add up.
  let frame: VideoFrame | null = first
  const start = performance.now()
  let due = 0
  for (let i = 0; i < count; i++) {
    frame ??= (await decoder.decode({ frameIndex: i })).image
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height)
    track.requestFrame()
    due += Math.max(20, (frame.duration ?? 100_000) / 1000)
    frame.close()
    frame = null
    await new Promise((r) => setTimeout(r, Math.max(0, start + due - performance.now())))
  }
  recorder.stop()
  await done
  decoder.close()
  const out = rel.replace(/\.gif$/i, type.startsWith('video/mp4') ? '.mp4' : '.webm')
  await writeFile(dir, out, new Blob(chunks, { type: type.split(';')[0] }))
  await removeEntry(dir, rel)
  return out
}

// ── clearing out unused files ───────────────────────────

const TRASH = '.trash'
const DAY = 24 * 60 * 60 * 1000
const KEEP = 30 * DAY
const GRACE = 10 * 60 * 1000
const PATH_RE = /^(assets|frames)\/[^\0]+$/

/** Same rules as the local app (server/sweep.ts): unused files move to `.trash/<time>/`, trash older than 30 days is emptied. */
export async function sweepInFolder(board: string, now = Date.now()) {
  const result = { trashed: [] as string[], emptied: [] as string[] }
  const dir = await boardDir(board)
  let b: { frames?: unknown[] }
  try {
    b = JSON.parse((await (await readFile(dir, 'board.json'))!.text()))
  } catch {
    return result // without a readable board.json everything would look unused
  }
  if (!Array.isArray(b.frames)) return result
  // Files directly inside assets/ and frames/ (not hidden ones like .thumbs or .DS_Store).
  const depth = (rel: string) => rel.split('/').length
  const owned = (await listFiles(dir, (rel) => (depth(rel) === 1 ? rel !== 'assets' && rel !== 'frames' : depth(rel) > 2))).filter((f) =>
    /^(assets|frames)\/[^/.][^/]*$/.test(f.rel),
  )
  const used = new Set<string>()
  const ids = new Set<string>()
  const queue: string[] = []
  const collect = (v: unknown) => {
    if (typeof v === 'string') {
      const rel = v.replace(/^\.\//, '').split(/[?#]/)[0]
      if (PATH_RE.test(rel) && !used.has(rel)) {
        used.add(rel)
        if (rel.endsWith('.json')) queue.push(rel)
      }
    } else if (Array.isArray(v)) v.forEach(collect)
    else if (v && typeof v === 'object') Object.values(v).forEach(collect)
  }
  for (const f of b.frames) {
    collect(f)
    const id = (f as { id?: unknown }).id
    if (typeof id === 'string') ids.add(id)
  }
  while (queue.length) {
    const rel = queue.pop()!
    try {
      collect(JSON.parse((await (await readFile(dir, rel))!.text())))
    } catch {
      // not JSON, or gone
    }
  }
  for (const { rel } of owned) {
    const [folder, name] = rel.split('/')
    if (folder === 'frames' && ids.has(name.split('.')[0])) used.add(rel)
  }

  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  for (const { rel, file } of owned) {
    if (used.has(rel)) continue
    const f = await file.getFile()
    if (now - f.lastModified < GRACE) continue
    await writeFile(dir, `${TRASH}/${stamp}/${rel}`, f)
    await removeEntry(dir, rel)
    result.trashed.push(rel)
  }
  // Thumbnails are a cache: drop the ones whose image is gone.
  const live = new Set(owned.filter((f) => f.rel.startsWith('assets/') && !result.trashed.includes(f.rel)).map((f) => f.rel.slice(7).replace(/\.\w+$/, '')))
  const thumbs = await listFiles(dir, (rel) => (depth(rel) === 1 ? rel !== 'assets' : depth(rel) === 2 && rel !== 'assets/.thumbs'))
  for (const { rel } of thumbs) if (!live.has(rel.slice('assets/.thumbs/'.length).replace(/-w\d+\.\w+$/, ''))) await removeEntry(dir, rel)

  try {
    const trash = await dir.getDirectoryHandle(TRASH)
    for await (const [name] of (trash as Dir).entries()) {
      // Trash folders are named by when they were made (`stamp` above).
      const made = Date.parse(name.replace(/^(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, '$1:$2:$3.$4Z'))
      if (made && now - made > KEEP) {
        await trash.removeEntry(name, { recursive: true })
        result.emptied.push(name)
      }
    }
  } catch {
    // no trash yet
  }
  return result
}
