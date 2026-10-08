import { useEffect, useRef, useState } from 'react'
import type { Frame } from '../../shared/types.ts'
import { postLink } from '../../shared/posts.ts'
import { assetUrl } from '../actions'
import { askClaude } from '../folder/ClaudeTask'
import { FOLDER_ONLY } from '../folder/folder'
import { api } from '../api'
import { getState, updateFrame } from '../store'
import { BlockLoader } from './BlockLoader'
import { BLOCK_HEAD, BLOCK_PAD } from '../canvas/blocks'

interface Size {
  w: number
  h: number
}

// One check / one capture per frame at a time, even across remounts.
const inflight = new Map<string, Promise<unknown>>()
function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  let p = inflight.get(key) as Promise<T> | undefined
  if (!p) {
    p = run().finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}

async function takeSnapshot(frame: Frame) {
  const s = await once(`snap:${frame.id}`, () =>
    api.snapshot(getState().boardName, frame.id, frame.src!, frame.viewport ?? 1280),
  )
  updateFrame(frame.id, { snapshot: s.path })
}

/**
 * Live sites render in an iframe. Sites that refuse to be framed (X-Frame-Options /
 * CSP frame-ancestors, e.g. framer.com) get a full-page snapshot instead.
 */
export function UrlFrame({ frame, interact, size }: { frame: Frame; interact: boolean; size: Size }) {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (frame.embed || !frame.src) return
    once(`embed:${frame.id}`, () => api.embeddable(frame.src!)).then((r) =>
      updateFrame(frame.id, { embed: r.embeddable ? 'live' : 'blocked' }),
    )
  }, [frame.id, frame.src, frame.embed])

  useEffect(() => {
    // The website can't take snapshots itself; it asks Claude (below).
    if (frame.embed !== 'blocked' || frame.snapshot || error || FOLDER_ONLY) return
    takeSnapshot(frame).catch((e) => setError((e as Error).message))
  }, [frame.embed, frame.snapshot, error])

  if (frame.post) return <PostEmbed frame={frame} interact={interact} size={size} />
  if (!frame.embed) return <BlockLoader loading label="Checking site" />
  if (frame.embed === 'live') return <LiveSite frame={frame} interact={interact} size={size} />

  if (FOLDER_ONLY && !frame.snapshot) {
    return (
      <div className="block-error" role="note">
        <h3>This site doesn’t allow previews</h3>
        <p>Claude can open {new URL(frame.src!).host} in your Chrome and save a picture of it here.</p>
        <div className="block-error-actions" onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn" onClick={() => askClaude('snapshot', frame.id)}>
            Snapshot with Claude
          </button>
          <button className="btn" onClick={() => window.open(frame.src, '_blank', 'noopener')}>
            Open site
          </button>
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="block-error" role="alert">
        <h3>Couldn’t take a snapshot</h3>
        <p>
          {new URL(frame.src!).host} blocks embedding, and the snapshot failed: {error}
        </p>
        <div className="block-error-actions" onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn" onClick={() => setError(null)}>
            Retry
          </button>
          <button className="btn" onClick={() => window.open(frame.src, '_blank', 'noopener')}>
            Open site
          </button>
        </div>
      </div>
    )
  }
  if (!frame.snapshot) return <BlockLoader loading label="Taking a snapshot" />

  return <Snapshot frame={frame} interact={interact} />
}

function LiveSite({ frame, interact, size }: { frame: Frame; interact: boolean; size: Size }) {
  const vp = frame.viewport
  const scale = vp ? size.w / vp : 1
  const [loaded, setLoaded] = useState(false)
  const ref = useRef<HTMLIFrameElement>(null)
  useReleaseFocus(ref, interact)
  // Some pages never report that they loaded (a dead address, a stalled server): stop waiting.
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 15_000)
    return () => clearTimeout(t)
  }, [frame.src])
  return (
    <>
      <BlockLoader loading={!loaded} />
      <iframe
        ref={ref}
        onLoad={() => setLoaded(true)}
        className="content-iframe"
        title={frame.label ?? frame.src}
        src={frame.src}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        style={{
          width: vp ?? size.w,
          height: size.h / scale,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          pointerEvents: interact ? 'auto' : 'none',
        }}
      />
    </>
  )
}

/** Leaving a block hands the keyboard back to the board (a framed page keeps focus after the last click in it). */
function useReleaseFocus(ref: React.RefObject<HTMLIFrameElement | null>, interact: boolean) {
  useEffect(() => {
    if (!interact && ref.current && document.activeElement === ref.current) ref.current.blur()
  }, [interact])
}

// Narrower than this and the embeds squeeze their own layout, so they're drawn at it and scaled down.
const POST_MIN_W = 326

/**
 * An Instagram or LinkedIn post in the site's own embed. Instagram reports the post's height
 * once it loads; a new block takes it (then it's the user's to resize).
 */
function PostEmbed({ frame, interact, size }: { frame: Frame; interact: boolean; size: Size }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)
  const embed = postLink(frame.src ?? '')?.embed
  useReleaseFocus(ref, interact)
  const w = Math.max(size.w, POST_MIN_W)
  const scale = size.w / w

  useEffect(() => {
    if (!frame.fit) return
    const onMessage = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return
      const height = measured(e.data)
      if (height) fitPost(frame.id, height * scale)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [frame.id, frame.fit, scale])

  if (!embed) return <BlockLoader loading={false} label="Not a post link" />
  return (
    <>
      <BlockLoader loading={!loaded} />
      <iframe
        ref={ref}
        onLoad={() => setLoaded(true)}
        className="content-iframe post-embed"
        title={frame.label ?? frame.src}
        src={embed}
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        style={{
          width: w,
          height: size.h / scale,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          pointerEvents: interact ? 'auto' : 'none',
        }}
      />
    </>
  )
}

/** The height in Instagram's `{type: 'MEASURE', details: {height}}` message (sent as JSON text). */
function measured(data: unknown): number | null {
  try {
    const m = typeof data === 'string' ? JSON.parse(data) : data
    const h = m?.type === 'MEASURE' ? Number(m.details?.height) : NaN
    return h > 0 ? h : null
  } catch {
    return null
  }
}

/** A new post block takes the embed's height, keeping its top where it landed. */
function fitPost(id: string, height: number) {
  const f = getState().board?.frames.find((x) => x.id === id)
  if (!f?.fit) return
  updateFrame(id, { fit: undefined, h: Math.round(Math.min(1400, height) + BLOCK_HEAD + BLOCK_PAD) })
}

function Snapshot({ frame, interact }: { frame: Frame; interact: boolean }) {
  const [refreshing, setRefreshing] = useState(false)
  const host = (() => {
    try {
      return new URL(frame.src!).host
    } catch {
      return frame.src
    }
  })()
  const refresh = () => {
    setRefreshing(true)
    takeSnapshot(frame).finally(() => setRefreshing(false))
  }
  return (
    <>
      <div className="snapshot" data-wheel-scroll={interact || undefined}>
        <img src={assetUrl(frame.snapshot!)} alt={`Snapshot of ${host}`} draggable={false} decoding="async" />
      </div>
      <BlockLoader loading={refreshing} label="Refreshing snapshot" />
      <div className="snap-bar" onPointerDown={(e) => e.stopPropagation()}>
        <span title={`${host} can’t be shown live, so this is a picture of it. Double-click to scroll.`}>
          Snapshot
        </span>
        <button onClick={refresh} disabled={refreshing}>
          Refresh
        </button>
        <button onClick={() => window.open(frame.src, '_blank', 'noopener')}>Open site ↗</button>
      </div>
    </>
  )
}
