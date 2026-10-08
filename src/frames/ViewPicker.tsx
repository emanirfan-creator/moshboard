import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Frame, Region } from '../../shared/types.ts'
import { fileAspect, setView } from '../actions'
import { drag } from '../drag'
import { frameById, getState, setState, useStore } from '../store'
import { cue } from '../ui/sound'

const FULL: Region = { x: 0, y: 0, w: 1, h: 1 }
/** Pointer within this many screen px of the box's edge grabs that edge. */
const EDGE = 10
const MIN = 0.04

/** Starts cropping a picture or video (the side panel's Crop, ⌘K "Crop…"). */
export const beginCrop = (id: string) => setState({ viewPick: id, viewDraft: null, selected: [id], interact: null, regionPick: null })

export const cancelCrop = () => setState({ viewPick: null, viewDraft: null })

/** Keeps the dragged crop (or shows all of the file) and gives the block its shape. */
export async function finishCrop(show: 'draft' | 'all') {
  const { viewPick, viewDraft } = getState()
  const f = viewPick ? frameById(viewPick) : undefined
  cancelCrop()
  if (!f) return
  const view = show === 'all' ? null : (viewDraft ?? f.view ?? null)
  const whole = !view || (view.w > 0.995 && view.h > 0.995)
  const r = (n: number) => Math.round(n * 1000) / 1000
  setView(f.id, whole ? null : { x: r(view.x), y: r(view.y), w: r(view.w), h: r(view.h) }, await fileAspect(f))
  cue('confirm')
}

const setDraft = (viewDraft: Region) => setState({ viewDraft })

/**
 * Cropping a picture or video: the whole file shows, letterboxed and inset from the block's
 * border (so its edges are the crop's, not the block's), with the crop as a box. Drag inside it
 * to move it, its edges or corners to resize, outside it to draw a new one. The side panel's
 * Done (or Enter) keeps it; Cancel or Esc leaves it as it was.
 */
export function ViewPicker({ frame }: { frame: Frame }) {
  const box = useRef<HTMLDivElement>(null)
  const draft = useStore((s) => s.viewDraft) ?? frame.view ?? FULL
  // The box is drawn from the media's measured size, so draw again once it's on screen and loaded.
  const [, measured] = useState(0)
  useLayoutEffect(() => {
    measured((n) => n + 1)
    const media = mediaOf(box.current)
    const again = () => measured((n) => n + 1)
    media?.addEventListener('load', again)
    media?.addEventListener('loadedmetadata', again)
    return () => {
      media?.removeEventListener('load', again)
      media?.removeEventListener('loadedmetadata', again)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Enter' && (e.preventDefault(), finishCrop('draft'))
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The overlay ↔ the file, through object-fit: contain inside the media's padding.
  const map = () => {
    const el = box.current
    const media = mediaOf(el)
    if (!el || !media) return null
    const r = el.getBoundingClientRect()
    const mr = media.getBoundingClientRect()
    const cs = getComputedStyle(media)
    // The padding is in the block's own pixels; the rect is on screen (zoomed).
    const k = media.offsetWidth ? mr.width / media.offsetWidth : 1
    const pad = parseFloat(cs.paddingLeft) * k || 0
    const content = { left: mr.left + pad, top: mr.top + pad, width: mr.width - pad * 2, height: mr.height - pad * 2 }
    const nw = (media as HTMLVideoElement).videoWidth || (media as HTMLImageElement).naturalWidth
    const nh = (media as HTMLVideoElement).videoHeight || (media as HTMLImageElement).naturalHeight
    if (!nw || !nh) return null
    const s = Math.min(content.width / nw, content.height / nh)
    const dw = nw * s
    const dh = nh * s
    const ox = content.left + (content.width - dw) / 2
    const oy = content.top + (content.height - dh) / 2
    return {
      aspect: nw / nh,
      dw,
      dh,
      toFile: (cx: number, cy: number) => ({ x: clamp((cx - ox) / dw), y: clamp((cy - oy) / dh) }),
      toBox: (g: Region) => ({
        left: ox - r.left + g.x * dw,
        top: oy - r.top + g.y * dh,
        width: g.w * dw,
        height: g.h * dh,
      }),
    }
  }

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const m = map()
    if (!m) return
    const start = draft
    const p = m.toFile(e.clientX, e.clientY)
    const { near, resizing, inside } = grab(p, start, EDGE / m.dw, EDGE / m.dh)
    drag(
      e,
      (_dx, _dy, ev) => {
        const q = m.toFile(ev.clientX, ev.clientY)
        if (resizing) {
          let x0 = start.x
          let y0 = start.y
          let x1 = start.x + start.w
          let y1 = start.y + start.h
          if (near.l) x0 = Math.min(q.x, x1 - MIN)
          if (near.r) x1 = Math.max(q.x, x0 + MIN)
          if (near.t) y0 = Math.min(q.y, y1 - MIN)
          if (near.b) y1 = Math.max(q.y, y0 + MIN)
          setDraft({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
        } else if (inside) {
          setDraft({ ...start, x: clamp(start.x + q.x - p.x, 0, 1 - start.w), y: clamp(start.y + q.y - p.y, 0, 1 - start.h) })
        } else {
          setDraft({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.max(MIN, Math.abs(q.x - p.x)), h: Math.max(MIN, Math.abs(q.y - p.y)) })
        }
      },
      undefined,
      2,
    )
  }

  // The cursor says what a drag from here does.
  const hover = (e: React.PointerEvent<HTMLDivElement>) => {
    const m = map()
    if (!m || e.buttons) return
    const { near, inside } = grab(m.toFile(e.clientX, e.clientY), draft, EDGE / m.dw, EDGE / m.dh)
    const ns = near.t || near.b
    const ew = near.l || near.r
    e.currentTarget.style.cursor =
      ns && ew ? ((near.t && near.l) || (near.b && near.r) ? 'nwse-resize' : 'nesw-resize') : ns ? 'ns-resize' : ew ? 'ew-resize' : inside ? 'move' : 'crosshair'
  }

  const m = map()
  return (
    <div ref={box} className="view-pick" onPointerDown={down} onPointerMove={hover}>
      {m && <div className="view-box" style={m.toBox(draft)} />}
    </div>
  )
}

/** Which of the box's edges a point grabs (within ex/ey of one), and whether it's inside the box. */
function grab(p: { x: number; y: number }, b: Region, ex: number, ey: number) {
  const inX = p.x > b.x - ex && p.x < b.x + b.w + ex
  const inY = p.y > b.y - ey && p.y < b.y + b.h + ey
  const near = {
    l: inY && Math.abs(p.x - b.x) < ex,
    r: inY && Math.abs(p.x - (b.x + b.w)) < ex,
    t: inX && Math.abs(p.y - b.y) < ey,
    b: inX && Math.abs(p.y - (b.y + b.h)) < ey,
  }
  const inside = p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h
  return { near, resizing: near.l || near.r || near.t || near.b, inside }
}

function mediaOf(el: HTMLElement | null) {
  return el?.parentElement?.querySelector<HTMLImageElement | HTMLVideoElement>('img.content-media, video.content-media') ?? null
}

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n))
