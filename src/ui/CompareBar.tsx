import { exitCompare } from '../canvas/compare'
import { frameById, useStore } from '../store'

/** Top of the screen while comparing: which directions are on show, and the way out. */
export function CompareBar() {
  const names = useStore((s) => s.compare?.ids.map((id) => frameById(id)?.label || 'Section').join('\u0000'))
  const pick = useStore((s) => {
    const f = s.compare?.ids.map(frameById).find((f) => f?.chosen)
    return f ? f.label || 'Section' : null
  })
  if (!names) return null
  const list = names.split('\u0000')
  return (
    <div className="compare-bar" role="status">
      <span className="compare-label">Comparing</span>
      {list.map((n, i) => (
        <span key={i} className="compare-name">
          {i > 0 && <span className="compare-vs">vs</span>}
          {n}
        </span>
      ))}
      <span className="compare-note">{pick ? `Exports use ${pick} only` : 'Approve one to build'}</span>
      <button className="btn" onClick={exitCompare}>
        Done <kbd>Esc</kbd>
      </button>
    </div>
  )
}
