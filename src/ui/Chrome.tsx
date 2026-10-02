import { useEffect, useRef, useState, type ReactNode } from 'react'
import { addNote, addText, exportBoard, fitBoard } from '../actions'
import { getState, INSPECTOR_W, useCamera, inspectorOpen, setCamera, setState, toggleLoop, useStore, viewLeft } from '../store'
import {
  CloseIcon,
  CodeIcon,
  CommandIcon,
  ExportIcon,
  LinkIcon,
  HandIcon,
  MediaIcon,
  NoteIcon,
  PointerIcon,
  SwatchIcon,
  TextIcon,
} from './icons'

/** Figma-style floating toolbar (bottom center), zoom + loop (bottom-right). */
export function Chrome() {
  const sidebar = useStore((s) => s.sidebar)
  const left = sidebar ? viewLeft() : 0
  const right = useStore(inspectorOpen) ? INSPECTOR_W : 0
  return (
    <>
      <Toolbar left={left} right={right} />
      <ViewControls right={right} />
    </>
  )
}

interface Tool {
  id: string
  label: string
  key?: string
  icon: ReactNode
  run: () => void
}

function Toolbar({ left, right }: { left: number; right: number }) {
  const idle = useStore((s) => !s.interact && !s.add)
  const hand = useStore((s) => s.hand)
  const selectedCount = useStore((s) => s.selected.length)
  const tools: Tool[] = [
    { id: 'select', label: 'Select', key: 'V', icon: <PointerIcon />, run: () => setState({ interact: null, hand: false }) },
    { id: 'hand', label: 'Hand (pan)', key: 'H', icon: <HandIcon />, run: () => setState({ hand: true, interact: null }) },
    { id: 'text', label: 'Text', key: 'T', icon: <TextIcon />, run: () => addText() },
    { id: 'note', label: 'Note', key: 'N', icon: <NoteIcon />, run: () => addNote() },
    { id: 'media', label: 'Image or video', key: 'A', icon: <MediaIcon />, run: () => setState({ add: 'media' }) },
    { id: 'code', label: 'Component', icon: <CodeIcon />, run: () => setState({ add: 'code' }) },
    { id: 'url', label: 'Link', icon: <LinkIcon />, run: () => setState({ add: 'url' }) },
    { id: 'color', label: 'Color', icon: <SwatchIcon />, run: () => setState({ add: 'color' }) },
  ]

  // One highlight that glides between tools. On first entry it fades in where you
  // are (no slide from the last spot); moving along the bar it slides.
  const bar = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ x: number; y: number; w: number; h: number; slide: boolean } | null>(null)
  const onEnter = (e: React.PointerEvent<HTMLButtonElement>) => {
    const b = e.currentTarget.getBoundingClientRect()
    const t = bar.current!.getBoundingClientRect()
    setHover((h) => ({ x: b.left - t.left, y: b.top - t.top, w: b.width, h: b.height, slide: !!h }))
  }
  const tool = { onPointerEnter: onEnter }

  return (
    <div className="toolbar-wrap" style={{ left, right }}>
      <div
        ref={bar}
        className="toolbar"
        role="toolbar"
        aria-label="Tools"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerLeave={() => setHover(null)}
      >
        <span
          className="tool-hover"
          data-visible={hover ? '' : undefined}
          data-slide={hover?.slide ? '' : undefined}
          style={
            hover ? { width: hover.w, height: hover.h, transform: `translate(${hover.x}px, ${hover.y}px)` } : undefined
          }
        />
        {tools.map((t) => (
          <button
            key={t.id}
            className="tool"
            data-active={(t.id === 'select' && idle && !hand) || (t.id === 'hand' && hand) || undefined}
            onClick={t.run}
            {...tool}
            aria-label={t.label}
            data-tip={t.key ? `${t.label}  ${t.key}` : t.label}
          >
            {t.icon}
          </button>
        ))}
        <span className="toolbar-sep" />
        <div className="toolbar-group">
          <button className="tool" onClick={() => exportBoard()} {...tool} aria-label="Export spec"
            data-tip={selectedCount ? `Export selection (${selectedCount})` : 'Export canvas'}>
            <ExportIcon />
          </button>
          <button
            className="tool"
            onClick={() => setState({ palette: true })}
            {...tool}
            aria-label="Command menu"
            data-tip="Commands  ⌘K"
          >
            <CommandIcon />
          </button>
        </div>
      </div>
    </div>
  )
}

function ViewControls({ right }: { right: number }) {
  // The rounded percent, so zooming only re-renders this when the label changes.
  const pct = useCamera((c) => Math.round(c.z * 100))
  const loop = useStore((s) => s.loop)
  const zoom = (k: number) => {
    const c = getState().camera
    const cx = (viewLeft() + window.innerWidth) / 2
    const cy = window.innerHeight / 2
    const nz = Math.min(4, Math.max(0.08, c.z * k))
    setCamera({ z: nz, x: cx - (cx - c.x) * (nz / c.z), y: cy - (cy - c.y) * (nz / c.z) })
  }
  return (
    <div className="viewctl" style={{ right: right + 12 }}>
      <button onClick={() => toggleLoop()} title="Replay animations on a loop">
        <span className="dot" data-on={loop || undefined} />
        Loop {loop ? 'on' : 'off'}
      </button>
      <span className="sep" />
      <button onClick={() => zoom(1 / 1.25)} title="Zoom out">
        −
      </button>
      <button onClick={fitBoard} title="Fit to screen  ⌘0" className="zoom">
        {pct}%
      </button>
      <button onClick={() => zoom(1.25)} title="Zoom in">
        +
      </button>
    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ['A', 'Add to canvas'],
  ['⌘V', 'Paste image, link or component'],
  ['T  /  double-click', 'Write text on the canvas'],
  ['N', 'Add a note'],
  ['⌘K', 'Command menu'],
  ['[', 'Show / hide sidebar'],
  ['Drag on empty canvas', 'Select an area'],
  ['Shift + click', 'Add to selection'],
  ['⌃⌥T', 'Tidy up selection'],
  ['⌘Z  /  ⌘⇧Z', 'Undo / redo'],
  ['H  /  Space + drag', 'Pan'],
  ['Pinch / ⌘ scroll', 'Zoom'],
  ['⌘0', 'Fit to screen'],
  ['Double-click', 'Interact with a frame'],
  ['Esc', 'Stop interacting / deselect'],
  ['R', 'Replay selected (and linked)'],
  ['⌘S', 'Save tuned values to code'],
  ['I / O', 'Mark video segment start / end'],
  ['⌘C  /  ⌘V', 'Copy / paste frames'],
  ['⌘X', 'Cut'],
  ['⌘D', 'Duplicate'],
  ['⌫', 'Delete'],
]

export function Shortcuts() {
  const open = useStore((s) => s.shortcuts)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === '?') && setState({ shortcuts: false })
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!open) return null
  return (
    <>
      <div className="palette-scrim" onPointerDown={() => setState({ shortcuts: false })} />
      <div className="dialog dialog-small" role="dialog" aria-label="Keyboard shortcuts">
        <button
          className="icon-btn dialog-close"
          onClick={() => setState({ shortcuts: false })}
          title="Close  Esc"
          aria-label="Close"
        >
          <CloseIcon />
        </button>
        <div className="dialog-body">
          <h2>Keyboard shortcuts</h2>
          <dl className="keys">
            {SHORTCUTS.map(([k, d]) => (
              <div key={k}>
                <dt>{d}</dt>
                <dd>
                  <kbd>{k}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </>
  )
}
