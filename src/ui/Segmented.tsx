import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { switchTab } from './sound'

type Pill = { x: number; w: number; slide: boolean }
/** Where each `remember`ed control's pill last sat, so a remounted one slides on from there. */
const lastPill = new Map<string, Pill>()

/**
 * Segmented tabs: one indicator slides to the chosen segment (none lit when
 * `value` matches no option), and switching taps from where the segment sits.
 * `remember` keys the pill's position across remounts (a switch that swaps the
 * form it sits in).
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  remember,
  style,
}: {
  options: { id: T; label: ReactNode }[]
  value: T | null | undefined
  onChange: (id: T) => void
  remember?: string
  style?: CSSProperties
}) {
  const root = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<Pill | null>(() => {
    const p = remember ? lastPill.get(remember) : undefined
    return p ? { ...p, slide: false } : null
  })
  const index = options.findIndex((o) => o.id === value)

  useLayoutEffect(() => {
    const el = root.current?.querySelectorAll<HTMLElement>('button')[index]
    if (!el) return setPill(null)
    const measure = () =>
      setPill((p) => {
        const next = { x: el.offsetLeft, w: el.offsetWidth, slide: !!p }
        if (remember) lastPill.set(remember, next)
        return next
      })
    measure()
    // Labels can change width (counts loading in, fonts settling).
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [index, options.length])

  return (
    <div ref={root} className="segmented" style={style} role="tablist">
      {pill && (
        <span
          className="segmented-pill"
          data-slide={pill.slide || undefined}
          style={{ width: pill.w, transform: `translateX(${pill.x}px)` }}
        />
      )}
      {options.map((o, i) => (
        <button
          key={String(o.id)}
          role="tab"
          aria-selected={i === index}
          data-active={i === index || undefined}
          onClick={() => {
            if (i !== index) switchTab(i, options.length)
            onChange(o.id)
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
