import { memo, useEffect, useRef, useState, type PointerEvent as RPE } from 'react'
import type { Frame } from '../../shared/types.ts'
import { addText, pasteText, regeneratePalette, uploadFiles } from '../actions'
import { clamp, drag } from '../drag'
import { FrameContent } from '../frames/Contents'
import { BLOCK_HEAD, BLOCK_PAD, isBlock } from './blocks'
import { useInView } from './useInView'
import {
  frameById,
  getState,
  mutateFrames,
  onCamera,
  saveSoon,
  screenToWorld,
  setCamera,
  setState,
  updateFrame,
  useStore,
  type Camera,
} from '../store'

const MIN = 24
const DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type Dir = (typeof DIRS)[number]
const HANDLE_POS: Record<Dir, [number, number]> = {
  nw: [0, 0],
  n: [50, 0],
  ne: [100, 0],
  e: [100, 50],
  se: [100, 100],
  s: [50, 100],
  sw: [0, 100],
  w: [0, 50],
}

export function Canvas() {
  const ref = useRef<HTMLDivElement>(null)
  const frames = useStore((s) => s.board?.frames)
  const space = useStore((s) => s.space)
  const gesture = useStore((s) => s.gesture)
  const panning = useRef(false)
  const world = useRef<HTMLDivElement>(null)
  const marquee = useRef<HTMLDivElement>(null)
  const hand = useStore((s) => s.hand)

  // Apply the camera straight to the DOM: no React render per pan/zoom event.
  useEffect(() => {
    let zoom = NaN
    const apply = (c: Camera) => {
      const el = world.current
      if (!el) return
      el.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.z})`
      // --inv restyles every block (outlines, labels, handles), so only touch it when the zoom changes.
      if (c.z !== zoom) {
        zoom = c.z
        el.style.setProperty('--inv', String(1 / c.z))
      }
    }
    apply(getState().camera)
    return onCamera(apply)
  }, [])

  // Trackpad: two-finger scroll pans, pinch (ctrl+wheel) zooms around the cursor.
  useEffect(() => {
    const el = ref.current!
    // While the camera moves, keep the board as one composited layer (no re-raster of every
    // block per zoom step) and keep iframes from grabbing the wheel. Set on the DOM, not in
    // React state, so wheel events don't re-render anything.
    let settle: ReturnType<typeof setTimeout> | undefined
    const moving = () => {
      el.dataset.moving = ''
      clearTimeout(settle)
      settle = setTimeout(() => delete el.dataset.moving, 160)
    }
    const onWheel = (e: WheelEvent) => {
      // A frame you're interacting with (e.g. a site snapshot) scrolls itself.
      if (!e.ctrlKey && !e.metaKey && (e.target as Element).closest?.('[data-wheel-scroll]')) return
      e.preventDefault()
      moving()
      const c = getState().camera
      if (e.ctrlKey || e.metaKey) {
        const z = clamp(c.z * Math.exp(-e.deltaY * 0.01), 0.08, 4)
        const k = z / c.z
        setCamera({ z, x: e.clientX - (e.clientX - c.x) * k, y: e.clientY - (e.clientY - c.y) * k })
      } else {
        setCamera({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onBackgroundDown = (e: RPE) => {
    if (e.button !== 0 && e.button !== 1) return
    const s = getState()

    // Pan: Space + drag, middle button, or the Hand tool.
    if (s.space || s.hand || e.button === 1) {
      const start = s.camera
      panning.current = true
      drag(
        e,
        (dx, dy) => setCamera({ ...start, x: start.x + dx, y: start.y + dy }),
        () => (panning.current = false),
        1,
      )
      return
    }

    // Select: drag a box over empty canvas; everything it touches is selected.
    // Shift adds to the current selection. A plain click clears it.
    const base = e.shiftKey ? s.selected : []
    const x0 = e.clientX
    const y0 = e.clientY
    const box = marquee.current!
    drag(
      e,
      (_dx, _dy, ev) => {
        const left = Math.min(x0, ev.clientX)
        const top = Math.min(y0, ev.clientY)
        const w = Math.abs(ev.clientX - x0)
        const h = Math.abs(ev.clientY - y0)
        Object.assign(box.style, { display: 'block', left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` })
        const a = screenToWorld(left, top)
        const b = screenToWorld(left + w, top + h)
        const hit = (getState().board?.frames ?? [])
          .filter((f) => f.x < b.x && f.x + f.w > a.x && f.y < b.y && f.y + f.h > a.y)
          .map((f) => f.id)
        const next = [...new Set([...base, ...hit])]
        const cur = getState().selected
        if (next.length !== cur.length || next.some((id, i) => id !== cur[i])) setState({ selected: next })
      },
      (moved) => {
        box.style.display = 'none'
        if (!moved && !e.shiftKey) setState({ selected: [], interact: null })
      },
      3,
    )
    setState({ interact: null })
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const at = screenToWorld(e.clientX, e.clientY)
    const files = [...e.dataTransfer.files]
    if (files.length) return uploadFiles(files, at)
    const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    if (uri) pasteText(uri.split('\n')[0], at)
  }

  return (
    <div
      ref={ref}
      className="canvas"
      data-space={space || hand || undefined}
      data-panning={(gesture && panning.current) || undefined}
      data-gesture={gesture || undefined}
      onPointerDown={onBackgroundDown}
      onDoubleClick={(e) => {
        // Double-click empty canvas to write there.
        if (e.target === ref.current || (e.target as HTMLElement).classList.contains('world'))
          addText(screenToWorld(e.clientX, e.clientY), false)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="world" ref={world}>
        {frames?.map((f) => (
          <FrameView key={f.id} frame={f} />
        ))}
      </div>
      <div ref={marquee} className="marquee" />
    </div>
  )
}

const FrameView = memo(function FrameView({ frame }: { frame: Frame }) {
  const selected = useStore((s) => s.selected.includes(frame.id))
  const single = useStore((s) => s.selected.length === 1 && s.selected[0] === frame.id)
  const interact = useStore((s) => s.interact === frame.id)
  const linked = useStore((s) => {
    const sel = s.selected[0]
    if (!sel || sel === frame.id) return false
    const other = frameById(sel)
    return !!other && (frame.link ?? frame.id) === (other.link ?? other.id) && (!!frame.link || !!other.link)
  })
  const modified = useStore((s) => !!s.overrides[frame.id])
  const error = useStore((s) => s.errors[frame.id])
  const ref = useStore(() => (frame.link ? frameById(frame.link) : undefined))
  const [renaming, setRenaming] = useState(false)
  const el = useRef<HTMLDivElement>(null)
  const view = useInView(el)

  const onDown = (e: RPE) => {
    const s = getState()
    if (e.button !== 0 || s.space || s.hand) return
    e.stopPropagation()
    let sel = s.selected
    if (e.shiftKey) sel = sel.includes(frame.id) ? sel.filter((x) => x !== frame.id) : [...sel, frame.id]
    else if (!sel.includes(frame.id)) sel = [frame.id]
    setState({ selected: sel, interact: s.interact === frame.id ? frame.id : null })
    const starts = new Map(sel.map((id) => [id, frameById(id)!]).filter(([, f]) => f) as [string, Frame][])
    const z = s.camera.z
    drag(
      e,
      (dx, dy) =>
        mutateFrames(
          (fs) =>
            fs.map((f) => {
              const st = starts.get(f.id)
              return st ? { ...f, x: Math.round(st.x + dx / z), y: Math.round(st.y + dy / z) } : f
            }),
          false,
        ),
      (moved) => moved && saveSoon(),
    )
  }

  const onResize = (dir: Dir) => (e: RPE) => {
    e.stopPropagation()
    const f0 = frame
    const z = getState().camera.z
    const ratio = f0.w / f0.h
    drag(
      e,
      (sdx, sdy, ev) => {
        const dx = sdx / z
        const dy = sdy / z
        let l = f0.x
        let t = f0.y
        let r = f0.x + f0.w
        let b = f0.y + f0.h
        if (dir.includes('w')) l += dx
        if (dir.includes('e')) r += dx
        if (dir.includes('n')) t += dy
        if (dir.includes('s')) b += dy
        if (ev.altKey) {
          if (dir.includes('w')) r -= dx
          if (dir.includes('e')) l -= dx
          if (dir.includes('n')) b -= dy
          if (dir.includes('s')) t -= dy
        }
        let w = Math.max(MIN, r - l)
        let h = Math.max(MIN, b - t)
        if (ev.shiftKey) {
          if (dir.length === 2) {
            if (w / h > ratio) w = h * ratio
            else h = w / ratio
          } else if (dir === 'e' || dir === 'w') h = w / ratio
          else w = h * ratio
        }
        let x = dir.includes('w') ? r - w : l
        let y = dir.includes('n') ? b - h : t
        if (ev.altKey) {
          x = f0.x + f0.w / 2 - w / 2
          y = f0.y + f0.h / 2 - h / 2
        } else if (ev.shiftKey && dir.length === 1) {
          if (dir === 'e' || dir === 'w') y = f0.y + (f0.h - h) / 2
          else x = f0.x + (f0.w - w) / 2
        }
        // A hand resize becomes the frame's own size again.
        updateFrame(frame.id, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), natural: undefined }, false)
      },
      (moved) => moved && saveSoon(),
    )
  }

  const kind =
    frame.type === 'code'
      ? frame.file?.endsWith('.html')
        ? 'HTML'
        : 'React'
      : { image: 'Image', video: 'Video', url: 'Website', note: 'Note', swatch: 'Swatch', text: 'Text', palette: 'Palette' }[frame.type]
  const block = isBlock(frame)
  // A selected palette's columns take the pointer (hover tools), while drags still move it.
  const bodyOwnsPointer = frame.type === 'palette' && single && !interact
  const meta = [
    kind,
    frame.viewport ? `${frame.viewport}w` : '',
    frame.segment ? `${frame.segment.in.toFixed(2)}–${frame.segment.out.toFixed(2)}s` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const inner = block ? { w: frame.w - BLOCK_PAD * 2, h: frame.h - BLOCK_HEAD - BLOCK_PAD } : { w: frame.w, h: frame.h }

  return (
    <div
      ref={el}
      className="frame"
      data-type={frame.type}
      data-block={block || undefined}
      data-selected={selected || undefined}
      data-interact={interact || undefined}
      data-linked={linked || undefined}
      data-away={!view.inView || undefined}
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
    >
      {block ? (
        // Node-style header: also the drag handle, even while interacting with the content.
        <div
          className="block-head"
          onPointerDown={onDown}
          onDoubleClick={(e) => (e.stopPropagation(), setRenaming(true))}
        >
          <span className="block-dot" data-state={error ? 'error' : modified ? 'modified' : undefined} />
          {renaming ? (
            <input
              className="block-rename"
              autoFocus
              defaultValue={frame.label ?? ''}
              onPointerDown={(e) => e.stopPropagation()}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                updateFrame(frame.id, { label: e.target.value.trim() || undefined })
                setRenaming(false)
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
              }}
            />
          ) : (
            <span className="block-title" title="Double-click to rename">
              {frame.label || kind}
            </span>
          )}
          {ref && <span className="block-meta">↔ {ref.label || ref.type}</span>}
          {modified && <span className="block-meta mod">Unsaved</span>}
          {frame.type === 'palette' && (
            <button
              className="head-action"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => regeneratePalette(frame.id)}
              title="New colors from the board, around the locked ones"
            >
              Generate
            </button>
          )}
          <span className="block-meta block-kind">{interact ? 'Interacting · Esc' : meta}</span>
        </div>
      ) : (
        frame.type !== 'text' && (
          <div className="frame-label">
            <span>{frame.label || kind}</span>
          </div>
        )
      )}
      <div
        className="frame-body"
        onPointerDown={(e) => (bodyOwnsPointer ? onDown(e) : interact && e.stopPropagation())}
      >
        <FrameContent
          frame={frame}
          interact={interact}
          size={inner}
          inView={view.inView}
          seen={view.seen}
          active={bodyOwnsPointer}
        />
      </div>
      {!interact && !bodyOwnsPointer && (
        <div
          className="frame-hit"
          onPointerDown={onDown}
          onDoubleClick={(e) => {
            e.stopPropagation()
            // A font swatch has nothing to interact with on the canvas (and interacting would
            // take away its drag area): double-click jumps to the inspector's font search instead.
            if (frame.type === 'swatch' && frame.font) {
              setState({ selected: [frame.id] })
              requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.inspector .font-picker input')?.focus())
            } else if (frame.type !== 'image') setState({ interact: frame.id, selected: [frame.id] })
          }}
        />
      )}
      <div className="frame-outline" />
      {single &&
        !interact &&
        DIRS.map((d) => (
          <div
            key={d}
            className="handle"
            data-dir={d}
            style={{ left: `${HANDLE_POS[d][0]}%`, top: `${HANDLE_POS[d][1]}%` }}
            onPointerDown={onResize(d)}
          />
        ))}
    </div>
  )
})
