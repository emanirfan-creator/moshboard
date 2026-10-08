import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { refsOf } from '../../shared/frame-links.ts'
import type { Frame, Region } from '../../shared/types.ts'
import { fontStack, GLYPHS, SPECIMEN, styleName, SWATCH_SIZE } from '../../shared/fonts.ts'
import { assetUrl } from '../actions'
import { loadFont } from '../fonts'
import { fitFrame, getState, mutateFrames, sameFrameExcept, setState, toast, updateFrame, useCamera, useStore } from '../store'
import { drag } from '../drag'
import { cue } from '../ui/sound'
import { AudioFrame } from './AudioFrame'
import { CodeFrame } from './CodeFrame'
import { PaletteFrame } from './PaletteFrame'
import { UrlFrame } from './UrlFrame'
import { videos } from './registry'
import { ViewPicker } from './ViewPicker'

export interface Size {
  w: number
  h: number
}

interface ContentProps {
  frame: Frame
  interact: boolean
  size: Size
  /** on or near screen right now */
  inView?: boolean
  /** has been on screen at least once (heavy content mounts lazily) */
  seen?: boolean
  /** selected and owning the pointer (palette column tools) */
  active?: boolean
}

const POSITION = ['x', 'y'] as const
const LIVE = new Set(['video', 'audio', 'code', 'url'])

/** Moving a frame changes only its position, which its content never reads: skip those renders. */
export const FrameContent = memo(
  Content,
  (a: ContentProps, b: ContentProps) =>
    a.interact === b.interact &&
    // Only videos, code and sites change when they scroll into or out of view.
    ((a.inView === b.inView && a.seen === b.seen) || !LIVE.has(a.frame.type)) &&
    a.active === b.active &&
    a.size.w === b.size.w &&
    a.size.h === b.size.h &&
    sameFrameExcept(a.frame, b.frame, POSITION),
)

function Content({
  frame,
  interact,
  size,
  inView = true,
  seen = true,
  active = false,
}: ContentProps) {
  switch (frame.type) {
    case 'image':
      return <ImageFrame frame={frame} size={size} />
    case 'video':
      return <VideoFrame frame={frame} interact={interact} inView={inView} />
    case 'audio':
      return <AudioFrame frame={frame} seen={seen} />
    case 'code':
      return seen ? <CodeFrame frame={frame} interact={interact} size={size} inView={inView} /> : null
    case 'url':
      return seen ? <UrlFrame frame={frame} interact={interact} size={size} /> : null
    case 'note':
      return <NoteFrame frame={frame} interact={interact} />
    case 'swatch':
      return <SwatchFrame frame={frame} interact={interact} />
    case 'text':
      return <TextFrame frame={frame} interact={interact} />
    case 'palette':
      return <PaletteFrame frame={frame} active={active} />
  }
}

function VideoFrame({ frame, interact, inView }: { frame: Frame; interact: boolean; inView: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const seg = frame.segment
  const cropping = useStore((s) => s.viewPick === frame.id)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    videos.set(frame.id, v)
    return () => {
      if (videos.get(frame.id) === v) videos.delete(frame.id)
    }
  }, [frame.id])

  // Off-screen videos pause (decoding several clips at once is the biggest CPU cost on a board),
  // and so do ones zoomed out to a speck, where the motion can't be seen anyway.
  const speck = useCamera((c) => Math.min(frame.w, frame.h) * c.z < 48)
  const playing = inView && !speck
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (playing) v.play().catch(() => {})
    else v.pause()
  }, [playing])

  // Loop inside the marked segment, and each time the clip starts over, replay
  // any coded copy linked to it so the two stay side by side in sync. Runs per
  // presented video frame (not per display frame) and only while visible.
  useEffect(() => {
    const v = ref.current
    if (!v || !inView) return
    let last = 0
    let handle = 0
    let stopped = false
    const check = () => {
      if (stopped) return
      if (seg && (v.currentTime >= seg.out || v.currentTime < seg.in - 0.05)) v.currentTime = seg.in
      if (v.currentTime + 0.05 < last) replayLinked(frame.id)
      last = v.currentTime
      schedule()
    }
    const rvfc = 'requestVideoFrameCallback' in v
    const schedule = () => {
      handle = rvfc ? v.requestVideoFrameCallback(check) : requestAnimationFrame(check)
    }
    schedule()
    return () => {
      stopped = true
      if (rvfc) v.cancelVideoFrameCallback(handle)
      else cancelAnimationFrame(handle)
    }
  }, [frame.id, seg?.in, seg?.out, inView])

  return (
    <>
    {cropping ? <ViewPicker frame={frame} /> : <RegionPicker frame={frame} />}
    <video
      ref={ref}
      className="content-media"
      style={cropStyle(frame, cropping)}
      src={assetUrl(frame.src!)}
      muted
      // Not autoPlay: that makes the browser download every clip on the board when it opens.
      // The effect above plays it once it's on screen; one on screen but too small to play still
      // loads enough to show its picture.
      preload={inView ? 'auto' : 'metadata'}
      playsInline
      loop={!seg}
      controls={interact}
      onEnded={(e) => {
        e.currentTarget.currentTime = seg?.in ?? 0
        e.currentTarget.play().catch(() => {})
      }}
    />
    </>
  )
}

// The note is painted the same way while editing and at rest: the editor is a
// transparent textarea over the painted text, so nothing shifts when you click away.
function NoteFrame({ frame, interact }: { frame: Frame; interact: boolean }) {
  const paint = useRef<HTMLDivElement>(null)
  const text = frame.text ?? ''
  // Height follows the painted text (plus the note's padding), so it shrinks as well as grows.
  useLayoutEffect(() => {
    const h = Math.max(36, (paint.current?.offsetHeight ?? 0) + 16)
    if (Math.abs(h - frame.h) > 1) fitFrame(frame.id, { h })
  })
  return (
    <div className="note">
      <div className="note-paint" ref={paint} data-empty={!text || undefined}>
        {text ? paintNote(text) : 'Intent, constraints, what to keep…'}
      </div>
      {interact && (
        <textarea
          autoFocus
          spellCheck={false}
          ref={selectAllRef(frame.id)}
          value={text}
          onChange={(e) => updateFrame(frame.id, { text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setState({ interact: null })
            e.stopPropagation()
          }}
        />
      )}
    </div>
  )
}

/** Light markdown (# heading, ## subheading, - list) that keeps every character in place. */
function paintNote(text: string): ReactNode[] {
  const lines = text.split('\n').map((line, i) => {
    const m = /^(#{1,2} |[-*] )(.*)$/.exec(line)
    if (!m) return <span key={i}>{line}</span>
    const cls = m[1].startsWith('#') ? 'note-h' : 'note-li'
    return (
      <span key={i} className={cls}>
        <span className="note-mark">{m[1]}</span>
        {m[2]}
      </span>
    )
  })
  // Newlines between lines, plus a character after a trailing newline so it takes up a line.
  return [...lines.flatMap((l, i) => (i ? ['\n', l] : [l])), '\u200b']
}

function SwatchFrame({ frame, interact }: { frame: Frame; interact: boolean }) {
  useEffect(() => loadFont(frame.fontHref), [frame.fontHref])
  // Like text: the handles set the width, the sample wraps, and the height follows it.
  // Also re-measured when it reflows on its own, e.g. once a web font finishes loading.
  const card = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    const fit = () => {
      const h = Math.ceil(el.offsetHeight)
      const f = getState().board?.frames.find((x) => x.id === frame.id)
      if (f && Math.abs(h - f.h) > 1) fitFrame(frame.id, { h })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [frame.id, !!frame.font])
  // Fonts are changed from the inspector's picker; colors are typed in place.
  const layout = frame.fontLayout ?? 'name'
  if (frame.font) {
    // The name label and the style line scale with the sample, staying a step smaller.
    const size = frame.size ?? SWATCH_SIZE
    const caption = Math.max(12, Math.round(size * 0.3))
    return (
      <div className="swatch-font" data-layout={layout} ref={card} style={{ gap: Math.max(8, Math.round(size * 0.18)) }}>
        {layout !== 'name' && (
          <div className="swatch-font-name" style={{ fontSize: Math.max(13, Math.round(size * 0.34)) }}>
            {frame.font}
          </div>
        )}
        <div
          className="swatch-font-sample"
          style={{
            fontFamily: fontStack(frame.font, frame.fontCategory),
            fontSize: size,
            fontWeight: frame.weight ?? 400,
            fontStyle: frame.italic ? 'italic' : undefined,
          }}
        >
          {layout === 'glyphs' ? GLYPHS : layout === 'specimen' ? SPECIMEN : frame.font}
        </div>
        <div className="swatch-font-meta" style={{ fontSize: caption }}>
          {styleName(frame.weight, frame.italic)} · {size}px
        </div>
      </div>
    )
  }
  return (
    <div className="swatch" style={{ background: frame.color }}>
      {interact && (
        <input
          className="inline-input"
          autoFocus
          value={frame.color || ''}
          onChange={(e) => updateFrame(frame.id, { color: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter') setState({ interact: null })
            e.stopPropagation()
          }}
        />
      )}
    </div>
  )
}

function replayLinked(videoId: string) {
  const ids =
    getState()
      .board?.frames.filter((f) => f.type === 'code' && refsOf(f).includes(videoId))
      .map((f) => f.id) ?? []
  if (!ids.length) return
  setState((s) => {
    const replay = { ...s.replay }
    for (const id of ids) replay[id] = (replay[id] ?? 0) + 1
    return { replay }
  })
}

/** Plain text on the canvas. Height follows the content; width is set by the handles. */
function TextFrame({ frame, interact }: { frame: Frame; interact: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const size = frame.size ?? 24
  // The app font unless one was picked for this text; the weight follows the size unless set.
  useEffect(() => loadFont(frame.fontHref), [frame.fontHref])
  const style = {
    fontFamily: frame.font ? fontStack(frame.font, frame.fontCategory) : undefined,
    fontSize: size,
    fontWeight: frame.weight ?? (size >= 24 ? 590 : 450),
    fontStyle: frame.italic ? ('italic' as const) : undefined,
    letterSpacing: size >= 24 ? '-0.02em' : '-0.006em',
    lineHeight: size >= 32 ? 1.15 : 1.4,
  }

  const ta = useRef<HTMLTextAreaElement | null>(null)
  // Text only exists once it has a character in it: however editing ends (Esc, clicking
  // away, another tool), an empty block is removed.
  const empty = !frame.text?.trim()
  useEffect(() => {
    if (interact || !empty) return
    mutateFrames((fs) => fs.filter((f) => f.id !== frame.id))
    setState((s) => ({ selected: s.selected.filter((id) => id !== frame.id) }))
  }, [interact, empty, frame.id])

  // Grow/shrink the frame to fit the text (layout size ignores canvas zoom). While
  // editing, measure the textarea itself so wrapped lines are never clipped.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const content = interact && ta.current ? fitTextarea(ta.current) + 12 : el.scrollHeight
    const h = Math.max(Math.ceil(size * 1.4) + 12, content)
    if (Math.abs(h - frame.h) > 1) fitFrame(frame.id, { h })
  })

  if (interact) {
    return (
      <div className="text-block" style={style} ref={ref}>
        <textarea
          autoFocus
          ref={(el) => {
            ta.current = el
            selectAllRef(frame.id)(el)
          }}
          value={frame.text ?? ''}
          placeholder="Type something"
          style={style}
          rows={1}
          onChange={(e) => updateFrame(frame.id, { text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') ((e.target as HTMLTextAreaElement).blur(), setState({ interact: null }))
            e.stopPropagation()
          }}
        />
      </div>
    )
  }
  return (
    <div className="text-block" style={style} ref={ref}>
      {frame.text}
    </div>
  )
}

/**
 * How a picture or video sits in its block: just its `view` (the part of the file it shows), then
 * in a layout, which part of that covers the box and how far it's zoomed. While its crop is being
 * dragged it shows the whole file instead, letterboxed.
 */
function cropStyle(frame: Frame, cropping = false): React.CSSProperties | undefined {
  if (cropping) return { objectFit: 'contain' }
  const v = frame.view
  const viewBox = v ? { objectViewBox: `inset(${pct(v.y)} ${pct(1 - v.x - v.w)} ${pct(1 - v.y - v.h)} ${pct(v.x)})` } : undefined
  const c = frame.crop
  if (!c) return viewBox as React.CSSProperties | undefined
  const at = `${(0.5 + c.x) * 100}% ${(0.5 + c.y) * 100}%`
  return { ...viewBox, objectPosition: at, transform: c.s !== 1 ? `scale(${c.s})` : undefined, transformOrigin: at }
}
const pct = (n: number) => `${Math.max(0, Math.round(n * 10000) / 100)}%`

/** Requests a resized copy matched to on-screen size; only ever steps up, so zooming in sharpens without flicker. */
function ImageFrame({ frame, size }: { frame: Frame; size: Size }) {
  // Select the size step, not the zoom, so images only re-render when they need a bigger copy.
  const want = useCamera((c) => {
    const px = size.w * Math.max(1, c.z) * (window.devicePixelRatio || 1)
    return [320, 640, 1280, 2048].find((s) => s >= px) ?? 2048 // same steps as the server's cache
  })
  const best = useRef(0)
  best.current = Math.max(best.current, want)
  const cropping = useStore((s) => s.viewPick === frame.id)
  return (
    <>
    {cropping && <ViewPicker frame={frame} />}
    <img
      className="content-media"
      style={cropStyle(frame, cropping)}
      src={`${assetUrl(frame.src!)}?w=${best.current}`}
      alt={frame.label ?? ''}
      draggable={false}
      decoding="async"
      loading="lazy"
    />
    </>
  )
}

/** Ref for an editor textarea: selects all its text when opened with ⌘A. */
function selectAllRef(id: string) {
  return (el: HTMLTextAreaElement | null) => {
    if (!el || getState().selectAllIn !== id) return
    setState({ selectAllIn: null })
    el.focus()
    el.select()
  }
}

/** Size a textarea to its content (all wrapped lines) and return that height. */
function fitTextarea(ta: HTMLTextAreaElement) {
  ta.style.height = '0px'
  const h = ta.scrollHeight
  ta.style.height = `${h}px`
  return h
}

/**
 * A video's analysis area. Shown as a box on the selected video; while picking (the panel's
 * "Pick area"), drag across the picture to draw it. Stored as 0–1 of the video's own frame, so
 * a picture cropped to fit its block still maps to the right pixels.
 */
function RegionPicker({ frame }: { frame: Frame }) {
  const picking = useStore((s) => s.regionPick === frame.id)
  const selected = useStore((s) => s.selected.length === 1 && s.selected[0] === frame.id)
  const [draft, setDraft] = useState<Region | null>(null)
  const box = useRef<HTMLDivElement>(null)
  // The box is drawn from the overlay's measured size, so draw again once it's on screen.
  const [, measured] = useState(0)
  const on = picking || (selected && !!frame.region)
  useLayoutEffect(() => void (on && measured((n) => n + 1)), [on, frame.region])
  if (!on) return null

  // The box ↔ the video's own frame, through its crop (`view`) and object-fit: cover.
  const map = () => {
    const el = box.current!
    const r = el.getBoundingClientRect()
    const v = videos.get(frame.id)
    const crop = frame.view ?? { x: 0, y: 0, w: 1, h: 1 }
    const vw = (v?.videoWidth || r.width) * crop.w
    const vh = (v?.videoHeight || r.height) * crop.h
    const s = Math.max(r.width / vw, r.height / vh)
    const dw = vw * s
    const dh = vh * s
    const ox = (r.width - dw) / 2
    const oy = (r.height - dh) / 2
    const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
    return {
      toVideo: (cx: number, cy: number) => ({
        x: clamp01(crop.x + clamp01((cx - r.left - ox) / dw) * crop.w),
        y: clamp01(crop.y + clamp01((cy - r.top - oy) / dh) * crop.h),
      }),
      toBox: (g: Region) => ({
        left: `${((ox + ((g.x - crop.x) / crop.w) * dw) / r.width) * 100}%`,
        top: `${((oy + ((g.y - crop.y) / crop.h) * dh) / r.height) * 100}%`,
        width: `${(((g.w / crop.w) * dw) / r.width) * 100}%`,
        height: `${(((g.h / crop.h) * dh) / r.height) * 100}%`,
      }),
    }
  }
  const down = (e: React.PointerEvent) => {
    if (!picking || e.button !== 0) return
    e.stopPropagation()
    const m = map()
    const a = m.toVideo(e.clientX, e.clientY)
    const rect = (b: { x: number; y: number }): Region => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) })
    drag(
      e,
      (_dx, _dy, ev) => setDraft(rect(m.toVideo(ev.clientX, ev.clientY))),
      (moved, ev) => {
        setDraft(null)
        if (!moved) return
        const g = rect(m.toVideo(ev.clientX, ev.clientY))
        if (g.w < 0.04 || g.h < 0.04) return toast('Drag a bigger box')
        const round = (n: number) => Math.round(n * 1000) / 1000
        updateFrame(frame.id, { region: { x: round(g.x), y: round(g.y), w: round(g.w), h: round(g.h) } })
        setState({ regionPick: null })
        cue('confirm')
      },
      2,
    )
  }
  const shown = draft ?? frame.region
  return (
    <div ref={box} className="region-pick" data-picking={picking || undefined} onPointerDown={down}>
      {/* Too small on screen to hold it: the panel says the same. */}
      {picking && !draft && (box.current?.getBoundingClientRect().width ?? 0) >= 200 && <span className="region-hint">Drag over the part to read</span>}
      {shown && box.current && <div className="region-box" style={map().toBox(shown)} />}
    </div>
  )
}
