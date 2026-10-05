import { useEffect, useRef, useState, type PointerEvent as RPE, type ReactNode } from 'react'
import { contrast, hexToLch, lchToHex, paletteFromSamples } from '../../shared/color.ts'
import { boardSamples, hasColors } from '../boardColors'
import { clamp, drag } from '../drag'
import { getState, toast, useStore } from '../store'
import { copyText } from '../clipboard'
import { CheckIcon, CopyIcon, ReopenIcon } from './icons'
import { tick } from './sound'

type HSV = [number, number, number] // h 0–360, s 0–1, v 0–1

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

// ── formats: the value shows as hex, rgb() or oklch(), and any of them can be typed ──

type Format = 'HEX' | 'RGB' | 'OKLCH'
const FORMATS: Format[] = ['HEX', 'RGB', 'OKLCH']
const FORMAT_KEY = 'mb:color-format'
const storedFormat = (): Format => {
  try {
    const f = localStorage.getItem(FORMAT_KEY) as Format | null
    return f && FORMATS.includes(f) ? f : 'HEX'
  } catch {
    return 'HEX'
  }
}

function formatColor(hex: string, f: Format) {
  if (f === 'HEX') return hex
  if (f === 'RGB') return `rgb(${(parseHex(hex) ?? [0, 0, 0]).join(', ')})`
  const [L, C, H] = hexToLch(hex)
  return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${Math.round(H)})`
}

/** A typed color in any of the formats → hex, or null. */
function readColor(input: string): string | null {
  const t = input.trim()
  if (parseHex(t)) return hsvToHex(toHsv(t)!)
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(t)
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('')}`
  const ok = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i.exec(t)
  if (ok) return lchToHex([ok[2] ? +ok[1] / 100 : +ok[1], +ok[3], +ok[4]])
  return null
}

const grade = (r: number) => (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'Large' : 'Low')

/**
 * Colors already on this canvas, for the picker's row: palettes and swatches first, then
 * colors read from the references (images, clips, site snapshots) to fill up to eight.
 */
function useBoardColors() {
  const defined = useStore((s) => {
    const out: string[] = []
    for (const f of s.board?.frames ?? []) {
      if (f.type === 'palette') out.push(...(f.colors ?? []).map((c) => c.hex.toLowerCase()))
      if (f.type === 'swatch' && f.color) out.push(f.color.toLowerCase())
    }
    return [...new Set(out)].slice(0, 8).join()
  })
  const [read, setRead] = useState<string[]>([])
  const need = 8 - (defined ? defined.split(',').length : 0)
  useEffect(() => {
    if (need <= 0) return
    let live = true
    const s = getState()
    const refs = (s.board?.frames ?? []).filter((f) => hasColors(f, false) && f.type !== 'swatch')
    if (!refs.length) return
    boardSamples(s.boardName, refs).then((samples) => {
      if (live) setRead(paletteFromSamples(samples, [], need).map((c) => c.hex.toLowerCase()))
    })
    return () => {
      live = false
    }
  }, [need])
  const list = [...(defined ? defined.split(',') : []), ...read]
  return [...new Set(list)].slice(0, 8)
}

/**
 * Saturation/brightness area and hue strip; the value in hex, rgb or oklch (copy, eyedropper);
 * how text reads on it; and the colors already on the board. Once changed, a before | after
 * swatch shows the color it opened with (click it to go back).
 */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState<HSV>(() => toHsv(value) ?? [0, 0, 1])
  const [original] = useState(() => (toHsv(value) ? hsvToHex(toHsv(value)!) : value))
  const [format, setFormat] = useState<Format>(storedFormat)
  const [text, setText] = useState(() => formatColor(hsvToHex(hsv), format))
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const area = useRef<HTMLDivElement>(null)
  const hue = useRef<HTMLDivElement>(null)

  // Follow outside changes (typing elsewhere, presets) without fighting our own drags.
  useEffect(() => {
    if (value.toLowerCase() === hsvToHex(hsv)) return
    const next = toHsv(value)
    if (next) setHsv(next)
  }, [value])

  const current = hsvToHex(hsv)
  const shown = editing ? text : formatColor(current, format)
  const board = useBoardColors()

  const commit = (next: HSV) => {
    setHsv(next)
    setError('')
    onChange(hsvToHex(next))
  }
  const pick = (hex: string) => {
    const next = toHsv(hex)
    if (next) commit(next)
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
  const nextFormat = () => {
    const f = FORMATS[(FORMATS.indexOf(format) + 1) % FORMATS.length]
    setFormat(f)
    tick(0.6)
    try {
      localStorage.setItem(FORMAT_KEY, f)
    } catch {
      // storage unavailable
    }
  }

  const pure = hsvToHex([hsv[0], 1, 1])
  const changed = current !== original.toLowerCase()
  const onWhite = contrast(current, '#ffffff')
  const onBlack = contrast(current, '#111111')

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
        {changed ? (
          <button className="cp-was" onClick={() => (tick(0.35), pick(original))} title={`Back to ${original}`} aria-label={`Back to ${original}`}>
            <span className="cp-was-before" style={{ background: original }}>
              <ReopenIcon />
            </span>
            <span style={{ background: current }} />
          </button>
        ) : (
          <span className="cp-current" style={{ background: current }} />
        )}
        <div className="cp-value">
          <input
            className="cp-hex"
            value={shown}
            spellCheck={false}
            aria-label="Color"
            onFocus={() => {
              setText(formatColor(current, format))
              setEditing(true)
            }}
            onChange={(e) => {
              setText(e.target.value)
              setError('')
              const hex = readColor(e.target.value)
              if (hex) {
                const next = toHsv(hex)!
                setHsv(next)
                onChange(hex)
              }
            }}
            onBlur={() => {
              if (!readColor(text)) setError('Enter a color like #c46a3b')
              setEditing(false)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
            }}
          />
          <button className="cp-format" onClick={nextFormat} title="Switch format">
            {format}
          </button>
        </div>
        <button
          className="icon-btn"
          title="Copy"
          aria-label="Copy"
          onClick={() =>
            copyText(formatColor(current, format)).then((ok) => {
              if (!ok) return toast('Couldn’t copy to the clipboard', true)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            })
          }
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        {EyeDropper && (
          <button
            className="icon-btn"
            title="Pick a color from the screen"
            aria-label="Pick a color from the screen"
            onClick={() =>
              new EyeDropper()
                .open()
                .then((r) => pick(r.sRGBHex))
                .catch(() => {})
            }
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m9.5 3.5 3 3M11 2a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2l-1.5 1.5-3-3L11 2ZM9.5 5 3.5 11l-.5 2 2-.5 6-6" />
            </svg>
          </button>
        )}
      </div>
      {error && <div className="cp-error">{error}</div>}
      <div className="cp-contrast">
        {[
          { ink: '#ffffff', r: onWhite },
          { ink: '#111111', r: onBlack },
        ].map(({ ink, r }) => (
          <div key={ink} className="cp-chip" title={`${ink === '#ffffff' ? 'White' : 'Dark'} text: ${r.toFixed(1)}:1`}>
            <b style={{ background: current, color: ink }}>Aa</b>
            <span className="cp-chip-r">{r.toFixed(1)}</span>
            <span className="cp-chip-g" data-low={r < 3 || undefined}>
              {grade(r)}
            </span>
          </div>
        ))}
      </div>
      {board.length > 0 && (
        <div className="cp-board">
          <span className="cp-label">Board colors</span>
          <div className="cp-presets">
            {board.map((c) => (
              <button key={c} className="cp-preset" data-active={c === current || undefined} style={{ background: c }} title={c} onClick={() => (tick(0.5), pick(c))} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** A swatch + hex row that opens the picker inline below it. */
export function ColorField({
  label,
  value,
  onChange,
  after,
}: {
  label: string
  value: string
  onChange: (hex: string) => void
  /** shown after the row, e.g. a reset dot */
  after?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="cf">
      <div className="cf-line">
        <button className="cf-row" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="ctl-name">{label}</span>
          <span className="cf-value">
            <span className="cf-chip" style={{ background: value }} />
            <span className="mono">{value}</span>
          </span>
        </button>
        {after}
      </div>
      {open && <ColorPicker value={value} onChange={onChange} />}
    </div>
  )
}
