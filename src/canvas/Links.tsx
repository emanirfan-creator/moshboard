import { useMemo } from 'react'
import type { Frame } from '../../shared/types.ts'
import { useStore } from '../store'

interface Pt {
  x: number
  y: number
}

/**
 * The line between two linked frames: from the facing sides, straight when they line up,
 * else a soft S-curve. Null when they overlap (nothing to draw between them).
 */
function route(a: Frame, b: Frame): { d: string; from: Pt; to: Pt } | null {
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w))
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h))
  if (gapX < 8 && gapY < 8) return null
  // Along the overlap when they share a row/column, so side-by-side blocks get a straight line.
  const mid = (a0: number, a1: number, b0: number, b1: number, ac: number, bc: number): [number, number] => {
    const lo = Math.max(a0, b0)
    const hi = Math.min(a1, b1)
    return hi - lo > 24 ? [(lo + hi) / 2, (lo + hi) / 2] : [ac, bc]
  }
  if (gapX >= gapY) {
    const right = b.x > a.x
    const [ya, yb] = mid(a.y, a.y + a.h, b.y, b.y + b.h, a.y + a.h / 2, b.y + b.h / 2)
    const from = { x: right ? a.x + a.w : a.x, y: ya }
    const to = { x: right ? b.x : b.x + b.w, y: yb }
    const c = Math.max(32, Math.abs(to.x - from.x) / 2) * (right ? 1 : -1)
    return { d: `M${from.x},${from.y} C${from.x + c},${from.y} ${to.x - c},${to.y} ${to.x},${to.y}`, from, to }
  }
  const down = b.y > a.y
  const [xa, xb] = mid(a.x, a.x + a.w, b.x, b.x + b.w, a.x + a.w / 2, b.x + b.w / 2)
  const from = { x: xa, y: down ? a.y + a.h : a.y }
  const to = { x: xb, y: down ? b.y : b.y + b.h }
  const c = Math.max(32, Math.abs(to.y - from.y) / 2) * (down ? 1 : -1)
  return { d: `M${from.x},${from.y} C${from.x},${from.y + c} ${to.x},${to.y - c} ${to.x},${to.y}`, from, to }
}

/**
 * Links drawn on the canvas: a copy to its reference, a note to what it's about. Faint at
 * rest; when either end is selected or hovered the line brightens and a dash runs from the
 * reference to what follows it.
 */
export function Links() {
  const frames = useStore((s) => s.board?.frames)
  const selected = useStore((s) => s.selected)
  const hover = useStore((s) => s.hover)
  const compare = useStore((s) => s.compare)
  const lines = useMemo(() => {
    if (!frames) return []
    // Comparing: only frames on show, where they're drawn.
    const shown = compare
      ? frames.flatMap((f) => {
          const o = compare.offsets[f.id]
          return o ? [{ ...f, x: f.x + o.dx, y: f.y + o.dy }] : []
        })
      : frames
    const byId = new Map(shown.map((f) => [f.id, f]))
    return shown.flatMap((f) => {
      const ref = f.link ? byId.get(f.link) : undefined
      const r = ref && route(ref, f)
      return r ? [{ id: f.id, ref: ref.id, note: f.type === 'note', ...r }] : []
    })
  }, [frames, compare])
  if (!lines.length) return null
  return (
    <svg className="links" aria-hidden>
      {lines.map((l) => {
        const on = selected.includes(l.id) || selected.includes(l.ref) || hover === l.id || hover === l.ref
        return (
          <g key={l.id} data-on={on || undefined} data-note={l.note || undefined}>
            <path className="link-line" d={l.d} />
            <path className="link-flow" d={l.d} />
            <circle className="link-end link-ref" cx={l.from.x} cy={l.from.y} />
            <circle className="link-end" cx={l.to.x} cy={l.to.y} />
          </g>
        )
      })}
    </svg>
  )
}
