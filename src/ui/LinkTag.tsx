import { linkColor } from '../../shared/frame-links.ts'

/** A link's number on its color: on block headers, buttons and menus, so you can tell links apart. */
export function LinkTag({ n }: { n: number }) {
  return (
    <span className="link-tag" style={{ '--c': linkColor(n) } as React.CSSProperties}>
      {n}
    </span>
  )
}
