import {
  combineSwatches,
  deleteSelected,
  duplicateSelected,
  exportBoard,
  canLinkSelected,
  isLinked,
  linkSelected,
  unlinkSelected,
} from '../actions'
import { arrangeable, readingOrder } from '../arrange'
import { SelectionArrange } from './ArrangeInspector'
import { frameById, setState, useStore } from '../store'
import { CloseIcon } from '../ui/icons'
import { startCompare } from '../canvas/compare'

/** Inspector when several frames are selected: arrange them in one click. */
export function SelectionBody() {
  const ids = useStore((s) => s.selected)
  // Loose blocks, top to bottom then left to right (their order in a layout), or why they can't be arranged.
  const arrangeWhy = useStore((s) => (s.board, arrangeable().why ?? null))
  const arrangeIds = useStore((s) => (s.board, readingOrder(arrangeable().frames).join()))
  const colorish = useStore(
    (s) => s.selected.filter((id) => ['swatch', 'palette'].includes(frameById(id)?.type ?? '')).length,
  )
  const palettes = useStore((s) => s.selected.filter((id) => frameById(id)?.type === 'palette').length)
  const n = ids.length
  const sections = useStore((s) => s.selected.filter((id) => frameById(id)?.type === 'section').length)
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
        {sections >= 2 && (
          <section className="insp-section">
            <h3>Directions</h3>
            <div className="insp-buttons">
              <button className="btn btn-primary" onClick={startCompare}>
                Compare side by side <kbd>C</kbd>
              </button>
            </div>
          </section>
        )}
        {arrangeWhy ? (
          <section className="insp-section">
            <h3>Arrange</h3>
            <p className="ctl-help">{arrangeWhy}</p>
          </section>
        ) : (
          <SelectionArrange ids={arrangeIds.split(',')} />
        )}
        {(colorish >= 2 || linkable || anyLinked) && (
          <section className="insp-section">
            <h3>Combine</h3>
            <div className="insp-buttons">
              {colorish >= 2 && (
                <button className="btn" onClick={combineSwatches} title="Left to right, no duplicates">
                  {palettes >= 2 ? 'Merge palettes' : palettes ? 'Merge into palette' : 'Swatches → palette'}
                </button>
              )}
              {linkable && (
                <button className="btn" onClick={linkSelected} title="Link a reference to its copies and notes">
                  {anyLinked ? 'Add to link' : 'Link'}
                </button>
              )}
              {anyLinked && (
                <button className="btn" onClick={unlinkSelected} title="Detach from the group, or free everything linked to a reference">
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
