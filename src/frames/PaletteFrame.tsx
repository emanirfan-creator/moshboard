import { useLayoutEffect, useRef, useState, type PointerEvent as RPE } from 'react'
import { contrast, inkFor, mixHex, nameColor, paletteShares, shadesOf, type PaletteColor } from '../../shared/color.ts'
import type { Frame } from '../../shared/types.ts'
import { setPaletteColors } from '../actions'
import { copyText } from '../clipboard'
import { setState, toast, useStore } from '../store'
import { cue, drop, grab, shift } from '../ui/sound'

const ICON = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const stop = (e: RPE) => e.stopPropagation()

/** WCAG grade for body text on this color. */
const grade = (ratio: number) => (ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'Large' : 'Low')

function setColors(frame: Frame, colors: PaletteColor[]) {
  setPaletteColors(frame.id, colors)
}

/**
 * Palette: full-height columns with hex + name. Hovering a column
 * (once the palette is selected) shows its tools; + between columns inserts a
 * blend. While the inspector's Adjust panel is open, the block shows before/after.
 */
export function PaletteFrame({ frame, active }: { frame: Frame; active: boolean }) {
  const colors = frame.colors ?? []
  const draft = useStore((s) => (s.paletteDraft?.id === frame.id ? s.paletteDraft.colors : null))
  const [shades, setShades] = useState<number | null>(null)
  // Reorder drag: which column is moving, where it would land, and whether it's
  // still held (false while it springs into its slot after release).
  const [drag, setDrag] = useState<{ from: number; to: number; held: boolean } | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const cols = useRef(new Map<number, HTMLDivElement>())
  const landed = useRef(false)
  // Set shares widen columns by how much of the palette each color is (reordering holds them even).
  const shares = paletteShares(colors)
  const order = colors.map((_, i) => i)
  if (drag) order.splice(drag.to, 0, ...order.splice(drag.from, 1))

  // Saving the new order re-renders the columns in it, so drop the transforms that
  // were holding them there (before paint, so nothing jumps).
  useLayoutEffect(() => {
    if (!landed.current) return
    landed.current = false
    for (const el of cols.current.values()) el.style.transform = ''
  }, [colors])

  const update = (next: PaletteColor[]) => setColors(frame, next)
  const remove = (i: number) => {
    if (colors.length <= 2) return
    update(colors.filter((_, j) => j !== i))
    cue('remove')
  }
  const toggleLock = (i: number) => {
    cue(colors[i].locked ? 'toggle-off' : 'toggle-on')
    update(colors.map((c, j) => (j === i ? { ...c, locked: !c.locked } : c)))
  }
  const insert = (i: number) => {
    if (colors.length >= 10) return toast('A palette holds up to 10 colors')
    const hex = mixHex(colors[i - 1].hex, colors[i].hex)
    update([...colors.slice(0, i), { hex }, ...colors.slice(i)])
  }
  const copy = (i: number, hex: string) =>
    copyText(hex.toUpperCase()).then((ok) => {
      if (!ok) return toast('Couldn’t copy to the clipboard', true)
      setCopied(i)
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1400)
    })

  // Drag a column's handle sideways to reorder, after Space UI's liquid sortable
  // list: the held column follows the pointer, stretching and leaning with its
  // speed, and the others spring aside into their new slots. The order is saved
  // once everything has landed.
  const startReorder = (i: number) => (e: RPE<HTMLButtonElement>) => {
    e.stopPropagation()
    e.preventDefault()
    if (drag) return // still landing from the last one
    const block = e.currentTarget.closest('.pal-block') as HTMLElement
    const n = colors.length
    const zoom = block.getBoundingClientRect().width / block.offsetWidth || 1
    const w = block.offsetWidth / n
    const at = (slot: number) => slot / (n - 1)
    const springs = colors.map(() => ({ x: 0, v: 0 }))
    const startX = e.clientX
    let to = i
    let held = true
    let dragX = 0
    let momentum = 0
    let lastX = e.clientX
    let lastT = performance.now()
    let prev = lastT
    const slotOf = (j: number) => {
      const o = colors.map((_, k) => k)
      o.splice(to, 0, ...o.splice(i, 1))
      return o.indexOf(j)
    }

    const frame = (t: number) => {
      const dt = Math.min((t - prev) / 1000, 1 / 30)
      prev = t
      momentum *= Math.exp(-dt * 8)
      let busy = held || Math.abs(momentum) > 0.01
      springs.forEach((s, j) => {
        if (j === i && held) s.x = dragX
        else {
          // Space UI's spring (stiffness 420, damping 28, mass 0.8): settles with a small overshoot.
          const target = (slotOf(j) - j) * w
          s.v += ((target - s.x) * 525 - s.v * 35) * dt
          s.x += s.v * dt
          if (Math.abs(target - s.x) < 0.3 && Math.abs(s.v) < 5) {
            s.x = target
            s.v = 0
          } else busy = true
        }
        const el = cols.current.get(j)
        if (!el) return
        if (j !== i) el.style.transform = `translateX(${s.x}px)`
        else {
          const stretch = 1 + Math.abs(momentum) * 0.03
          el.style.transform = `translateX(${s.x}px) scale(${stretch}, ${2 - stretch}) skewX(${-momentum * 0.5}deg)`
        }
      })
      if (busy) requestAnimationFrame(frame)
      else land()
    }
    const move = (ev: PointerEvent) => {
      const now = performance.now()
      const speed = ((ev.clientX - lastX) / zoom / Math.max(8, now - lastT)) * 16
      momentum += (Math.max(-3, Math.min(3, speed)) - momentum) * 0.5
      lastX = ev.clientX
      lastT = now
      // A little give past either end, then it stops.
      dragX = Math.max(-(i + 0.3) * w, Math.min((n - 1 - i + 0.3) * w, (ev.clientX - startX) / zoom))
      const next = Math.max(0, Math.min(n - 1, Math.round(i + dragX / w)))
      if (next !== to) {
        to = next
        setDrag({ from: i, to, held: true })
        shift(at(to))
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      delete document.body.dataset.grabbing
      held = false
      setDrag({ from: i, to, held: false })
      drop(at(to))
    }
    const land = () => {
      delete block.dataset.reordering
      if (to !== i) {
        landed.current = true
        const next = [...colors]
        next.splice(to, 0, ...next.splice(i, 1))
        update(next)
      } else for (const el of cols.current.values()) el.style.transform = ''
      setDrag(null)
    }

    block.dataset.reordering = ''
    document.body.dataset.grabbing = ''
    setDrag({ from: i, to, held: true })
    grab(at(i))
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    requestAnimationFrame(frame)
  }

  if (draft) {
    return (
      <div className="pal-block palette-compare">
        <Row colors={colors} small />
        <Row colors={draft} small />
      </div>
    )
  }

  return (
    <div className="pal-block" data-active={active || undefined}>
      {colors.map((_, i) => {
        const c = colors[i]
        const ink = inkFor(c.hex)
        const showShades = shades === i
        return (
          <div
            key={i}
            ref={(el) => {
              if (el) cols.current.set(i, el)
              else cols.current.delete(i)
            }}
            className="palette-col"
            data-lifted={(drag?.held && drag.from === i) || undefined}
            data-moving={drag?.from === i || undefined}
            style={{ background: c.hex, color: ink, ...(shares ? { '--g': shares[i] * colors.length } : {}) } as React.CSSProperties}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setState({ selected: [frame.id], paletteFocus: i })
            }}
          >
            {showShades ? (
              <div className="palette-shades" onPointerDown={stop}>
                {shadesOf(c.hex).map((s) => (
                  <button
                    key={s}
                    style={{ background: s, color: inkFor(s) }}
                    title={s.toUpperCase()}
                    onClick={() => {
                      update(colors.map((x, j) => (j === i ? { ...x, hex: s } : x)))
                      setShades(null)
                    }}
                  >
                    {s.slice(1).toUpperCase()}
                  </button>
                ))}
              </div>
            ) : (
              active && (
                <>
                  <button className="palette-grip" title="Drag to reorder" onPointerDown={startReorder(i)}>
                    <svg width="16" height="10" viewBox="0 0 16 10" fill="currentColor" aria-hidden>
                      {[3, 7].map((y) => [4, 8, 12].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.1" />))}
                    </svg>
                  </button>
                  <div className="palette-tools" onPointerDown={stop}>
                    <button title="Copy hex" onClick={() => copy(i, c.hex)} data-on={copied === i || undefined}>
                      {copied === i ? (
                        <svg {...ICON}>
                          <path d="m3.5 8.5 3 3 6-7" />
                        </svg>
                      ) : (
                        <svg {...ICON}>
                          <path d="M6 3.5h5.5a1 1 0 0 1 1 1V10M3.5 6.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1z" />
                        </svg>
                      )}
                    </button>
                    <button title="Shades" onClick={() => setShades(i)}>
                      <svg {...ICON}>
                        <path d="m8 2.5 5.5 3L8 8.5 2.5 5.5zM2.5 8.2 8 11.2l5.5-3M2.5 10.8 8 13.8l5.5-3" />
                      </svg>
                    </button>
                    <button
                      title={c.locked ? 'Unlock' : 'Lock (Generate keeps it)'}
                      onClick={() => toggleLock(i)}
                      data-on={c.locked || undefined}
                    >
                      <svg {...ICON}>
                        <rect x="4" y="7.5" width="8" height="6" rx="1.5" />
                        {c.locked ? (
                          <path d="M5.75 7.5V5.5a2.25 2.25 0 0 1 4.5 0v2" />
                        ) : (
                          <path d="M5.75 7.5V5.5a2.25 2.25 0 0 1 4.4-.7" />
                        )}
                      </svg>
                    </button>
                    <button title="Remove" onClick={() => remove(i)} disabled={colors.length <= 2}>
                      <svg {...ICON}>
                        <path d="M3.5 5h9M6.5 5V3.5h3V5M5 5l.5 8h5l.5-8" />
                      </svg>
                    </button>
                  </div>
                </>
              )
            )}
            {copied === i && <span className="palette-copied">Copied {c.hex.toUpperCase()}</span>}
            {!showShades && (
              <>
                <span className="palette-index">
                  {String(order.indexOf(i) + 1).padStart(2, '0')}
                  {c.locked && (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-label="Locked"
                    >
                      <rect x="4" y="7.5" width="8" height="6" rx="1.5" />
                      <path d="M5.75 7.5V5.5a2.25 2.25 0 0 1 4.5 0v2" />
                    </svg>
                  )}
                </span>
                <div className="palette-label">
                  <span className="palette-name">{nameColor(c.hex)}</span>
                  <span className="palette-hex">#{c.hex.slice(1).toUpperCase()}</span>
                </div>
                <span
                  className="palette-grade"
                  title={`Contrast ${contrast(c.hex, ink).toFixed(1)}:1 with ${ink === '#ffffff' ? 'white' : 'dark'} text`}
                >
                  {grade(contrast(c.hex, ink))}
                </span>
              </>
            )}
            {active && !drag && i > 0 && (
              <button
                className="palette-insert"
                title="Add a color here"
                onPointerDown={stop}
                onClick={() => insert(i)}
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M4 1v6M1 4h6" />
                </svg>
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Row({ colors, small }: { colors: PaletteColor[]; small?: boolean }) {
  const shares = paletteShares(colors)
  return (
    <div className="palette-row">
      {colors.map((c, i) => (
        <div
          key={i}
          className="palette-col"
          style={{ background: c.hex, color: inkFor(c.hex), ...(shares ? { '--g': shares[i] * colors.length } : {}) } as React.CSSProperties}
        >
          <div className="palette-label" data-small={small || undefined}>
            <span className="palette-hex">#{c.hex.slice(1).toUpperCase()}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
