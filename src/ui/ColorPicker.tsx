import { useEffect, useRef, useState, type PointerEvent as RPE } from 'react'
import { clamp, drag } from '../drag'

type HSV = [number, number, number] // h 0–360, s 0–1, v 0–1

const PRESETS = ['#f7f8f8', '#d0d6e0', '#8a8f98', '#62666d', '#2a2b30', '#0f1012', '#5e6ad2', '#4cb782', '#f2c94c', '#eb5757']

function parseHex(input: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

function rgbToHsv([r, g, b]: [number, number, number]): HSV {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const d = max - Math.min(rn, gn, bn)
  let h = 0
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h = (h * 60 + 360) % 360
  }
  return [h, max ? d / max : 0, max]
}

function hsvToHex([h, s, v]: HSV): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
  }
  return `#${[f(5), f(3), f(1)].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

const toHsv = (hex: string): HSV | null => {
  const rgb = parseHex(hex)
  return rgb ? rgbToHsv(rgb) : null
}

interface EyeDropperCtor {
  new (): { open: () => Promise<{ sRGBHex: string }> }
}
const EyeDropper = (globalThis as { EyeDropper?: EyeDropperCtor }).EyeDropper

/** Monochrome-styled HSV picker: saturation/brightness area, hue strip, hex field, presets. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState<HSV>(() => toHsv(value) ?? [0, 0, 1])
  const [text, setText] = useState(value)
  const area = useRef<HTMLDivElement>(null)
  const hue = useRef<HTMLDivElement>(null)

  // Follow outside changes (typing elsewhere, presets) without fighting our own drags.
  useEffect(() => {
    if (value.toLowerCase() === hsvToHex(hsv)) return
    const next = toHsv(value)
    if (next) setHsv(next)
    setText(value)
  }, [value])

  const commit = (next: HSV) => {
    setHsv(next)
    const hex = hsvToHex(next)
    setText(hex)
    onChange(hex)
  }

  const onArea = (e: RPE<HTMLDivElement>) => {
    const rect = area.current!.getBoundingClientRect()
    const at = (x: number, y: number) =>
      commit([hsv[0], clamp((x - rect.left) / rect.width, 0, 1), 1 - clamp((y - rect.top) / rect.height, 0, 1)])
    at(e.clientX, e.clientY)
    drag(e, (_dx, _dy, ev) => at(ev.clientX, ev.clientY), undefined, 0, 'tune')
  }
  const onHue = (e: RPE<HTMLDivElement>) => {
    const rect = hue.current!.getBoundingClientRect()
    const s0 = hsv
    const at = (x: number) => commit([clamp((x - rect.left) / rect.width, 0, 1) * 360, s0[1], s0[2]])
    at(e.clientX)
    drag(e, (_dx, _dy, ev) => at(ev.clientX), undefined, 0, 'tune')
  }

  const pure = hsvToHex([hsv[0], 1, 1])
  const current = hsvToHex(hsv)

  return (
    <div className="cp" onPointerDown={(e) => e.stopPropagation()}>
      <div ref={area} className="cp-area" style={{ background: pure }} onPointerDown={onArea}>
        <div className="cp-area-white" />
        <div className="cp-area-black" />
        <div className="cp-knob" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: current }} />
      </div>
      <div ref={hue} className="cp-hue" onPointerDown={onHue}>
        <div className="cp-knob cp-knob-hue" style={{ left: `${(hsv[0] / 360) * 100}%`, background: pure }} />
      </div>
      <div className="cp-row">
        <span className="cp-current" style={{ background: current }} />
        <input
          className="cp-hex"
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            const next = toHsv(e.target.value)
            if (next) {
              setHsv(next)
              onChange(hsvToHex(next))
            }
          }}
          onBlur={() => setText(current)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        {EyeDropper && (
          <button
            className="icon-btn"
            title="Pick a color from the screen"
            onClick={() =>
              new EyeDropper()
                .open()
                .then((r) => {
                  const next = toHsv(r.sRGBHex)
                  if (next) commit(next)
                })
                .catch(() => {})
            }
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m9.5 3.5 3 3M11 2a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2l-1.5 1.5-3-3L11 2ZM9.5 5 3.5 11l-.5 2 2-.5 6-6" />
            </svg>
          </button>
        )}
      </div>
      <div className="cp-presets">
        {PRESETS.map((c) => (
          <button
            key={c}
            className="cp-preset"
            data-active={c === current || undefined}
            style={{ background: c }}
            title={c}
            onClick={() => {
              const next = toHsv(c)
              if (next) commit(next)
            }}
          />
        ))}
      </div>
    </div>
  )
}

/** A swatch + hex row that opens the picker inline below it. */
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="cf">
      <button className="cf-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ctl-name">{label}</span>
        <span className="cf-value">
          <span className="cf-chip" style={{ background: value }} />
          <span className="mono">{value}</span>
        </span>
      </button>
      {open && <ColorPicker value={value} onChange={onChange} />}
    </div>
  )
}
