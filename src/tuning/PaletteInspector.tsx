import { useEffect, useState, type PointerEvent as RPE } from 'react'
import { adjustHex, NO_ADJUST, nameColor, type Adjust, type PaletteColor } from '../../shared/color.ts'
import type { Frame } from '../../shared/types.ts'
import { regeneratePalette, setPaletteColors, splitPalette } from '../actions'
import { clamp, drag } from '../drag'
import { setState, useStore } from '../store'
import { ColorPicker } from '../ui/ColorPicker'

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
  const pct = ((value - s.min) / (s.max - s.min)) * 100
  const onDown = (e: RPE<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const at = (x: number) => onChange(Math.round(s.min + clamp((x - rect.left) / rect.width, 0, 1) * (s.max - s.min)))
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
      <div className="adj-track" style={{ background: s.track }} onPointerDown={onDown}>
        <span className="adj-zero" style={{ left: `${((0 - s.min) / (s.max - s.min)) * 100}%` }} />
        <span className="adj-knob" style={{ left: `${pct}%` }} />
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
        <section className="insp-section">
          <h3>Colors</h3>
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
                    onClick={() => set(colors.map((x, j) => (j === i ? { ...x, locked: !x.locked } : x)))}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
                      {c.locked ? <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /> : <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" />}
                    </svg>
                  </button>
                </div>
                {open === i && (
                  <ColorPicker value={c.hex} onChange={(hex) => set(colors.map((x, j) => (j === i ? { ...x, hex } : x)))} />
                )}
              </div>
            ))}
          </div>
          <p className="ctl-help">
            Generate replaces unlocked colors. Hover a column for its tools; + between columns adds a blend.
          </p>
        </section>
        <section className="insp-section">
          <h3>Adjust palette</h3>
          {SLIDERS.map((s) => (
            <Slider key={s.key} s={s} value={adjust[s.key]} onChange={(n) => change(s.key, n)} />
          ))}
          <p className="ctl-help">The frame previews the change until you apply it.</p>
        </section>
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
              Split into swatches
            </button>
            <span className="grow" />
            <button className="btn btn-primary" onClick={() => regeneratePalette(frame.id)} title="Balanced colors from the board's images, videos and sites">
              Generate
            </button>
          </>
        )}
      </footer>
    </>
  )
}
