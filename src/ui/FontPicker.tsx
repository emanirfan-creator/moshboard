import { useEffect, useMemo, useRef, useState } from 'react'
import { fontStack, type FontFamily } from '../../shared/fonts.ts'
import { loadPreview, useFontList } from '../fonts'

const ROW = 34
const NONE: FontFamily[] = []
type Source = 'all' | 'mac' | 'google'
type Row = { kind: 'head'; label: string } | { kind: 'font'; font: FontFamily }

const same = (a: Pick<FontFamily, 'family' | 'source'>, b: Pick<FontFamily, 'family' | 'source'>) =>
  a.family === b.family && a.source === b.source

/**
 * Searchable list of every font on this Mac and on Google Fonts, each shown in
 * its own typeface. Arrow keys move the selection; only visible rows are rendered.
 * `suggested` fonts are listed first, under `suggestedLabel`.
 */
export function FontPicker({
  value,
  onPick,
  autoFocus,
  suggested = NONE,
  suggestedLabel = 'Suggested',
}: {
  value?: Pick<FontFamily, 'family' | 'source'>
  onPick: (font: FontFamily) => void
  autoFocus?: boolean
  suggested?: FontFamily[]
  /** heading for the suggested group, saying what they're based on */
  suggestedLabel?: string
}) {
  const fonts = useFontList()
  const [q, setQ] = useState('')
  const [source, setSource] = useState<Source>('all')
  const [scroll, setScroll] = useState(0)
  const [height, setHeight] = useState(280)
  const listRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => {
    if (!fonts) return []
    const needle = q.trim().toLowerCase()
    const out: Row[] = []
    const add = (label: string, xs: FontFamily[]) => {
      let m = needle ? xs.filter((f) => f.family.toLowerCase().includes(needle)) : xs
      // Names that start with the search come first.
      if (needle) m = [...m].sort((a, b) => +!a.family.toLowerCase().startsWith(needle) - +!b.family.toLowerCase().startsWith(needle))
      if (!m.length) return
      if (source === 'all') out.push({ kind: 'head', label })
      out.push(...m.map((font) => ({ kind: 'font' as const, font })))
    }
    if (source === 'all' && suggested.length) {
      // The full entries know the weights and category; fall back to what the board stored.
      const full = suggested.map((s) => [...fonts.mac, ...fonts.google].find((f) => same(f, s)) ?? s)
      add(suggestedLabel, full)
    }
    if (source !== 'google') add('On this Mac', fonts.mac)
    if (source !== 'mac') add('Google Fonts', fonts.google)
    return out
  }, [fonts, q, source, suggested, suggestedLabel])

  const active = value ? rows.findIndex((r) => r.kind === 'font' && same(r.font, value)) : -1

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const reveal = (i: number) => {
    const el = listRef.current
    if (!el) return
    if (i * ROW < el.scrollTop) el.scrollTop = i * ROW
    else if ((i + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = (i + 1) * ROW - el.clientHeight
  }
  // Show the current font when the list first fills in, and again when suggestions arrive.
  const shownOnce = useRef(false)
  useEffect(() => void (shownOnce.current = false), [suggested])
  useEffect(() => {
    if (shownOnce.current || active < 0 || !listRef.current) return
    shownOnce.current = true
    listRef.current.scrollTop = Math.max(0, active * ROW - height / 2 + ROW / 2)
  }, [active, height])

  // A font set from outside the list (e.g. "Use suggested font") scrolls into view.
  const key = value ? `${value.source}:${value.family}` : ''
  useEffect(() => {
    if (shownOnce.current && active >= 0) reveal(active)
  }, [key])

  const move = (dir: 1 | -1) => {
    for (let i = active + dir; i >= 0 && i < rows.length; i += dir) {
      const r = rows[i]
      if (r.kind === 'font') return onPick(r.font), reveal(i)
    }
  }

  const first = Math.max(0, Math.floor(scroll / ROW) - 4)
  const last = Math.min(rows.length, Math.ceil((scroll + height) / ROW) + 4)
  const counts = fonts && { mac: fonts.mac.length, google: fonts.google.length }

  return (
    <div className="font-picker">
      <input
        autoFocus={autoFocus}
        value={q}
        placeholder="Search fonts"
        aria-label="Search fonts"
        onChange={(e) => {
          setQ(e.target.value)
          if (listRef.current) listRef.current.scrollTop = 0
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            move(e.key === 'ArrowDown' ? 1 : -1)
          }
        }}
      />
      <div className="segmented">
        {(
          [
            ['all', 'All'],
            ['mac', 'Mac'],
            ['google', 'Google'],
          ] as const
        ).map(([s, label]) => (
          <button key={s} data-active={source === s || undefined} onClick={() => setSource(s)}>
            {label}
            {counts && s !== 'all' && <small>{counts[s]}</small>}
          </button>
        ))}
      </div>
      <div className="font-list" ref={listRef} role="listbox" aria-label="Fonts" onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
        {!fonts ? (
          <div className="font-list-empty">Loading fonts…</div>
        ) : !rows.length ? (
          <div className="font-list-empty">{q.trim() ? `No fonts match “${q.trim()}”` : 'No fonts found'}</div>
        ) : (
          <div style={{ height: rows.length * ROW, position: 'relative' }}>
            {rows.slice(first, last).map((r, k) => {
              const i = first + k
              const top = i * ROW
              return r.kind === 'head' ? (
                <div key={`h-${r.label}`} className="font-head" style={{ top }}>
                  {r.label}
                </div>
              ) : (
                <FontRow key={`${i}-${r.font.source}-${r.font.family}`} font={r.font} top={top} selected={i === active} onPick={onPick} />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function FontRow({ font, top, selected, onPick }: { font: FontFamily; top: number; selected: boolean; onPick: (f: FontFamily) => void }) {
  // Google families load only the letters of their own name until they're picked.
  useEffect(() => {
    if (font.href) loadPreview(font.href, font.family)
  }, [font])
  return (
    <button
      className="font-row"
      role="option"
      aria-selected={selected}
      data-active={selected || undefined}
      style={{ top }}
      onClick={() => onPick(font)}
    >
      <span style={{ fontFamily: fontStack(font.family, font.category) }}>{font.family}</span>
      {font.category && <small>{font.category}</small>}
    </button>
  )
}
