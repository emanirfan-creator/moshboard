import { Fold } from './Fold'
import type { Frame } from '../../shared/types.ts'
import { allLinks, linkNumbers } from '../../shared/frame-links.ts'
import { unlinkSelected } from '../actions'
import { jumpTo, linkedTo } from '../canvas/follow'
import { frameById, useStore } from '../store'
import { LinkTag } from '../ui/LinkTag'
import { POST_SITE } from '../../shared/posts.ts'

const nameOf = (f?: Frame) => f?.label || (f?.post ? POST_SITE[f.post.provider] : f ? { code: 'Component', url: 'Website', note: 'Note' }[f.type as string] || f.type[0].toUpperCase() + f.type.slice(1) : '')

/**
 * The links a selected block is in, one row each: what's at the other end, go there, and
 * leave the link. A reference ends the link (everything following it lets go); a block
 * following one leaves it alone.
 */
export function LinksBody({ frame }: { frame: Frame }) {
  const rows = useStore((s) => {
    const frames = s.board?.frames ?? []
    const all = allLinks(frames)
    return linkNumbers(frame.id, frames)
      .map((n) => {
        const l = all.get(n)
        if (!l) return ''
        const isRef = l.ref === frame.id
        return [n, isRef ? 'ref' : 'member', isRef ? l.members.join(' ') : l.ref].join('|')
      })
      .filter(Boolean)
      .join(',')
  })
  if (!rows) return null
  return (
    <Fold title="Links">
      <div className="link-rows">
        {rows.split(',').map((row) => {
          const [ns, role, others] = row.split('|')
          const n = Number(ns)
          const ids = others.split(' ').filter(Boolean)
          const isRef = role === 'ref'
          const what = isRef ? (ids.length === 1 ? `Followed by ${nameOf(frameById(ids[0]))}` : `${ids.length} follow this`) : `Follows ${nameOf(frameById(ids[0]))}`
          // Go to the other end; from a reference with several, the first one (L steps on).
          const target = isRef ? linkedTo(frame.id).find((id) => ids.includes(id)) : ids[0]
          return (
            <div key={n} className="link-row">
              <LinkTag n={n} />
              <span className="link-row-what" title={what}>
                {what}
              </span>
              {target && (
                <button className="btn" onClick={() => jumpTo(target)} title="Go there  L">
                  Go to
                </button>
              )}
              <button
                className="btn"
                onClick={() => unlinkSelected(n)}
                title={isRef ? 'End this link: everything following this lets go' : 'Leave this link; the others stay linked'}
              >
                {isRef ? 'End link' : 'Unlink'}
              </button>
            </div>
          )
        })}
      </div>
    </Fold>
  )
}
