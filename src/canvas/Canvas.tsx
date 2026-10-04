import { memo, useEffect, useRef, useState, type PointerEvent as RPE } from 'react'
import type { Frame } from '../../shared/types.ts'
import { addText, pasteText, regeneratePalette, uploadFiles } from '../actions'
import { bySize, isSection, sectionAt } from '../../shared/sections.ts'
import { Links } from './Links'
import { DIRS, HANDLE_POS, HIDDEN, NONE, pressFrame, resizeFrame, type Dir } from './gestures'
import { SectionView } from './SectionView'
import { CompareSummaries } from './CompareSummaries'
import { clamp, drag } from '../drag'
import { FrameContent } from '../frames/Contents'
import { BlockLoader } from '../frames/BlockLoader'
import { BLOCK_HEAD, BLOCK_PAD, isBlock } from './blocks'
import { useInView } from './useInView'
import { nextStep, STAGE_LABEL, STAGES, stageOf } from '../workflow'
import {
  frameById,
  getState,
  onCamera,
  screenToWorld,
  setCamera,
  setState,
  updateFrame,
  useStore,
  type Camera,
} from '../store'

export function Canvas() {
  const ref = useRef<HTMLDivElement>(null)
  const frames = useStore((s) => s.board?.frames)
  const pending = useStore((s) => s.pending)
  const space = useStore((s) => s.space)
  const gesture = useStore((s) => s.gesture)
  const panning = useRef(false)
  const world = useRef<HTMLDivElement>(null)
  const marquee = useRef<HTMLDivElement>(null)
  const hand = useStore((s) => s.hand)
  const comparing = useStore((s) => !!s.compare)
  // Leaving Compare, frames glide back before the canvas goes back to instant moves.
  const [settling, setSettling] = useState(false)
  const wasComparing = useRef(false)
  useEffect(() => {
    if (wasComparing.current && !comparing) {
      setSettling(true)
      const t = setTimeout(() => setSettling(false), 560)
      wasComparing.current = comparing
      return () => clearTimeout(t)
    }
    wasComparing.current = comparing
  }, [comparing])

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

    // Comparing: the canvas is for looking; a click only clears the selection.
    if (s.compare) return setState({ selected: [], interact: null })

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
          // A section only when the box takes it in whole, so a box drawn inside one selects its blocks.
          .filter((f) =>
            isSection(f)
              ? f.x >= a.x && f.y >= a.y && f.x + f.w <= b.x && f.y + f.h <= b.y
              : f.x < b.x && f.x + f.w > a.x && f.y < b.y && f.y + f.h > a.y,
          )
          .map((f) => f.id)
        const next = [...new Set([...base, ...hit])]
        const cur = getState().selected
        if (next.length !== cur.length || next.some((id, i) => id !== cur[i])) setState({ selected: next })
      },
      (moved) => {
        box.style.display = 'none'
        if (moved || e.shiftKey) return
        // A click on a section's empty space selects the section; elsewhere it clears.
        const at = screenToWorld(x0, y0)
        const sec = sectionAt(at.x, at.y, getState().board?.frames ?? [])
        setState({ selected: sec ? [sec.id] : [], interact: null })
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
      data-comparing={comparing || settling || undefined}
      onPointerDown={onBackgroundDown}
      onDoubleClick={(e) => {
        // Double-click empty canvas to write there.
        if (getState().compare) return
        if (e.target === ref.current || (e.target as HTMLElement).classList.contains('world'))
          addText(screenToWorld(e.clientX, e.clientY), false)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="world" ref={world}>
        {/* Sections paint first (biggest at the back), then link lines, then blocks. */}
        {frames
          ?.filter(isSection)
          .sort(bySize)
          .map((f) => <SectionView key={f.id} frame={f} />)}
        <Links />
        <CompareSummaries />
        {frames?.map((f) => !isSection(f) && <FrameView key={f.id} frame={f} />)}
        {pending.map((p) => (
          <div key={p.id} className="frame pending" data-block style={{ left: p.x, top: p.y, width: p.w, height: p.h }}>
            <div className="block-head">
              <span className="block-dot" />
              <span className="block-title">{p.label}</span>
            </div>
            <div className="frame-body">
              <BlockLoader loading />
            </div>
          </div>
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
  const stage = useStore((s) => (s.board ? stageOf(frame, s.board.frames) : null))
  // A long job on this frame (measuring, capturing, fetching): the loader plays over it.
  const job = useStore((s) => s.jobs[frame.id])
  const lastJob = useRef('')
  if (job) lastJob.current = job
  // The selected frame's next step in measure → recreate → tune (its label, so the selector stays stable).
  const stepLabel = useStore((s) => (s.selected.length === 1 && s.selected[0] === frame.id && !s.interact ? (nextStep(frame)?.label ?? null) : null))
  const step = stepLabel ? nextStep(frame) : null
  const [renaming, setRenaming] = useState(false)
  // Compare: drawn beside the other direction, or hidden when it's in neither.
  const off = useStore((s) => (s.compare ? (s.compare.offsets[frame.id] ?? HIDDEN) : NONE))
  const el = useRef<HTMLDivElement>(null)
  const view = useInView(el)

  const onDown = (e: RPE) => pressFrame(e, frame.id)
  const onResize = (dir: Dir) => (e: RPE) => resizeFrame(e, frame, dir)

  const kind =
    frame.type === 'code'
      ? frame.file?.endsWith('.html')
        ? 'HTML'
        : 'React'
      : { image: 'Image', video: 'Video', url: 'Website', note: 'Note', swatch: 'Swatch', text: 'Text', palette: 'Palette', section: 'Section' }[frame.type]
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
      data-hidden={off === HIDDEN || undefined}
      style={{ left: frame.x + off.dx, top: frame.y + off.dy, width: frame.w, height: frame.h }}
      onPointerEnter={() => setState({ hover: frame.id })}
      onPointerLeave={() => getState().hover === frame.id && setState({ hover: null })}
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
          {stage && (
            <span className="block-stage" title={`Measure → recreate → tune: ${STAGE_LABEL[stage].toLowerCase()}`}>
              <span className="stage-dots" aria-hidden>
                {STAGES.map((st, i) => (
                  <i key={st} data-on={i <= STAGES.indexOf(stage) || undefined} />
                ))}
              </span>
              {STAGE_LABEL[stage]}
            </span>
          )}
          {ref && <span className="block-meta">↔ {ref.label || ref.type}</span>}
          {modified && <span className="block-meta mod">Unsaved</span>}
          {frame.type === 'palette' && (
            <button
              className="head-action"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => regeneratePalette(frame.id)}
              title="New colors from the board, keeping locked ones"
            >
              Generate
            </button>
          )}
          {step && (
            <button
              className="head-action head-step"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => step.run()}
              title={step.hint}
            >
              {step.label}
              {step.kbd && <kbd>{step.kbd}</kbd>}
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
        {job && <div className="job-scrim" />}
        <BlockLoader loading={!!job} label={job ?? lastJob.current} />
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
        off === NONE &&
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

