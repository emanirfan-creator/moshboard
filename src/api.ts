import type { UsedFont } from '../shared/font-probe.ts'
import type { FontFamily } from '../shared/fonts.ts'
import type { Board, MotionCapture, Segment, VideoAnalysis } from '../shared/types.ts'

type MediaPiece = { path: string; type: 'video' | 'image'; width?: number; height?: number }

export interface ExportResult {
  dir: string
  absDir: string
  files: string[]
  warnings: string[]
  scope: { frames: number; total: number }
}

export interface CanvasInfo {
  id: string
  name: string
  frames: number
  created: number
}

const enc = encodeURIComponent
const relPath = (rel: string) => rel.split('/').map(enc).join('/')

async function ok(r: Response) {
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    throw new Error(body.error ?? `${r.status} ${r.statusText}`)
  }
  return r
}
const json = <T>(r: Response) => ok(r).then((x) => x.json() as Promise<T>)

export const api = {
  boards: () => fetch('/api/boards').then((r) => json<CanvasInfo[]>(r)),
  createBoard: (name: string) =>
    fetch('/api/boards', { method: 'POST', body: JSON.stringify({ name }) }).then((r) => json<{ id: string; name: string }>(r)),
  deleteBoard: (b: string) => fetch(`/api/board/${enc(b)}`, { method: 'DELETE' }).then(ok),
  board: (b: string) => fetch(`/api/board/${enc(b)}`).then((r) => json<Board>(r)),
  saveBoard: (b: string, board: Board) =>
    fetch(`/api/board/${enc(b)}`, { method: 'PUT', body: JSON.stringify(board, null, 2) }).then(ok),
  file: (b: string, rel: string) =>
    fetch(`/api/file/${enc(b)}/${relPath(rel)}`, { cache: 'no-store' })
      .then(ok)
      .then((r) => r.text()),
  writeFile: (b: string, rel: string, text: string) =>
    fetch(`/api/file/${enc(b)}/${relPath(rel)}`, { method: 'PUT', body: text }).then(ok),
  deleteFile: (b: string, rel: string) => fetch(`/api/file/${enc(b)}/${relPath(rel)}`, { method: 'DELETE' }).then(ok),
  upload: (b: string, file: File) =>
    fetch(`/api/upload/${enc(b)}?name=${enc(file.name)}`, { method: 'POST', body: file }).then((r) =>
      json<{ path: string; type?: 'video' }>(r),
    ),
  copyAsset: (b: string, from: string, src: string) =>
    fetch(`/api/copy-asset/${enc(b)}`, { method: 'POST', body: JSON.stringify({ from, src }) }).then((r) =>
      json<{ path: string }>(r),
    ),
  gifToVideo: (b: string, src: string) =>
    fetch(`/api/gif-to-video/${enc(b)}`, { method: 'POST', body: JSON.stringify({ src }) }).then((r) =>
      json<{ path: string | null }>(r),
    ),
  analyze: (b: string, id: string, src: string, segment?: Segment) =>
    fetch(`/api/analyze/${enc(b)}/${enc(id)}`, { method: 'POST', body: JSON.stringify({ src, segment }) }).then((r) =>
      json<VideoAnalysis>(r),
    ),
  capture: (b: string, id: string, body: { url: string; selector?: string; trigger: string }) =>
    fetch(`/api/capture/${enc(b)}/${enc(id)}`, { method: 'POST', body: JSON.stringify(body) }).then((r) =>
      json<{ capture: MotionCapture; path: string; scaffold: string }>(r),
    ),
  registry: (input: string, context?: string) =>
    fetch('/api/registry/_', { method: 'POST', body: JSON.stringify({ input, context }) }).then((r) =>
      json<{
        name: string
        title: string
        entry: string
        entryPath: string
        entrySpec: string
        modules: Record<string, string>
        dependencies: string[]
      }>(r),
    ),
  mediaLink: (b: string, url: string) =>
    fetch(`/api/media-link/${enc(b)}`, { method: 'POST', body: JSON.stringify({ url }) }).then((r) =>
      json<
        MediaPiece & {
          title: string
          source: string
          /** Every piece, when the link is a multi-piece project (Muzli). */
          items?: MediaPiece[]
        }
      >(r),
    ),
  embeddable: (url: string) =>
    fetch(`/api/embeddable/_?url=${enc(url)}`).then((r) => json<{ embeddable: boolean; reason?: string }>(r)),
  snapshot: (b: string, id: string, url: string, width?: number) =>
    fetch(`/api/snapshot/${enc(b)}/${enc(id)}`, { method: 'POST', body: JSON.stringify({ url, width }) }).then((r) =>
      json<{ path: string; width: number; height: number; takenAt: string }>(r),
    ),
  tailwind: (sources: string[]) =>
    fetch('/api/tailwind/_', { method: 'POST', body: JSON.stringify({ sources }) })
      .then(ok)
      .then((r) => r.text()),
  exportBoard: (b: string, ids?: string[]) =>
    fetch(`/api/export/${enc(b)}`, { method: 'POST', body: JSON.stringify({ ids }) }).then((r) => json<ExportResult>(r)),
  fonts: () => fetch('/api/fonts').then((r) => json<{ mac: FontFamily[]; google: FontFamily[] }>(r)),
  siteFonts: (url: string) =>
    fetch('/api/site-fonts/_', { method: 'POST', body: JSON.stringify({ url }) }).then((r) => json<UsedFont[]>(r)),
  reveal: (b: string) => fetch(`/api/reveal/${enc(b)}`, { method: 'POST' }).then(ok),
}

export const mediaUrl = (b: string, rel: string) => `/media/${enc(b)}/${relPath(rel)}`
