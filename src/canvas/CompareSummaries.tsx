import { boardFonts, fontStack } from '../../shared/fonts.ts'
import { isSection, sectionContents } from '../../shared/sections.ts'
import type { Frame } from '../../shared/types.ts'
import { frameById, useStore } from '../store'
import { COMPARE_SUMMARY_GAP } from './compare'

const KIND: Partial<Record<Frame['type'], [string, string]>> = {
  image: ['image', 'images'],
  video: ['video', 'videos'],
  url: ['site', 'sites'],
  code: ['component', 'components'],
  note: ['note', 'notes'],
}

/**
 * Comparing: under each direction, what it's made of at a glance (its colors, its fonts set
 * in themselves, what kinds of references it holds), so two directions read side by side.
 */
export function CompareSummaries() {
  const compare = useStore((s) => s.compare)
  const frames = useStore((s) => s.board?.frames)
  if (!compare || !frames) return null
  return (
    <>
      {compare.ids.map((id) => {
        const s = frameById(id)
        const off = compare.offsets[id]
        if (!s || !off) return null
        const inner = sectionContents(s, frames).filter((f) => !isSection(f))
        const colors = [...new Set(inner.flatMap((f) => (f.type === 'palette' ? (f.colors ?? []).map((c) => c.hex) : f.type === 'swatch' && f.color ? [f.color] : [])))]
        const fonts = boardFonts(inner)
        const counts = Object.entries(KIND)
          .map(([type, [one, many]]) => {
            const n = inner.filter((f) => f.type === type).length
            return n ? `${n} ${n === 1 ? one : many}` : ''
          })
          .filter(Boolean)
        return (
          <div
            key={id}
            className="compare-summary"
            style={{ left: s.x + off.dx, top: s.y + off.dy + s.h + COMPARE_SUMMARY_GAP, '--w': `${s.w}px` } as React.CSSProperties}
          >
            {colors.length > 0 && (
              <div className="compare-colors">
                {colors.slice(0, 12).map((c) => (
                  <i key={c} style={{ background: c }} title={c} />
                ))}
              </div>
            )}
            {fonts.length > 0 && (
              <div className="compare-fonts">
                {fonts.slice(0, 3).map((f) => (
                  <span key={f.family} style={{ fontFamily: fontStack(f.family, f.category) }}>
                    {f.family}
                  </span>
                ))}
              </div>
            )}
            {counts.length > 0 ? (
              <div className="compare-counts">{counts.join(' · ')}</div>
            ) : (
              !colors.length && !fonts.length && <div className="compare-counts">Nothing in it yet</div>
            )}
          </div>
        )
      })}
    </>
  )
}
