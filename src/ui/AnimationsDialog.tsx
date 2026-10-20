// The Animations view (sidebar → Animations): every saved animation in the boards folder, each
// playing its own timing, with Use (onto the animation last touched in the side panel), Copy
// (Motion / CSS / GSAP), Rename and Delete.
import { useEffect, useRef, useState } from 'react'
import { motionMeta, type CodeKind, type SavedMotion } from '../../shared/motions.ts'
import { applyMotion, copyMotion, currentTarget, deleteMotion, renameMotion } from '../motions'
import { setState, useStore } from '../store'
import { CloseIcon } from './icons'
import { useDismiss } from './Sidebar'

const close = () => setState({ motionsOpen: false })

export function AnimationsDialog() {
  const open = useStore((s) => s.motionsOpen)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!open) return null
  return <Body />
}

function Body() {
  const motions = useStore((s) => s.motions)
  const target = useStore(() => currentTarget())
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = (motions ?? []).filter((m) => !q || m.name.toLowerCase().includes(q) || motionMeta(m).toLowerCase().includes(q))
  return (
    <>
      <div className="palette-scrim" onPointerDown={close} />
      <div className="dialog dialog-motions" role="dialog" aria-label="Animations">
        <button className="icon-btn dialog-close" onClick={close} title="Close  Esc" aria-label="Close">
          <CloseIcon />
        </button>
        <div className="dialog-body">
          <h2>Animations</h2>
          <p className="motions-sub">
            Saved in this folder, for every canvas.{' '}
            {target ? `Use puts one on ${target.name}.` : 'Open an animation in the side panel to use one.'}
          </p>
          {(motions?.length ?? 0) > 0 && (
            <label className="motions-search">
              <SearchIcon />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search animations" autoFocus />
            </label>
          )}
          {motions?.length === 0 && (
            <p className="motions-empty">
              None yet. Click <b>Save</b> on an animation in the side panel to keep it here.
            </p>
          )}
          {motions && motions.length > 0 && shown.length === 0 && <p className="motions-empty">No animation called “{query.trim()}”.</p>}
          <div className="motions-grid">
            {shown.map((m) => (
              <Card key={m.id} m={m} canUse={!!target} />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function Card({ m, canUse }: { m: SavedMotion; canUse: boolean }) {
  const [menu, setMenu] = useState<'copy' | 'more' | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const from = [m.from?.boardName, m.from?.block].filter(Boolean).join(' · ')
  return (
    <div className="motion-card">
      <Preview m={m} />
      <div className="motion-card-text">
        {renaming ? (
          <input
            className="motion-rename"
            defaultValue={m.name}
            autoFocus
            aria-label="Name"
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                e.preventDefault()
                setRenaming(false)
              }
            }}
            onBlur={(e) => {
              if (renaming) renameMotion(m.id, e.target.value)
              setRenaming(false)
            }}
          />
        ) : (
          <span className="motion-card-name">{m.name}</span>
        )}
        <span className="motion-card-meta">{motionMeta(m)}</span>
        {from && <span className="motion-card-from">{from}</span>}
      </div>
      <div className="motion-card-actions">
        <button className="btn" onClick={() => applyMotion(m)} disabled={!canUse} title={canUse ? undefined : 'Open an animation in the side panel first'}>
          Use
        </button>
        <button className="btn motion-copy" onClick={() => setMenu(menu === 'copy' ? null : 'copy')} aria-expanded={menu === 'copy'}>
          Copy <SmallChevron />
        </button>
        <button className="btn motion-more" onClick={() => (setConfirm(false), setMenu(menu === 'more' ? null : 'more'))} aria-label="More" aria-expanded={menu === 'more'}>
          <DotsIcon />
        </button>
        {menu === 'copy' && (
          <Menu toggle=".motion-copy" onClose={() => setMenu(null)}>
            {([
              ['motion', 'For Motion'],
              ['css', 'As CSS'],
              ['gsap', 'For GSAP'],
            ] as [CodeKind, string][]).map(([kind, label]) => (
              <button key={kind} onClick={() => (setMenu(null), copyMotion(m, kind))}>
                {label}
              </button>
            ))}
          </Menu>
        )}
        {menu === 'more' && (
          <Menu toggle=".motion-more" onClose={() => setMenu(null)}>
            <button onClick={() => (setMenu(null), setRenaming(true))}>Rename</button>
            <button className="danger" onClick={() => (confirm ? (setMenu(null), deleteMotion(m.id)) : setConfirm(true))}>
              {confirm ? 'Click again to delete' : 'Delete'}
            </button>
          </Menu>
        )}
      </div>
    </div>
  )
}

function Menu({ toggle, onClose, children }: { toggle: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, toggle, onClose)
  return (
    <div className="menu motion-menu" ref={ref}>
      {children}
    </div>
  )
}

/** A dot crossing the track with the animation's own length and curve, then a pause, on repeat. */
function Preview({ m }: { m: SavedMotion }) {
  // A spring has no curve to hand CSS: an overshooting one stands in for a bouncy spring.
  const ease = m.ease ? `cubic-bezier(${m.ease.join(', ')})` : m.spring ? springEase(m.spring) : 'ease'
  const ms = m.duration ?? (m.spring ? springMs(m.spring) : 300)
  return (
    <div className="motion-preview" aria-hidden="true">
      <span style={{ animationDuration: `${Math.round(ms / 0.35)}ms`, animationTimingFunction: ease }} />
    </div>
  )
}

const springRatio = (s: NonNullable<SavedMotion['spring']>) => s.damping / (2 * Math.sqrt(s.stiffness * (s.mass ?? 1)))
const springEase = (s: NonNullable<SavedMotion['spring']>) => {
  const r = springRatio(s)
  return r >= 1 ? 'cubic-bezier(0.16, 1, 0.3, 1)' : r >= 0.5 ? 'cubic-bezier(0.34, 1.3, 0.64, 1)' : 'cubic-bezier(0.34, 1.7, 0.64, 1)'
}
/** About how long a spring takes to settle, for the preview. */
const springMs = (s: NonNullable<SavedMotion['spring']>) => Math.min(1200, Math.max(200, (4 / (springRatio(s) * Math.sqrt(s.stiffness / (s.mass ?? 1)))) * 1000 * 0.6))

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </svg>
)
const SmallChevron = () => (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m4 6 4 4 4-4" />
  </svg>
)
const DotsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <circle cx="4" cy="8" r=".6" fill="currentColor" />
    <circle cx="8" cy="8" r=".6" fill="currentColor" />
    <circle cx="12" cy="8" r=".6" fill="currentColor" />
  </svg>
)
