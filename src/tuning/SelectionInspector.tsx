import { Fold } from './Fold'
import {
  combineSwatches,
  deleteSelected,
  duplicateSelected,
  exportBoard,
  canLinkSelected,
  isLinked,
  joinableLinks,
  joinLink,
  linkReference,
  linkSelected,
  unlinkSelected,
} from '../actions'
import { LinkTag } from '../ui/LinkTag'
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
  const anyLinked = useStore((s) => (s.board, s.selected.some((id) => !!frameById(id) && isLinked(frameById(id)!))))
  const joinable = useStore((s) => (s.board, s.selected, joinableLinks().join()))
  const refName = useStore((s) => (s.board, s.selected, linkReference()?.label ?? linkReference()?.type ?? ''))
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
          <Fold title="Directions">
            <div className="insp-buttons">
              <button className="btn btn-primary" onClick={startCompare}>
                Compare side by side <kbd>X</kbd>
              </button>
            </div>
          </Fold>
        )}
        {arrangeWhy ? (
          <Fold title="Arrange">
            <p className="ctl-help">{arrangeWhy}</p>
          </Fold>
        ) : (
          <SelectionArrange ids={arrangeIds.split(',')} />
        )}
        {colorish >= 2 && (
          <Fold title="Combine">
            <div className="insp-buttons">
              <button className="btn" onClick={combineSwatches} title="Left to right, no duplicates">
                {palettes >= 2 ? 'Merge palettes' : palettes ? 'Merge into palette' : 'Swatches → palette'}
              </button>
            </div>
          </Fold>
        )}
        {(linkable || anyLinked || joinable) && (
          // Linking is the usual reason to select a few blocks: always shown open.
          <Fold title="Link" startOpen reveal={ids.join()}>
            <div className="insp-buttons">
              {linkable && (
                <button className="btn" onClick={() => linkSelected('together')} title="One link for all of them">
                  Link together
                </button>
              )}
              {linkable && n > 2 && (
                <button className="btn" onClick={() => linkSelected('each')} title="A separate link for each">
                  Link each to {refName}
                </button>
              )}
              {joinable &&
                joinable.split(',').map((x) => (
                  <button key={x} className="btn" onClick={() => joinLink(Number(x))}>
                    Add to link <LinkTag n={Number(x)} />
                  </button>
                ))}
              {anyLinked && (
                <button className="btn" onClick={() => unlinkSelected()} title="Leave their links (a reference ends its links)">
                  Unlink
                </button>
              )}
            </div>
          </Fold>
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
