import { memo, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import type { Frame } from '../../shared/types.ts'
import { assetUrl } from '../actions'
import { getState, mutateFrames, sameFrameExcept, setState, updateFrame, useCamera } from '../store'
import { CodeFrame } from './CodeFrame'
import { PaletteFrame } from './PaletteFrame'
import { UrlFrame } from './UrlFrame'
import { videos } from './registry'

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

/** Moving a frame changes only its position, which its content never reads: skip those renders. */
export const FrameContent = memo(
  Content,
  (a: ContentProps, b: ContentProps) =>
    a.interact === b.interact &&
    a.inView === b.inView &&
    a.seen === b.seen &&
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

  useEffect(() => {
    const v = ref.current
    if (!v) return
    videos.set(frame.id, v)
    return () => {
      if (videos.get(frame.id) === v) videos.delete(frame.id)
    }
  }, [frame.id])

  // Off-screen videos pause (decoding several clips at once is the biggest CPU cost on a board).
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (inView) v.play().catch(() => {})
    else v.pause()
  }, [inView])

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
    <video
      ref={ref}
      className="content-media"
      src={assetUrl(frame.src!)}
      muted
      autoPlay
      playsInline
      loop={!seg}
      controls={interact}
      onEnded={(e) => {
        e.currentTarget.currentTime = seg?.in ?? 0
        e.currentTarget.play().catch(() => {})
      }}
    />
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
    if (Math.abs(h - frame.h) > 1) updateFrame(frame.id, { h })
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
  const field = frame.font ? 'font' : 'color'
  const editor = interact && (
    <input
      className="inline-input"
      autoFocus
      value={(frame.font ?? frame.color) || ''}
      onChange={(e) => updateFrame(frame.id, { [field]: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter') setState({ interact: null })
        e.stopPropagation()
      }}
    />
  )
  if (frame.font) {
    return (
      <div className="swatch-font" style={{ fontFamily: frame.font }}>
        Aa Gg 123
        <small>{frame.font}</small>
        {editor}
      </div>
    )
  }
  return (
    <div className="swatch" style={{ background: frame.color }}>
      {editor}
    </div>
  )
}

function replayLinked(videoId: string) {
  const ids =
    getState()
      .board?.frames.filter((f) => f.link === videoId && f.type === 'code')
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
  const style = {
    fontSize: size,
    fontWeight: size >= 24 ? 590 : 450,
    letterSpacing: size >= 24 ? '-0.02em' : '-0.006em',
    lineHeight: size >= 32 ? 1.15 : 1.4,
  }

  const ta = useRef<HTMLTextAreaElement | null>(null)
  // Grow/shrink the frame to fit the text (layout size ignores canvas zoom). While
  // editing, measure the textarea itself so wrapped lines are never clipped.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const content = interact && ta.current ? fitTextarea(ta.current) + 12 : el.scrollHeight
    const h = Math.max(Math.ceil(size * 1.4) + 12, content)
    if (Math.abs(h - frame.h) > 1) updateFrame(frame.id, { h })
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
          onBlur={() => {
            // An empty text block isn't worth keeping.
            if (!frame.text?.trim()) mutateFrames((fs) => fs.filter((f) => f.id !== frame.id))
          }}
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

/** Requests a resized copy matched to on-screen size; only ever steps up, so zooming in sharpens without flicker. */
function ImageFrame({ frame, size }: { frame: Frame; size: Size }) {
  // Select the size step, not the zoom, so images only re-render when they need a bigger copy.
  const want = useCamera((c) => {
    const px = size.w * Math.max(1, c.z) * (window.devicePixelRatio || 1)
    return [320, 640, 1280, 2048].find((s) => s >= px) ?? 2048 // same steps as the server's cache
  })
  const best = useRef(0)
  best.current = Math.max(best.current, want)
  return (
    <img
      className="content-media"
      src={`${assetUrl(frame.src!)}?w=${best.current}`}
      alt={frame.label ?? ''}
      draggable={false}
      decoding="async"
      loading="lazy"
    />
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
