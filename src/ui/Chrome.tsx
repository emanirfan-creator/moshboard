import { useEffect, useRef, useState, type ReactNode } from 'react'
import { addNote, addSection, addText, exportBoard, fitBoard } from '../actions'
import { getState, INSPECTOR_W, MAX_ZOOM, MIN_ZOOM, useCamera, inspectorOpen, setCamera, setState, sidebarShown, toggleLoop, useStore, viewLeft } from '../store'
import {
  CaretIcon,
  CloseIcon,
  CodeIcon,
  CommandIcon,
  ExportIcon,
  FontIcon,
  LinkIcon,
  HandIcon,
  MediaIcon,
  NoteIcon,
  PointerIcon,
  SectionIcon,
  SwatchIcon,
  TextIcon,
} from './icons'

/** Figma-style floating toolbar (bottom center), zoom + loop (bottom-right). */
export function Chrome() {
  const sidebar = useStore(sidebarShown)
  const left = sidebar ? viewLeft() : 0
  const right = useStore(inspectorOpen) ? INSPECTOR_W : 0
  // The visible canvas, for anything else centered on it at the bottom (toasts follow the toolbar).
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--view-left', `${left}px`)
    root.setProperty('--view-right', `${right}px`)
  }, [left, right])
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
  /** A split tool: runs the last one picked from its menu (like Figma's caret tools). */
  group?: Tool[]
}

function Toolbar({ left, right }: { left: number; right: number }) {
  const idle = useStore((s) => !s.interact && !s.add)
  const hand = useStore((s) => s.hand)
  const selectedCount = useStore((s) => s.selected.length)
  const tools: Tool[] = [
    { id: 'select', label: 'Select', key: 'V', icon: <PointerIcon />, run: () => setState({ interact: null, hand: false }) },
    { id: 'hand', label: 'Hand (pan)', key: 'H', icon: <HandIcon />, run: () => setState({ hand: true, interact: null }) },
    { id: 'text', label: 'Text', key: 'T', icon: <TextIcon />, run: () => addText() },
    {
      id: 'organize',
      label: 'Note or section',
      icon: null,
      run: () => {},
      group: [
        { id: 'note', label: 'Note', key: 'N', icon: <NoteIcon />, run: () => addNote() },
        { id: 'section', label: 'Section', key: 'S', icon: <SectionIcon />, run: () => addSection() },
      ],
    },
    { id: 'media', label: 'Image or video', key: 'A', icon: <MediaIcon />, run: () => setState({ add: 'media' }) },
    { id: 'code', label: 'Component', icon: <CodeIcon />, run: () => setState({ add: 'code' }) },
    { id: 'url', label: 'Link', icon: <LinkIcon />, run: () => setState({ add: 'url' }) },
    { id: 'color', label: 'Color', icon: <SwatchIcon />, run: () => setState({ add: 'color' }) },
    { id: 'font', label: 'Font', icon: <FontIcon />, run: () => setState({ add: 'font' }) },
  ]

  return (
    <div className="toolbar-wrap" style={{ left, right }}>
      <div
        className="toolbar"
        role="toolbar"
        aria-label="Tools"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {tools.map((t) =>
          t.group ? (
            <ToolGroup key={t.id} id={t.id} label={t.label} items={t.group} />
          ) : (
            <button
              key={t.id}
              className="tool"
              data-active={(t.id === 'select' && idle && !hand) || (t.id === 'hand' && hand) || undefined}
              onClick={t.run}
              aria-label={t.label}
              data-tip={t.key ? `${t.label}  ${t.key}` : t.label}
            >
              {t.icon}
            </button>
          ),
        )}
        <span className="toolbar-sep" />
        <div className="toolbar-group">
          <button className="tool" onClick={() => exportBoard()} aria-label="Export spec"
            data-tip={selectedCount ? `Export selection (${selectedCount})` : 'Export canvas'}>
            <ExportIcon />
          </button>
          <button
            className="tool"
            onClick={() => setState({ palette: true })}
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

/**
 * A tool with a caret: the tool runs the one last picked from the group (remembered); the
 * caret opens the group's menu above the bar.
 */
function ToolGroup({ id, label, items }: { id: string; label: string; items: Tool[] }) {
  const key = `mb:tool:${id}`
  const [current, setCurrent] = useState(() => {
    try {
      return localStorage.getItem(key) ?? items[0].id
    } catch {
      return items[0].id
    }
  })
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const t = items.find((i) => i.id === current) ?? items[0]

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [open])

  const pick = (i: Tool) => {
    setCurrent(i.id)
    setOpen(false)
    try {
      localStorage.setItem(key, i.id)
    } catch {
      // storage unavailable
    }
    i.run()
  }

  return (
    <div className="tool-split" ref={root} data-open={open || undefined}>
      <button className="tool" onClick={t.run} aria-label={t.label} data-tip={open ? undefined : t.key ? `${t.label}  ${t.key}` : t.label}>
        {t.icon}
      </button>
      <button className="tool-caret" onClick={() => setOpen(!open)} aria-label={label} aria-haspopup="menu" aria-expanded={open}>
        <CaretIcon />
      </button>
      {open && (
        <div className="tool-menu" role="menu" aria-label={label}>
          {items.map((i) => (
            <button key={i.id} role="menuitem" data-current={i.id === t.id || undefined} onClick={() => pick(i)} autoFocus={i.id === t.id}>
              {i.icon}
              <span>{i.label}</span>
              {i.key && <kbd>{i.key}</kbd>}
            </button>
          ))}
        </div>
      )}
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
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.z * k))
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
  ['S', 'Section (around the selection)'],
  ['C', 'Compare sections side by side'],
  ['⌘K', 'Command menu'],
  ['[', 'Show / hide sidebar'],
  ['Drag on empty canvas', 'Select an area'],
  ['Shift + click', 'Add to selection'],
  ['⌃⌥T', 'Arrange selection (again: next shape)'],
  ['L', 'Go to a linked block (again: the next one)'],
  ['⌥←', 'Back to where you were'],
  ['← ↑ → ↓', 'Move a block inside a layout'],
  ['↵', 'Crop a picture in a layout'],
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
