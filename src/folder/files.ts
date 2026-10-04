// Reading and writing a board's files in the connected folder, from the page. The service worker
// (public/folder-sw.js) does the same for the app's ordinary requests; these are for the features
// that run in the page because they need it (a <video> to analyze, a canvas to draw on).
import { getState } from '../store'
import { folderRoot } from './folder'

type Dir = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> }

/** The board's own folder: a subfolder, or the connected folder itself when it's a single board. */
export async function boardDir(board: string): Promise<Dir> {
  const root = folderRoot() as Dir | null
  if (!root) throw new Error('Reconnect your Moshboard folder')
  return getState().folder?.single ? root : ((await root.getDirectoryHandle(board)) as Dir)
}

const parts = (rel: string) => {
  const p = rel.replace(/^\.\//, '').split('/').filter(Boolean)
  if (!p.length || p.some((x) => x === '..' || x === '.')) throw new Error(`bad path: ${rel}`)
  return p
}

async function parent(dir: Dir, rel: string, create: boolean): Promise<[Dir, string]> {
  const p = parts(rel)
  let d = dir
  for (const x of p.slice(0, -1)) d = (await d.getDirectoryHandle(x, { create })) as Dir
  return [d, p[p.length - 1]]
}

/** The file, or null when it isn't there. */
export async function readFile(dir: Dir, rel: string): Promise<File | null> {
  try {
    const [d, name] = await parent(dir, rel, false)
    return await (await d.getFileHandle(name)).getFile()
  } catch {
    return null
  }
}

export async function writeFile(dir: Dir, rel: string, data: Blob | string) {
  const [d, name] = await parent(dir, rel, true)
  const w = await (await d.getFileHandle(name, { create: true })).createWritable()
  await w.write(data)
  await w.close()
}

export async function removeEntry(dir: Dir, rel: string, recursive = false) {
  try {
    const [d, name] = await parent(dir, rel, false)
    await d.removeEntry(name, { recursive })
  } catch {
    // already gone
  }
}

/** Every file under `dir` (paths relative to it), skipping folders `skip` says no to. */
export async function listFiles(dir: Dir, skip: (rel: string) => boolean = () => false, prefix = ''): Promise<{ rel: string; file: FileSystemFileHandle }[]> {
  const out: { rel: string; file: FileSystemFileHandle }[] = []
  for await (const [name, h] of dir.entries()) {
    const rel = prefix + name
    if (skip(rel)) continue
    if (h.kind === 'directory') out.push(...(await listFiles(h as Dir, skip, `${rel}/`)))
    else out.push({ rel, file: h as FileSystemFileHandle })
  }
  return out
}

export type { Dir }
