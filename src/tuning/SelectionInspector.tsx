import type { ReactNode } from 'react'
import {
  alignSelection,
  combineSwatches,
  deleteSelected,
  distributeSelection,
  duplicateSelected,
  exportBoard,
  lastLayout,
  canLinkSelected,
  isLinked,
  linkSelected,
  unlinkSelected,
  tidySelection,
  type AlignEdge,
} from '../actions'
import type { LayoutKind } from '../layout'
import { frameById, setState, useStore } from '../store'
import { CloseIcon } from '../ui/icons'

const I = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)

const ALIGN: { edge: AlignEdge; label: string; icon: ReactNode }[] = [
  { edge: 'left', label: 'Align left', icon: <I d="M2.5 2v12M5 5h8v2.5H5zM5 9.5h5V12H5z" /> },
  { edge: 'hcenter', label: 'Align center', icon: <I d="M8 2v12M4 5h8v2.5H4zM5.5 9.5h5V12h-5z" /> },
  { edge: 'right', label: 'Align right', icon: <I d="M13.5 2v12M3 5h8v2.5H3zM6 9.5h5V12H6z" /> },
  { edge: 'top', label: 'Align top', icon: <I d="M2 2.5h12M5 5v8h2.5V5zM9.5 5v5H12V5z" /> },
  { edge: 'vcenter', label: 'Align middle', icon: <I d="M2 8h12M5 4v8h2.5V4zM9.5 5.5v5H12v-5z" /> },
  { edge: 'bottom', label: 'Align bottom', icon: <I d="M2 13.5h12M5 3v8h2.5V3zM9.5 6v5H12V6z" /> },
]

const LAYOUTS: { kind: LayoutKind; title: string; hint: string; cells: [number, number, number, number][] }[] = [
  {
    kind: 'bento',
    title: 'Bento',
    hint: 'Spans by shape, no gaps',
    cells: [
      [2, 2, 33, 21],
      [37, 2, 17, 10],
      [37, 13, 17, 10],
      [2, 25, 17, 13],
      [21, 25, 33, 13],
    ],
  },
  {
    kind: 'masonry',
    title: 'Masonry',
    hint: 'Columns, keeps aspect',
    cells: [
      [2, 2, 16, 14],
      [20, 2, 16, 22],
      [38, 2, 16, 10],
      [2, 18, 16, 20],
      [20, 26, 16, 12],
      [38, 14, 16, 24],
    ],
  },
  {
    kind: 'rows',
    title: 'Rows',
    hint: 'Packed rows, sizes kept',
    cells: [
      [2, 2, 20, 14],
      [24, 2, 14, 14],
      [40, 2, 14, 14],
      [2, 20, 26, 18],
      [30, 20, 24, 18],
    ],
  },
]

/** Inspector when several frames are selected: arrange them in one click. */
export function SelectionBody() {
  const last = lastLayout()
  const ids = useStore((s) => s.selected)
  const colorish = useStore(
    (s) => s.selected.filter((id) => ['swatch', 'palette'].includes(frameById(id)?.type ?? '')).length,
  )
  const palettes = useStore((s) => s.selected.filter((id) => frameById(id)?.type === 'palette').length)
  const n = ids.length
  // Re-read on any board change, so the buttons follow links made or removed elsewhere.
  const linkable = useStore((s) => (s.board, canLinkSelected()))
  const anyLinked = useStore((s) => s.selected.some((id) => !!frameById(id) && isLinked(frameById(id)!)))
  return (
    <>
      <header className="insp-head">
        <span className="insp-title">{n} selected</span>
        <span className="insp-kind">Selection</span>
        <button className="icon-btn" onClick={() => setState({ selected: [] })} title="Deselect  Esc" aria-label="Deselect">
          <CloseIcon />
        </button>
      </header>
      <div className="insp-scroll">
        <section className="insp-section">
          <h3>Tidy up</h3>
          <div className="layouts">
            {LAYOUTS.map((l) => (
              <button key={l.kind} className="layout-opt" data-active={last === l.kind || undefined} onClick={() => tidySelection(l.kind)}>
                <svg width="56" height="40" viewBox="0 0 56 40" aria-hidden>
                  {l.cells.map(([x, y, w, h], i) => (
                    <rect key={i} x={x} y={y} width={w} height={h} rx="2" />
                  ))}
                </svg>
                <span>{l.title}</span>
                <small>{l.hint}</small>
              </button>
            ))}
          </div>
          <p className="ctl-help">
            <kbd>⌃⌥T</kbd> repeats the last layout. Text becomes section headers.
          </p>
        </section>
        <section className="insp-section">
          <h3>Align</h3>
          <div className="align-grid">
            {ALIGN.map((a) => (
              <button key={a.edge} className="tool" onClick={() => alignSelection(a.edge)} aria-label={a.label} data-tip={a.label}>
                {a.icon}
              </button>
            ))}
          </div>
          {n >= 3 && (
            <div className="insp-buttons">
              <button className="btn" onClick={() => distributeSelection('x')}>
                Space evenly ↔
              </button>
              <button className="btn" onClick={() => distributeSelection('y')}>
                Space evenly ↕
              </button>
            </div>
          )}
        </section>
        {(colorish >= 2 || linkable || anyLinked) && (
          <section className="insp-section">
            <h3>Combine</h3>
            <div className="insp-buttons">
              {colorish >= 2 && (
                <button className="btn" onClick={combineSwatches} title="Colors in left-to-right order, duplicates dropped">
                  {palettes >= 2 ? 'Merge palettes' : palettes ? 'Merge into palette' : 'Swatches → palette'}
                </button>
              )}
              {linkable && (
                <button className="btn" onClick={linkSelected} title="Link a reference with its copies and notes">
                  {anyLinked ? 'Add to link' : 'Link'}
                </button>
              )}
              {anyLinked && (
                <button className="btn" onClick={unlinkSelected} title="A copy or note leaves the group; a reference releases everything linked to it">
                  Unlink
                </button>
              )}
            </div>
          </section>
        )}
      </div>
      <footer className="insp-foot">
        <button className="btn" onClick={() => duplicateSelected()}>
          Duplicate
        </button>
        <button className="btn" onClick={deleteSelected}>
          Delete
        </button>
        <span className="grow" />
        <button className="btn btn-primary" onClick={() => exportBoard()}>
          Export {n}
        </button>
      </footer>
    </>
  )
}
