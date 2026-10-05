import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createCanvas, deleteCanvas, duplicateCanvas, refreshCanvases, renameCanvas, switchBoard } from '../actions'
import { setState, sidebarShown, toggleSidebar, useStore } from '../store'
import { chooseFolder, FOLDER_ONLY, removeFolder, renameFolder, switchFolder } from '../folder/folder'
import { AppMark } from './AppMark'
import { CheckIcon, ChevronIcon, FolderIcon, KeyboardIcon, MoreIcon, PlusIcon, SidebarIcon } from './icons'

export function Sidebar() {
  const open = useStore(sidebarShown)
  const canvases = useStore((s) => s.canvases)
  const current = useStore((s) => s.boardName)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const pill = useRef<HTMLButtonElement>(null)
  const [pillW, setPillW] = useState(0)
  const name = canvases.find((c) => c.id === current)?.name ?? ''

  useEffect(() => {
    refreshCanvases()
  }, [current])

  // The panel opens out of the bar's box, whose width follows the canvas name.
  useLayoutEffect(() => {
    if (pill.current) setPillW(pill.current.offsetWidth)
  }, [name])

  return (
    <>
      {/* Collapsed: one floating bar with the mark, canvas name and toggle (like Figma's). */}
      <button
        ref={pill}
        className="nav-pill"
        data-hidden={open || undefined}
        tabIndex={open ? -1 : 0}
        onClick={() => toggleSidebar(true)}
        title="Show sidebar  ["
      >
        <AppMark />
        <span className="nav-pill-name">{name}</span>
        <span className="nav-pill-toggle">
          <SidebarIcon />
        </span>
      </button>
      <nav
        className="sidebar"
        data-open={open || undefined}
        aria-hidden={!open}
        inert={!open}
        style={pillW ? ({ '--pill-w': `${pillW}px` } as React.CSSProperties) : undefined}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="sidebar-head">
          <span className="brand">
          <AppMark />
          Moshboard
        </span>
          <button className="icon-btn" onClick={() => toggleSidebar(false)} title="Hide sidebar  [">
            <SidebarIcon open />
          </button>
        </div>

        {FOLDER_ONLY && <FolderSwitch />}

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
  useDismiss(ref, '.nav-more', onClose)
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

/** Closes a menu on a press anywhere outside it, Escape, or the window losing focus. */
function useDismiss(ref: React.RefObject<HTMLDivElement | null>, toggleSelector: string, onClose: () => void) {
  useEffect(() => {
    // Anywhere outside closes it. Its own toggle button is left to toggle it, or the
    // press would close it and the click reopen it.
    const away = (e: PointerEvent) => {
      const t = e.target as Element
      const toggle = ref.current?.parentElement?.querySelector(toggleSelector)
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
}

/**
 * The open folder, and the others connected on this site (one per project, say). Folders show by
 * name only, never as a path. Double-click a name to rename it (two folders can share one).
 */
function FolderSwitch() {
  const folders = useStore((s) => s.folders)
  const current = useStore((s) => s.folderId)
  const name = useStore((s) => s.folder?.name ?? '')
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const close = () => {
    setOpen(false)
    setRenaming(null)
  }
  if (!current) return null
  const run = (f: () => unknown) => () => {
    close()
    f()
  }
  return (
    <div className="folder-switch">
      <button className="nav-row folder-switch-btn" data-open={open || undefined} onClick={() => (open ? close() : setOpen(true))} title="Switch folder">
        <FolderIcon />
        <span className="nav-name">{name}</span>
        <ChevronIcon />
      </button>
      {open && (
        <FolderMenu menuRef={ref} onClose={close}>
          {folders.map((f) =>
            renaming === f.id ? (
              <InlineInput
                key={f.id}
                initial={f.name}
                onDone={(v) => {
                  setRenaming(null)
                  if (v) renameFolder(f.id, v)
                }}
              />
            ) : (
              <button
                key={f.id}
                className="folder-item"
                data-missing={f.missing || undefined}
                onClick={run(() => switchFolder(f.id))}
                onDoubleClick={() => !f.missing && setRenaming(f.id)}
                title={f.missing ? 'Moved or deleted. Click to check again' : 'Double-click to rename'}
              >
                <span className="folder-check">{f.id === current && <CheckIcon />}</span>
                <span className="nav-name">{f.name}</span>
                {f.missing && <span className="folder-missing">Not found</span>}
              </button>
            ),
          )}
          <div className="menu-sep" />
          <button onClick={run(chooseFolder)}>Open folder…</button>
          <button onClick={run(() => removeFolder(current))}>Remove from list</button>
        </FolderMenu>
      )}
    </div>
  )
}

function FolderMenu({ menuRef, onClose, children }: { menuRef: React.RefObject<HTMLDivElement | null>; onClose: () => void; children: React.ReactNode }) {
  useDismiss(menuRef, '.folder-switch-btn', onClose)
  return (
    <div className="menu folder-menu" ref={menuRef}>
      {children}
    </div>
  )
}
