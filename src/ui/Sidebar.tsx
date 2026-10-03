import { useEffect, useRef, useState } from 'react'
import { createCanvas, deleteCanvas, duplicateCanvas, refreshCanvases, renameCanvas, switchBoard } from '../actions'
import { setState, toggleSidebar, useStore } from '../store'
import { KeyboardIcon, MoreIcon, PlusIcon, AppMark, SidebarIcon } from './icons'

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
        <AppMark />
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
          <AppMark />
          Moshboard
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
                    onDuplicate={() => {
                      setMenu(null)
                      duplicateCanvas(c.id)
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
  onDuplicate,
  onDelete,
}: {
  onClose: () => void
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Anywhere outside closes it. Its own ⋯ button is left to toggle it, or the
    // press would close it and the click reopen it.
    const away = (e: PointerEvent) => {
      const t = e.target as Element
      const toggle = ref.current?.parentElement?.querySelector('.nav-more')
      if (!ref.current?.contains(t) && !toggle?.contains(t)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // Clicks inside a code frame's iframe never reach this window; it blurs instead.
    const blur = () => onClose()
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', blur)
    }
  }, [onClose])
  return (
    <div className="menu" ref={ref}>
      <button onClick={onRename}>Rename</button>
      <button onClick={onDuplicate}>Duplicate</button>
      <button className="danger" onClick={() => (confirm ? onDelete() : setConfirm(true))}>
        {confirm ? 'Click again to delete' : 'Delete canvas'}
      </button>
    </div>
  )
}
