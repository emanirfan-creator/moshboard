// Clearing out files a canvas no longer uses.
//
// Deleting a block only takes it out of board.json, so undo can always bring it
// back. Undo history lives in the open tab and starts fresh when a canvas is
// opened, so at that point anything board.json doesn't point to can't come back
// through undo: those files move to the canvas's own `.trash/`, and trash older
// than 30 days is emptied. Same idea as Figma keeping images until no version
// uses them, with a recoverable step in between.

import fs from 'node:fs'
import path from 'node:path'

export const TRASH = '.trash'
const DAY = 24 * 60 * 60 * 1000
/** Trash is kept this long before it's emptied. */
const KEEP = 30 * DAY
/** Files this fresh are left alone: something may have just written them and not yet saved board.json. */
const GRACE = 10 * 60 * 1000
/** Folders whose files belong to blocks. */
const OWNED = ['assets', 'frames']
const PATH_RE = /^(assets|frames)\/[^\0]+$/

export interface SweepResult {
  /** paths (relative to the canvas) moved to trash */
  trashed: string[]
  /** trash folders emptied for being older than 30 days */
  emptied: string[]
}

/** Move files no block uses into `<canvas>/.trash/<time>/`, and empty trash older than 30 days. */
/** `dry`: report what would move without touching anything. */
export function sweepBoard(dir: string, now = Date.now(), dry = false): SweepResult {
  const result: SweepResult = { trashed: [], emptied: [] }
  const used = referenced(dir)
  // Without a readable board.json everything would look unused: do nothing.
  if (!used) return result

  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  for (const rel of ownedFiles(dir)) {
    if (used.has(rel)) continue
    const abs = path.join(dir, rel)
    let stat: fs.Stats
    try {
      stat = fs.statSync(abs)
    } catch {
      continue
    }
    if (now - stat.mtimeMs < GRACE) continue
    result.trashed.push(rel)
    if (dry) continue
    const dest = path.join(dir, TRASH, stamp, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.renameSync(abs, dest)
  }
  if (dry) return result
  dropStaleThumbs(dir)

  const trash = path.join(dir, TRASH)
  if (fs.existsSync(trash)) {
    for (const entry of fs.readdirSync(trash)) {
      const abs = path.join(trash, entry)
      const age = now - fs.statSync(abs).mtimeMs
      if (age > KEEP) {
        fs.rmSync(abs, { recursive: true, force: true })
        result.emptied.push(entry)
      }
    }
  }
  return result
}

/**
 * Every file the canvas uses: any `assets/…` or `frames/…` path anywhere in a
 * block (its image, code, modules, wrapper, analysis, snapshot, and fields added
 * later), paths inside the JSON files those point to (a video analysis's contact
 * sheet, a capture's recording), and any `frames/<id>.*` file of a block that's
 * still there. Undefined when board.json can't be read.
 */
function referenced(dir: string): Set<string> | undefined {
  let board: { frames?: unknown[] }
  try {
    board = JSON.parse(fs.readFileSync(path.join(dir, 'board.json'), 'utf8'))
  } catch {
    return
  }
  if (!Array.isArray(board.frames)) return
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
  for (const f of board.frames) {
    collect(f)
    const id = (f as { id?: unknown }).id
    if (typeof id === 'string') ids.add(id)
  }
  // Files a used JSON file points to are used too (one level of nesting is all there is today, but follow any).
  while (queue.length) {
    const rel = queue.pop()!
    try {
      collect(JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8')))
    } catch {
      // not JSON, or gone
    }
  }
  for (const rel of ownedFiles(dir)) {
    const [folder, name] = rel.split('/')
    if (folder === 'frames' && ids.has(name.split('.')[0])) used.add(rel)
  }
  return used
}

/** Files directly inside `assets/` and `frames/` (not hidden ones like `.thumbs` or `.DS_Store`). */
function ownedFiles(dir: string): string[] {
  const out: string[] = []
  for (const folder of OWNED) {
    const abs = path.join(dir, folder)
    if (!fs.existsSync(abs)) continue
    for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
      if (d.isFile() && !d.name.startsWith('.')) out.push(`${folder}/${d.name}`)
    }
  }
  return out
}

/** Thumbnails are a cache: drop the ones whose image is gone. */
function dropStaleThumbs(dir: string) {
  const thumbs = path.join(dir, 'assets', '.thumbs')
  if (!fs.existsSync(thumbs)) return
  const live = new Set(
    fs
      .readdirSync(path.join(dir, 'assets'))
      .filter((n) => !n.startsWith('.'))
      .map((n) => n.replace(/\.\w+$/, '')),
  )
  for (const t of fs.readdirSync(thumbs)) {
    if (!live.has(t.replace(/-w\d+\.\w+$/, ''))) fs.rmSync(path.join(thumbs, t), { force: true })
  }
}
