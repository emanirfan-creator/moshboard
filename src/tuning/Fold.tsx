import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronIcon } from '../ui/icons'
import { tick } from '../ui/sound'

const key = (id: string) => `mb:fold:${id}`
/** Open or closed as last left, or null when never toggled. */
function storedOpen(id: string): boolean | null {
  try {
    const v = localStorage.getItem(key(id))
    return v === null ? null : v !== '0'
  } catch {
    return null
  }
}

/**
 * A side-panel section that folds: chevron and title. The panel's first section starts open and
 * the rest closed; one you open or close stays that way (by `id`, else its title). Every
 * section in the panel is one, so they all behave alike.
 */
export function Fold({
  title,
  id,
  aside,
  after,
  sub,
  className,
  style,
  scan,
  reveal,
  children,
}: {
  title: ReactNode
  /** what it's remembered by, when the title isn't a plain string */
  id?: string
  /** right of the title, inside the toggle (a count, a size) */
  aside?: ReactNode
  /** right of the toggle, outside it (a Reset) */
  after?: ReactNode
  /** a line under the title (where the values come from) */
  sub?: ReactNode
  className?: string
  style?: React.CSSProperties
  /** a section found by a scan: it plays in (see [data-scan] in theme.css) */
  scan?: boolean
  /** opens it whenever this changes to something new (an analysis that just came back) */
  reveal?: unknown
  children: ReactNode
}) {
  const name = id ?? (typeof title === 'string' ? title : 'section')
  const stored = storedOpen(name)
  const [open, setOpen] = useState(stored ?? false)
  const ref = useRef<HTMLElement>(null)
  // Never toggled: open only if it's the first section in the panel (before paint, so no jump).
  useLayoutEffect(() => {
    if (stored !== null) return
    let prev = ref.current?.previousElementSibling
    while (prev && !prev.classList.contains('insp-section')) prev = prev.previousElementSibling
    if (!prev) setOpen(true)
  }, [])
  const revealed = useRef(reveal)
  useEffect(() => {
    if (reveal === revealed.current) return
    revealed.current = reveal
    if (reveal) setOpen(true)
  }, [reveal])
  const toggle = () => {
    tick(open ? 0.3 : 0.7)
    setOpen(!open)
    try {
      localStorage.setItem(key(name), open ? '0' : '1')
    } catch {
      // storage unavailable
    }
  }
  return (
    <section ref={ref} className={`insp-section fold ${className ?? ''}`} data-open={open || undefined} data-scan={scan || undefined} style={style}>
      <header className="fold-head">
        <div className="prop-head">
          <button className="prop-toggle" aria-expanded={open} onClick={toggle}>
            <ChevronIcon />
            <h3>{title}</h3>
            {aside}
          </button>
          {after}
        </div>
        {open && sub}
      </header>
      {open && children}
    </section>
  )
}
