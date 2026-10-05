import { useEffect, useState, type PointerEvent as RPE } from 'react'
import { adjustHex, generatePalette, inkFor, NO_ADJUST, nameColor, paletteShares, type Adjust, type PaletteColor } from '../../shared/color.ts'
import type { Frame } from '../../shared/types.ts'
import { randomizePalette, regeneratePalette, setPaletteColors, splitPalette } from '../actions'
import { clamp, drag } from '../drag'
import { setState, toast, useStore } from '../store'
import { ColorPicker } from '../ui/ColorPicker'
import { useGlide } from '../ui/glide'
import { cue, detent } from '../ui/sound'
import { SplitCtl } from './controls'
import { Fold } from './Fold'
import { PlusIcon, TrashIcon } from '../ui/icons'

const SLIDERS: { key: keyof Adjust; label: string; min: number; max: number; track: string }[] = [
  {
    key: 'hue',
    label: 'Hue',
    min: -180,
    max: 180,
    track: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
  },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, track: 'linear-gradient(to right, #8a8f98, #ff3b3b)' },
  { key: 'brightness', label: 'Brightness', min: -100, max: 100, track: 'linear-gradient(to right, #000, #fff)' },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, track: 'linear-gradient(to right, #4a7bd8, #f2e9e4, #f2a54a)' },
]

function Slider({ s, value, onChange }: { s: (typeof SLIDERS)[number]; value: number; onChange: (n: number) => void }) {
  const span = s.max - s.min
  const track = useGlide<HTMLDivElement>({ '--t': (value - s.min) / span })
  const set = (n: number) => {
    // A detent every 10 units, a heavier one at either end.
    detent(`adj:${s.key}`, Math.round(n / 10), (n - s.min) / span, n === s.min || n === s.max)
    onChange(n)
  }
  const onDown = (e: RPE<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const at = (x: number) => set(Math.round(s.min + clamp((x - rect.left) / rect.width, 0, 1) * span))
    at(e.clientX)
    drag(e, (_dx, _dy, ev) => at(ev.clientX), undefined, 0, 'tune')
  }
  return (
    <div className="adj">
      <div className="ctl-head">
        <span className="ctl-name">{s.label}</span>
        <span className="ctl-val" onDoubleClick={() => onChange(0)} title="Double-click to reset">
          {value > 0 ? `+${value}` : value}
        </span>
      </div>
      <div ref={track} className="adj-track" style={{ background: s.track }} onPointerDown={onDown}>
        <span className="adj-zero" style={{ left: `${((0 - s.min) / span) * 100}%` }} />
        <span className="adj-knob" />
      </div>
    </div>
  )
}

export function PaletteBody({ frame }: { frame: Frame }) {
  const colors = frame.colors ?? []
  const focus = useStore((s) => s.paletteFocus)
  const draft = useStore((s) => (s.paletteDraft?.id === frame.id ? s.paletteDraft : null))
  const [adjust, setAdjust] = useState<Adjust>(NO_ADJUST)
  const [open, setOpen] = useState<number | null>(focus)
  useEffect(() => setOpen(focus), [focus])
  // Leaving the palette discards an un-applied adjustment.
  useEffect(() => () => setState({ paletteDraft: null, paletteFocus: null }), [frame.id])

  const set = (next: PaletteColor[]) => setPaletteColors(frame.id, next)
  const change = (key: keyof Adjust, n: number) => {
    const a = { ...adjust, [key]: n }
    setAdjust(a)
    const changed = Object.values(a).some((v) => v !== 0)
    setState({
      paletteDraft: changed ? { id: frame.id, colors: colors.map((c) => ({ ...c, hex: adjustHex(c.hex, a) })) } : null,
    })
  }
  const cancel = () => {
    setAdjust(NO_ADJUST)
    setState({ paletteDraft: null })
  }
  const apply = () => {
    if (draft) set(draft.colors)
    cancel()
  }

  return (
    <>
      <div className="insp-scroll">
        <Fold title="Colors">
          <div className="pal-list">
            {colors.map((c, i) => (
              <div key={i} className="pal-item">
                <div className="pal-row">
                  <button className="pal-swatch" style={{ background: c.hex }} onClick={() => setOpen(open === i ? null : i)} />
                  <button className="pal-meta" onClick={() => setOpen(open === i ? null : i)}>
                    <span className="mono">{c.hex.slice(1).toUpperCase()}</span>
                    <span>{nameColor(c.hex)}</span>
                  </button>
                  <button
                    className="icon-btn"
                    data-on={c.locked || undefined}
                    title={c.locked ? 'Unlock' : 'Lock'}
                    onClick={() => {
                      cue(c.locked ? 'toggle-off' : 'toggle-on')
                      set(colors.map((x, j) => (j === i ? { ...x, locked: !x.locked } : x)))
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
                      {c.locked ? <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /> : <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" />}
                    </svg>
                  </button>
                  {colors.length > 2 && (
                    <button
                      className="icon-btn pal-remove"
                      title="Remove"
                      aria-label={`Remove ${nameColor(c.hex)}`}
                      onClick={() => {
                        cue('remove')
                        if (open === i) setOpen(null)
                        set(colors.filter((_, j) => j !== i))
                      }}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
                {open === i && (
                  <ColorPicker value={c.hex} onChange={(hex) => set(colors.map((x, j) => (j === i ? { ...x, hex } : x)))} />
                )}
              </div>
            ))}
            <button className="pal-add" onClick={() => addColor(colors, set)}>
              <span className="pal-add-plus" aria-hidden>
                <PlusIcon />
              </span>
              Add color
            </button>
          </div>
        </Fold>
        <Fold title="Shares">
          <Shares colors={colors} onChange={set} />
        </Fold>
        <Fold title="Adjust palette">
          {SLIDERS.map((s) => (
            <Slider key={s.key} s={s} value={adjust[s.key]} onChange={(n) => change(s.key, n)} />
          ))}
          <p className="ctl-help">Previewing until you apply.</p>
        </Fold>
      </div>
      <footer className="insp-foot">
        {draft ? (
          <>
            <span className="grow" />
            <button className="btn" onClick={cancel}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={apply}>
              Apply
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => splitPalette(frame.id)} title="One swatch per color">
              Split
            </button>
            <span className="grow" />
            <button className="btn" onClick={() => randomizePalette(frame.id)} title="A random harmony, not from the board">
              Random
            </button>
            <button className="btn btn-primary" onClick={() => regeneratePalette(frame.id)} title="Another mix from the board">
              Generate
            </button>
          </>
        )}
      </footer>
    </>
  )
}

/** How much of the palette each color is: one split, a line between each pair of colors. */
function Shares({ colors, onChange }: { colors: PaletteColor[]; onChange: (c: PaletteColor[]) => void }) {
  if (colors.length < 2) return null
  const set = paletteShares(colors)
  const even = colors.map(() => 1 / colors.length)
  const value = set ?? even
  const name = (hex: string) => {
    const n = nameColor(hex)
    return n.length > 10 ? `${n.slice(0, 9)}…` : n
  }
  const modified = !!set && set.some((x, i) => Math.abs(x - even[i]) > 0.005)
  const evenOut = () => onChange(colors.map(({ share: _, ...c }) => c))
  return (
    <>
    <SplitCtl
      name="Shares"
      hideName
      parts={colors.map((c) => name(c.hex))}
      value={value}
      original={even}
      min={0.04}
      swatches={colors.map((c) => ({ bg: c.hex, ink: inkFor(c.hex) }))}
      modified={modified}
      onChange={(v) => onChange(colors.map((c, i) => ({ ...c, share: Math.round(v[i] * 1000) / 1000 })))}
      onReset={evenOut}
    />
    </>
  )
}

/** One more color that fits the palette: generated around the colors there, all of which stay. */
function addColor(colors: PaletteColor[], set: (c: PaletteColor[]) => void) {
  if (colors.length >= 10) return toast('A palette holds up to 10 colors')
  const next = generatePalette(colors.map((c) => ({ ...c, locked: true })), colors.length + 1)
  cue('droplet')
  set([...colors, next[next.length - 1]])
}
