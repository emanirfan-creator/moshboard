import { useEffect, useRef, useState } from 'react'
import { createCanvas, deleteCanvas, refreshCanvases, renameCanvas, switchBoard } from '../actions'
import { setState, toggleSidebar, useStore } from '../store'
import { KeyboardIcon, MoreIcon, PlusIcon, RotoMark, SidebarIcon } from './icons'

export function Sidebar() {
  const open = useStore((s) => s.sidebar)
  const canvases = useStore((s) => s.canvases)
  const current = useStore((s) => s.boardName)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)

  useEffect(() => {
    refreshCanvases()
  }, [current])

  return (
    <>
      {/* Collapsed: one floating bar with the mark, canvas name and toggle (like Figma's). */}
      <button
        className="nav-pill"
        data-hidden={open || undefined}
        tabIndex={open ? -1 : 0}
        onClick={() => toggleSidebar(true)}
        title="Show sidebar  ["
      >
        <RotoMark />
        <span className="nav-pill-name">{canvases.find((c) => c.id === current)?.name ?? ''}</span>
        <span className="nav-pill-toggle">
          <SidebarIcon />
        </span>
      </button>
      <nav
        className="sidebar"
        data-open={open || undefined}
        aria-hidden={!open}
        inert={!open}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="sidebar-head">
          <span className="brand">
          <RotoMark />
          Roto
        </span>
          <button className="icon-btn" onClick={() => toggleSidebar(false)} title="Hide sidebar  [">
            <SidebarIcon />
          </button>
        </div>

        <div className="nav-section">
          <span>Canvases</span>
          <button className="icon-btn" onClick={() => setCreating(true)} title="New canvas">
            <PlusIcon />
          </button>
        </div>

        <div className="nav-list">
          {canvases.map((c) =>
            renaming === c.id ? (
              <InlineInput
                key={c.id}
                initial={c.name}
                onDone={(v) => {
                  setRenaming(null)
                  if (v) renameCanvas(v)
                }}
              />
            ) : (
              <div key={c.id} className="nav-item" data-active={c.id === current || undefined}>
                <button
                  className="nav-row"
                  onClick={() => c.id !== current && switchBoard(c.id)}
                  onDoubleClick={() => c.id === current && setRenaming(c.id)}
                  title={c.id === current ? 'Double-click to rename' : `Open ${c.name}`}
                >
                    <span className="nav-name">{c.name}</span>
                </button>
                <button className="icon-btn nav-more" onClick={() => setMenu(menu === c.id ? null : c.id)} title="More">
                  <MoreIcon />
                </button>
                {menu === c.id && (
                  <CanvasMenu
                    onClose={() => setMenu(null)}
                    onRename={async () => {
                      setMenu(null)
                      if (c.id !== current) await switchBoard(c.id)
                      setRenaming(c.id)
                    }}
                    onDelete={() => {
                      setMenu(null)
                      deleteCanvas(c.id)
                    }}
                  />
                )}
              </div>
            ),
          )}
          {creating && (
            <InlineInput
              initial=""
              placeholder="Canvas name"
              onDone={(v) => {
                setCreating(false)
                if (v) createCanvas(v)
              }}
            />
          )}
        </div>

        <div className="sidebar-foot">
          <button className="nav-row" onClick={() => setState({ shortcuts: true })}>
            <KeyboardIcon />
            <span>Shortcuts</span>
            <kbd>?</kbd>
          </button>
        </div>
      </nav>
    </>
  )
}

function InlineInput({
  initial,
  placeholder,
  onDone,
}: {
  initial: string
  placeholder?: string
  onDone: (v: string) => void
}) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (v: string) => {
    if (done.current) return
    done.current = true
    onDone(v.trim())
  }
  return (
    <input
      className="nav-input"
      autoFocus
      value={value}
      placeholder={placeholder}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') finish('')
      }}
    />
  )
}

function CanvasMenu({
  onClose,
  onRename,
  onDelete,
}: {
  onClose: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose()
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [onClose])
  return (
    <div className="menu" ref={ref}>
      <button onClick={onRename}>Rename</button>
      <button className="danger" onClick={() => (confirm ? onDelete() : setConfirm(true))}>
        {confirm ? 'Click again to delete' : 'Delete canvas'}
      </button>
    </div>
  )
}
