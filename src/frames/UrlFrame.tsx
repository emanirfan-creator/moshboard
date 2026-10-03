import { useEffect, useState } from 'react'
import type { Frame } from '../../shared/types.ts'
import { assetUrl } from '../actions'
import { api } from '../api'
import { getState, updateFrame } from '../store'
import { BlockLoader } from './BlockLoader'

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
    if (frame.embed !== 'blocked' || frame.snapshot || error) return
    takeSnapshot(frame).catch((e) => setError((e as Error).message))
  }, [frame.embed, frame.snapshot, error])

  if (!frame.embed) return <BlockLoader loading label="Checking site" />
  if (frame.embed === 'live') return <LiveSite frame={frame} interact={interact} size={size} />

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
  return (
    <>
      <BlockLoader loading={!loaded} />
      <iframe
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
        <span title={`${host} blocks embedding. Double-click to scroll.`}>
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
