import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Frame } from '../../shared/types.ts'
import { looksLikeInstall } from '../../shared/install.ts'
import { copySetupFix, fetchIntoFrame, replay } from '../actions'
import { setState, updateFrame, useStore } from '../store'

interface Described {
  title: string
  body: ReactNode
  /** extra action besides Retry */
  action?: { label: string; run: () => void }
  /** offer an inline field to paste the library's install command into this block */
  install?: boolean
}

const openPasteDialog = () => setState({ add: 'code' })

/** Turn a raw frame error into something a person can act on. */
function describe(message: string, frameId: string): Described {
  const missing = [...message.matchAll(/“(@\/[^”]+)”/g)].map((m) => m[1])
  if (missing.length || /isn’t part of what was pasted/.test(message)) {
    return {
      title: 'A file is missing',
      body: (
        <>
          This component imports <code>{missing.join(', ') || 'another file'}</code>, which wasn’t pasted. Paste the
          install command to fetch all its files.
        </>
      ),
      action: { label: 'Paste install command', run: openPasteDialog },
      install: true,
    }
  }
  const syntax = /Unexpected token|Error transforming|SyntaxError|Expected/i.exec(message)
  if (syntax) {
    const where = /\((\d+):(\d+)\)/.exec(message)
    return {
      title: 'Couldn’t read this code',
      body: (
        <>
          {where ? `Line ${where[1]} doesn’t parse.` : 'It doesn’t parse.'} Copy the whole file, or paste the install
          command instead.
        </>
      ),
      action: { label: 'Paste again', run: openPasteDialog },
      install: true,
    }
  }
  if (/failed to load|didn’t finish loading|Failed to fetch|NetworkError/i.test(message)) {
    return {
      title: 'Couldn’t load this component',
      body: 'A package didn’t download. Check your connection and try again.',
    }
  }
  // Library components that render outside their provider (Chakra, MUI, Mantine, React context).
  if (/provider|must be (used|rendered) (within|inside)|useContext|context/i.test(message)) {
    return {
      title: 'It needs its library set up',
      body: 'This component only shows once the design library it comes from is set up around it. Claude Code can do that for you.',
      action: { label: 'Copy fix for Claude Code', run: () => copySetupFix(frameId) },
    }
  }
  if (/no default export/i.test(message)) {
    return {
      title: 'Nothing to render',
      body: 'Add a default export, like export default function Card.',
    }
  }
  return {
    title: 'It crashed while rendering',
    body: <code className="block-error-msg">{message.replace(/^Uncaught\s+/, '')}</code>,
  }
}

export function BlockError({ frame, message }: { frame: Frame; message: string }) {
  const source = useStore((s) => (frame.file ? s.files[frame.file] : undefined))
  const install = source && looksLikeInstall(source) ? source.trim() : null
  const d: Described = install
    ? {
        title: 'That’s an install command',
        body: (
          <>
            Fetch <code>{install}</code> to load the component and all its files here.
          </>
        ),
        action: { label: 'Fetch component', run: () => fetchIntoFrame(frame.id, install) },
      }
    : describe(message, frame.id)
  const [copied, setCopied] = useState(false)
  const stop = (e: React.PointerEvent) => e.stopPropagation()
  const ref = useRef<HTMLDivElement>(null)
  useGrowToFit(ref, frame)
  return (
    <div className="block-error" role="alert" ref={ref}>
      <svg className="block-error-art" width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden>
        <rect x="6.5" y="10.5" width="43" height="35" rx="7" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 4" />
        <path d="M22 24l12 12M34 24 22 36" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <h3>{d.title}</h3>
      <p>{d.body}</p>
      {d.install && !install && <InstallField frameId={frame.id} />}
      <div className="block-error-actions" onPointerDown={stop}>
        <button className="btn" onClick={() => replay([frame.id])}>
          Retry
        </button>
        {d.install && !install ? null : d.action ? (
          <button className="btn" onClick={d.action.run}>
            {d.action.label}
          </button>
        ) : (
          <button
            className="btn"
            onClick={() =>
              navigator.clipboard.writeText(message).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1400)
              })
            }
          >
            {copied ? 'Copied' : 'Copy error'}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Grow the frame until the error fits, so nothing (the art, Retry) is cut off.
 * Only grows: shrinking would undo the size the component had before it broke.
 * Layout sizes ignore canvas zoom, so the measurement is in frame units.
 */
function useGrowToFit(ref: React.RefObject<HTMLDivElement | null>, frame: Frame) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el?.firstElementChild || !el.clientHeight) return
    // Rects include canvas zoom; divide it back out.
    const box = el.getBoundingClientRect()
    const zoom = box.height / el.clientHeight
    const rects = [...el.children].map((c) => c.getBoundingClientRect())
    const cs = getComputedStyle(el)
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
    const needH = (Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top))) / zoom + padY
    const needW = Math.max(...rects.map((r) => r.width)) / zoom + padX
    const dh = Math.ceil(needH - el.clientHeight)
    const dw = Math.ceil(needW - el.clientWidth)
    if (dh > 1 || dw > 1) updateFrame(frame.id, { h: frame.h + Math.max(0, dh), w: frame.w + Math.max(0, dw) })
  })
}

/** Paste the install command here; the fetched files go into this block (no new block). */
function InstallField({ frameId }: { frameId: string }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = looksLikeInstall(value)
  const go = async () => {
    if (!ok || busy) return
    setBusy(true)
    await fetchIntoFrame(frameId, value.trim())
    setBusy(false)
  }
  return (
    <div className="install-field" onPointerDown={(e) => e.stopPropagation()}>
      <input
        value={value}
        placeholder="npx shadcn@latest add …"
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') go()
        }}
      />
      <button className="btn btn-primary" disabled={!ok || busy} onClick={go}>
        {busy ? 'Fetching…' : 'Fetch'}
      </button>
    </div>
  )
}
