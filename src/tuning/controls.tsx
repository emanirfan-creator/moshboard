import { useEffect, useId, useRef, useState, type KeyboardEvent as RKE, type PointerEvent as RPE } from 'react'
import { NAMED_EASES, bezierAt } from '../../shared/ease.ts'
import { roundFor, type Bezier, type Param, type Spring } from '../../shared/params.ts'
import { clamp, drag } from '../drag'
import { ColorField } from '../ui/ColorPicker'
import { detent, tick } from '../ui/sound'

const fmt = (p: Param, n: number) => `${roundFor(p, n)}${p.unit}`

const LABELS: Record<string, string> = {
  duration: 'Duration',
  dur: 'Duration',
  delay: 'Delay',
  stagger: 'Stagger',
  ease: 'Easing',
  spring: 'Spring',
  distance: 'Distance',
  rise: 'Rise distance',
  scale: 'Scale',
  blur: 'Blur',
  tint: 'Tint',
}
/** `riseDistance` / `rise_distance` → "Rise distance" */
const label = (name: string) =>
  LABELS[name] ??
  name
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())

// ── number: segmented ruler you drag along ──────────────

const SEGMENTS = 48

/** `420ms` → ["420", "ms"], so the unit can sit dimmer than the digits. */
const split = (p: Param, n: number) => [String(roundFor(p, n)), p.unit]

export function NumberCtl({
  p,
  value,
  modified,
  onChange,
}: {
  p: Param
  value: number
  modified: boolean
  onChange: (n: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [active, setActive] = useState(false)
  const base = p.value as number
  const min = p.min ?? Math.min(0, base)
  const max = p.max ?? Math.max(1, Math.abs(base) * 3 || 100)
  const span = max - min || 1
  // Click once per segment crossed, like a detented encoder; a heavier one at either end.
  const seg = (n: number) => Math.round(clamp((n - min) / span, 0, 1) * (SEGMENTS - 1))
  const lastSeg = useRef(seg(value))
  const set = (n: number) => {
    const next = roundFor(p, p.min !== undefined ? clamp(n, min, max) : n)
    const s = seg(next)
    if (s !== lastSeg.current) tick(s / (SEGMENTS - 1), s === 0 || s === SEGMENTS - 1)
    lastSeg.current = s
    onChange(next)
  }

  const scrub = (e: RPE) => {
    const start = value
    const step = span / 240
    drag(
      e,
      (dx, _dy, ev) => set(start + dx * step * (ev.shiftKey ? 0.2 : 1)),
      (moved) => !moved && setEditing(true),
      2,
      'tune',
    )
  }
  const track = (e: RPE<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.focus()
    const rect = e.currentTarget.getBoundingClientRect()
    const at = (x: number) => set(min + clamp((x - rect.left) / rect.width, 0, 1) * span)
    at(e.clientX)
    setActive(true)
    drag(e, (_dx, _dy, ev) => at(ev.clientX), () => setActive(false), 0, 'tune')
  }
  const key = (e: React.KeyboardEvent) => {
    const step = (span / 100) * (e.shiftKey ? 10 : 1)
    const by: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step }
    if (e.key in by) set(value + by[e.key])
    else if (e.key === 'Home') set(min)
    else if (e.key === 'End') set(max)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const t = clamp((value - min) / span, 0, 1)
  // Ranges that cross zero light from zero outward.
  const zero = min < 0 && max > 0 ? -min / span : 0
  const [lo, hi] = t < zero ? [t, zero] : [zero, t]
  const head = Math.round(t * (SEGMENTS - 1))
  const [digits, unit] = split(p, value)
  const name = label(p.label ?? p.name)

  return (
    <div className="num" data-mod={modified || undefined} data-active={active || undefined} style={{ width: '100%' }}>
      <div className="num-head">
        <span className="num-name">{name}</span>
        {editing ? (
          <input
            className="num-input"
            autoFocus
            defaultValue={roundFor(p, value)}
            onBlur={(e) => {
              const n = parseFloat(e.target.value)
              if (!Number.isNaN(n)) set(n)
              setEditing(false)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
            }}
          />
        ) : (
          <span className="num-val" onPointerDown={scrub} title="Drag to scrub, click to type">
            {digits}
            {unit && <span className="num-unit">{unit}</span>}
          </span>
        )}
      </div>
      <div
        className="num-ruler"
        role="slider"
        tabIndex={0}
        aria-label={name}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={fmt(p, value)}
        onPointerDown={track}
        onDoubleClick={() => set(base)}
        onKeyDown={key}
        title={`${fmt(p, min)} – ${fmt(p, max)} · drag along to set · double-click to reset`}
      >
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const k = i / (SEGMENTS - 1)
          const lit = hi - lo > 1e-6 && k >= lo - 1e-6 && k <= hi + 1e-6
          return (
            <i
              key={i}
              data-lit={lit || undefined}
              data-tick={i % 10 === 0 || i === SEGMENTS - 1 ? 'major' : i % 5 === 0 ? 'minor' : undefined}
              data-head={i === head || undefined}
            />
          )
        })}
      </div>
    </div>
  )
}

// ── timeline: delay / duration / stagger by dragging ────

const TIMELINE_TIPS: Record<string, string> = {
  delay: 'Wait before the animation starts',
  duration: 'How long the animation runs',
  stagger: 'Gap before each next item starts',
}

export function Timeline({
  width = 280,
  duration,
  delay,
  stagger,
  values,
  modified,
  onChange,
}: {
  width?: number
  duration: Param
  delay?: Param
  stagger?: Param
  values: Record<string, number>
  modified: (name: string) => boolean
  onChange: (name: string, n: number) => void
}) {
  const id = useId()
  const W = width
  const dur = values[duration.name]
  const del = delay ? values[delay.name] : 0
  const stg = stagger ? values[stagger.name] : 0
  // Fit the span to the current timing, rounded to a nice number, and hold it
  // steady while a drag is in progress so the handles don't swim.
  const fitted = Math.max(400, Math.ceil(((del + dur + 3 * stg) * 1.5) / 200) * 200)
  const frozen = useRef<number | null>(null)
  const span = frozen.current ?? fitted
  const px = (ms: number) => (ms / span) * W
  const msPer = span / W
  const hold = (fn: (e: RPE) => void) => (e: RPE) => {
    frozen.current = span
    const release = () => {
      frozen.current = null
      window.removeEventListener('pointerup', release)
    }
    window.addEventListener('pointerup', release)
    fn(e)
  }
  const lim = (p: Param, n: number) => roundFor(p, clamp(n, p.min ?? 0, p.max ?? Infinity))
  // Notched like the rulers: a click per 1/48th of the visible span, a thunk at a limit.
  const set = (name: string, n: number) => {
    const p = [duration, delay, stagger].find((q) => q?.name === name)
    const atLimit = !!p && (n <= (p.min ?? 0) || (p.max !== undefined && n >= p.max))
    detent(`${id}:${name}`, Math.round((n / span) * 48), clamp(n / span, 0, 1), atLimit)
    onChange(name, n)
  }

  const onStart = (e: RPE) => {
    e.stopPropagation()
    const d0 = del
    const end = del + dur
    drag(
      e,
      (dx) => {
        const nd = lim(delay!, d0 + dx * msPer)
        set(delay!.name, nd)
        set(duration.name, lim(duration, end - nd))
      },
      undefined,
      0,
      'tune',
    )
  }
  const onEnd = (e: RPE) => {
    e.stopPropagation()
    const d0 = dur
    drag(e, (dx) => set(duration.name, lim(duration, d0 + dx * msPer)), undefined, 0, 'tune')
  }
  const onBar = (e: RPE) => {
    if (!delay) return
    const d0 = del
    drag(e, (dx) => set(delay.name, lim(delay, d0 + dx * msPer)), undefined, 0, 'tune')
  }
  const onTick = (i: number) => (e: RPE) => {
    e.stopPropagation()
    const s0 = stg
    drag(e, (dx) => set(stagger!.name, lim(stagger!, s0 + (dx * msPer) / i)), undefined, 0, 'tune')
  }

  const Val = ({ p }: { p: Param }) => (
    <span title={TIMELINE_TIPS[p.label ?? p.name]}>
      <span className="ctl-name">{label(p.label ?? p.name)} </span>
      <span className="ctl-val" data-mod={modified(p.name) || undefined}>
        {fmt(p, values[p.name])}
      </span>
    </span>
  )

  return (
    <div className="ctl" style={{ width: W }}>
      <div className="ctl-head" style={{ justifyContent: 'flex-start', gap: 14 }}>
        {delay && <Val p={delay} />}
        <Val p={duration} />
        {stagger && <Val p={stagger} />}
      </div>
      <div
        className="timeline"
        title={`Drag the ends to change ${delay ? 'when it starts and ' : ''}how long it runs${stagger ? '; drag a tick to space out the next items' : ''}`}
      >
        {stagger &&
          [1, 2, 3].map((i) => (
            <div
              key={i}
              className="tl-tick"
              style={{ left: px(del + i * stg) }}
              onPointerDown={hold(onTick(i))}
              title={`item ${i + 1}`}
            />
          ))}
        {stagger &&
          [1, 2, 3].map((i) => (
            <div
              key={`g${i}`}
              className="tl-bar"
              style={{ left: px(del + i * stg), width: px(dur), opacity: 0.35 - i * 0.08, pointerEvents: 'none' }}
            />
          ))}
        <div
          className="tl-bar"
          style={{ left: px(del), width: px(dur), cursor: delay ? 'grab' : 'default' }}
          onPointerDown={hold(onBar)}
        />
        {delay && <div className="tl-handle" style={{ left: px(del) }} onPointerDown={hold(onStart)} />}
        <div className="tl-handle" style={{ left: px(del + dur) }} onPointerDown={hold(onEnd)} />
      </div>
      <div className="tl-axis">
        <span>0</span>
        <span>{Math.round(span / 2)}ms</span>
        <span>{span}ms</span>
      </div>
    </div>
  )
}

// ── cubic-bezier curve with draggable control points ────

/** Curve editor margins: room for handles left/right, overshoot above/below. */
const EM = { x: 8, y: 22 }
const EH = 112

const bezierPath = (b: Bezier, sx: (x: number) => number, sy: (y: number) => number, n = 40) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const x = i / n
    return `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(bezierAt(b, x)).toFixed(1)}`
  }).join('')

export function BezierCtl({
  p,
  value,
  width,
  modified,
  onChange,
}: {
  p: Param
  value: Bezier
  width: number
  modified: boolean
  onChange: (b: Bezier) => void
}) {
  const [hover, setHover] = useState<Bezier | null>(null)
  const [copied, setCopied] = useState(false)
  const [x1, y1, x2, y2] = value
  const PW = width - EM.x * 2
  const sx = (x: number) => EM.x + x * PW
  const sy = (y: number) => EM.y + (1 - y) * EH
  const r2 = (n: number) => Math.round(n * 100) / 100
  const css = `cubic-bezier(${value.map(r2).join(', ')})`

  const id = useId()
  const move = (i: 0 | 1, x: number, y: number) => {
    const pt = [r2(clamp(x, 0, 1)), r2(clamp(y, -1, 2))]
    // A click each time a handle crosses a 0.05 grid line; a thunk against the sides.
    detent(`${id}:${i}`, Math.round(pt[0] * 20) * 1000 + Math.round(pt[1] * 20), clamp(pt[1], 0, 1), pt[0] === 0 || pt[0] === 1)
    onChange(i === 0 ? [pt[0], pt[1], x2, y2] : [x1, y1, pt[0], pt[1]])
  }

  // Grab the handle nearest the pointer; keep its offset so it doesn't jump.
  const onPad = (e: RPE<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const local = (ev: { clientX: number; clientY: number }) => [ev.clientX - rect.left, ev.clientY - rect.top]
    const [px, py] = local(e)
    const d0 = Math.hypot(px - sx(x1), py - sy(y1))
    const d1 = Math.hypot(px - sx(x2), py - sy(y2))
    const i = d0 <= d1 ? 0 : 1
    const near = Math.min(d0, d1) < 12
    const ox = near ? (i ? sx(x2) : sx(x1)) - px : 0
    const oy = near ? (i ? sy(y2) : sy(y1)) - py : 0
    const at = (ev: { clientX: number; clientY: number }) => {
      const [cx, cy] = local(ev)
      move(i, (cx + ox - EM.x) / PW, 1 - (cy + oy - EM.y) / EH)
    }
    if (!near) at(e)
    ;(e.currentTarget.querySelectorAll('.pt-hit')[i] as SVGElement | undefined)?.focus()
    drag(e, (_dx, _dy, ev) => at(ev), undefined, 0, 'tune')
  }

  const nudge = (i: 0 | 1) => (e: RKE) => {
    const step = e.shiftKey ? 0.1 : 0.01
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
    if (!d) return
    e.preventDefault()
    e.stopPropagation()
    const [x, y] = i ? [x2, y2] : [x1, y1]
    move(i, x + d[0], y + d[1])
  }

  const copy = () => {
    tick(0.9)
    navigator.clipboard?.writeText(css)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const current = PRESETS.find(([, key]) => NAMED_EASES[key].every((v, i) => Math.abs(v - value[i]) < 0.01))
  const H = EH + EM.y * 2

  return (
    <div className="ctl ease-ctl">
      <div className="ctl-head">
        <span className="ctl-val" data-mod={modified || undefined} style={{ cursor: 'default' }}>
          {current?.[0] ?? 'Custom'}
        </span>
        <button className="ease-copy mono" onClick={copy} title={`Copy ${css}`} aria-label={`${p.name}: copy ${css}`}>
          {copied ? 'Copied' : value.map(r2).join(', ')}
        </button>
      </div>
      <div className="ease-editor" style={{ height: H }}>
        <svg className="pad" width={width} height={H} onPointerDown={onPad}>
          <title>Drag the handles · arrow keys nudge a focused handle</title>
          <rect className="grid" x={EM.x + 0.5} y={EM.y + 0.5} width={PW - 1} height={EH - 1} fill="none" />
          <line className="grid" x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} />
          {hover && <path className="ghost" d={bezierPath(hover, sx, sy)} />}
          <line className="arm" x1={sx(0)} y1={sy(0)} x2={sx(x1)} y2={sy(y1)} />
          <line className="arm" x1={sx(1)} y1={sy(1)} x2={sx(x2)} y2={sy(y2)} />
          <path className="curve" d={bezierPath(value, sx, sy)} />
          <circle className="anchor" cx={sx(0)} cy={sy(0)} r={2} />
          <circle className="anchor" cx={sx(1)} cy={sy(1)} r={2} />
          {([0, 1] as const).map((i) => (
            <g
              key={i}
              className="pt-hit"
              tabIndex={0}
              role="slider"
              aria-label={`${i ? 'End' : 'Start'} handle`}
              aria-valuetext={i ? `${x2}, ${y2}` : `${x1}, ${y1}`}
              onKeyDown={nudge(i)}
            >
              <circle cx={sx(i ? x2 : x1)} cy={sy(i ? y2 : y1)} r={11} fill="transparent" />
              <circle className="pt" cx={sx(i ? x2 : x1)} cy={sy(i ? y2 : y1)} r={4.5} />
            </g>
          ))}
        </svg>
        {/* Playhead: x moves linearly in time, y rides the actual easing, so the dot traces the curve. */}
        <div
          className="ease-run"
          style={{ left: EM.x, top: EM.y, width: PW, height: EH, ['--pw' as string]: `${PW}px`, ['--eh' as string]: `${EH}px` }}
        >
          <div className="ease-run-x">
            <div className="ease-run-y" style={{ animationTimingFunction: css }} />
          </div>
        </div>
      </div>
      <div className="presets" onPointerLeave={() => setHover(null)}>
        {PRESETS.map(([name, key, tip]) => {
          const b = NAMED_EASES[key]
          return (
            <button
              key={key}
              data-active={current?.[1] === key || undefined}
              title={`${name}: ${tip}`}
              aria-label={name}
              onPointerEnter={() => setHover(b)}
              onFocus={() => setHover(b)}
              onBlur={() => setHover(null)}
              onClick={() => {
                tick(0.7)
                onChange([...b] as Bezier)
              }}
            >
              <svg width={14} height={14} viewBox="0 0 14 14">
                <path d={bezierPath(b, (x) => 1 + x * 12, (y) => 13 - y * 12, 16)} />
              </svg>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Friendly names for common curves: [label, NAMED_EASES key, tooltip]. */
const PRESETS: [string, string, string][] = [
  ['Snappy', 'out-expo', 'Fast start, long soft landing'],
  ['Smooth stop', 'out-cubic', 'Quick start, gentle stop'],
  ['Gentle', 'ease-out', 'Mild slow-down at the end'],
  ['Standard', 'ease', 'The browser default'],
  ['In and out', 'in-out-cubic', 'Slow at both ends'],
  ['Speed up', 'ease-in', 'Starts slow, ends fast (good for exits)'],
  ['Linear', 'linear', 'Constant speed'],
]

// ── spring: drag a dot on stiffness × damping ───────────

// ── spring: bounce + duration, with a playable response ──
//
// Shown the way motion's `spring({ visualDuration, bounce })` thinks about it:
// how long it feels and how much it overshoots. Stiffness/damping/mass are
// still what gets saved, and sit under "Advanced" for exact numbers.

interface SpringSim {
  /** sampled position, 0 → 1 (overshoot above 1) */
  curve: number[]
  /** sample spacing, ms */
  stepMs: number
  settleMs: number
  overshoot: number
  /** turning points after the first arrival: when, and how far off target */
  peaks: { ms: number; amp: number }[]
}

function simulate({ stiffness, damping, mass = 1 }: Spring): SpringSim {
  const dt = 1 / 1000
  let x = 0
  let v = 0
  let settle = 3000
  let max = 0
  const xs: number[] = []
  const peaks: { ms: number; amp: number }[] = []
  for (let i = 0; i <= 3000; i++) {
    xs.push(x)
    const a = (-stiffness * (x - 1) - damping * v) / mass
    const nv = v + a * dt
    if (i > 0 && Math.sign(nv) !== Math.sign(v) && v !== 0 && Math.abs(x - 1) > 0.01) peaks.push({ ms: i, amp: Math.abs(x - 1) })
    v = nv
    x += v * dt
    max = Math.max(max, x)
    if (Math.abs(x - 1) < 0.005 && Math.abs(v) < 0.05) {
      settle = i
      break
    }
  }
  return { curve: xs, stepMs: 1, settleMs: settle, overshoot: Math.max(0, max - 1), peaks }
}

const zetaOf = ({ stiffness, damping, mass = 1 }: Spring) => damping / (2 * Math.sqrt(stiffness * mass))
const feelMs = ({ stiffness, mass = 1 }: Spring) => (2 * Math.PI) / (1.2 * Math.sqrt(stiffness / mass)) * 1000
const bounceOf = (s: Spring) => Math.round(clamp(1 - zetaOf(s), 0, 1) * 100)

function fromFeel(s: Spring, ms: number, zeta: number): Spring {
  const m = s.mass ?? 1
  const w = (2 * Math.PI) / (1.2 * (ms / 1000))
  const stiffness = Math.max(1, Math.round(m * w * w))
  const damping = Math.round(2 * zeta * Math.sqrt(stiffness * m) * 10) / 10
  return { ...s, stiffness, damping }
}

const num = (name: string, value: number, unit: string, min: number, max: number): Param => ({
  name,
  label: name,
  kind: 'number',
  value,
  unit,
  min,
  max,
  start: 0,
  end: 0,
})

export function SpringCtl({
  p,
  value,
  modified,
  onChange,
}: {
  p: Param
  value: Spring
  modified: boolean
  onChange: (s: Spring) => void
}) {
  const original = p.value as Spring
  const [advanced, setAdvanced] = useState(false)
  const sim = simulate(value)
  const bounce = bounceOf(value)
  const feel = Math.round(feelMs(value))
  const zeta = zetaOf(value)

  // Preview: a block that springs across a rail, replayed shortly after each change.
  const [t, setT] = useState<number | null>(null)
  const raf = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const play = (withSound: boolean) => {
    cancelAnimationFrame(raf.current)
    timers.current.forEach(clearTimeout)
    const s = simulate(value)
    const start = performance.now()
    const end = Math.min(s.settleMs + 120, 3000)
    if (withSound) {
      tick(0.5)
      timers.current = s.peaks.slice(0, 8).map((pk) => setTimeout(() => tick(clamp(pk.amp * 3, 0, 1), false, clamp(pk.amp * 4, 0.15, 1)), pk.ms))
    }
    const step = () => {
      const el = performance.now() - start
      setT(el >= end ? null : el)
      if (el < end) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
  }
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const id = setTimeout(() => play(true), 260)
    return () => clearTimeout(id)
  }, [value.stiffness, value.damping, value.mass])
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      timers.current.forEach(clearTimeout)
    },
    [],
  )

  // Graph: time on x (fitted to when it settles), position on y.
  const W = 268
  const H = 76
  const span = clamp(Math.ceil((sim.settleMs * 1.15) / 100) * 100, 300, 3000)
  const top = Math.max(1.25, 1 + sim.overshoot + 0.08)
  const gx = (ms: number) => (ms / span) * W
  const gy = (x: number) => H - 6 - (clamp(x, -0.3, top) / top) * (H - 14)
  const pts = sim.curve.filter((_, i) => i <= span && i % 6 === 0)
  const path = pts.map((x, i) => `${i ? 'L' : 'M'}${gx(i * 6).toFixed(1)},${gy(x).toFixed(1)}`).join('') + `L${W},${gy(1).toFixed(1)}`
  const at = t === null ? null : Math.min(Math.round(t), sim.curve.length - 1)
  const pos = at === null ? 1 : sim.curve[at] ?? 1

  const feelP = num('duration', Math.round(feelMs(original)), 'ms', 80, 2000)
  const bounceP = num('bounce', bounceOf(original), '%', 0, 100)
  const words =
    zeta >= 1 ? (zeta > 1.4 ? 'No bounce, eases in slowly' : 'No bounce') : bounce < 15 ? 'A hint of bounce' : bounce < 40 ? 'Bouncy' : 'Very bouncy'

  return (
    <div className="spring" data-mod={modified || undefined}>
      <div className="spring-graph" onPointerDown={() => play(true)} title="Click to play">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden>
          <line className="spring-target" x1={0} x2={W} y1={gy(1)} y2={gy(1)} />
          <line className="spring-settle" x1={gx(sim.settleMs)} x2={gx(sim.settleMs)} y1={4} y2={H - 4} />
          <path className="spring-curve" d={path} />
          {at !== null && <circle className="spring-head" cx={gx(at)} cy={gy(pos)} r={3} />}
        </svg>
        <div className="spring-axis">
          <span>0</span>
          <span>{Math.round(span / 2)}ms</span>
          <span>{span}ms</span>
        </div>
      </div>
      <div className="spring-facts">
        <span>{words}</span>
        <span>
          settles ~{sim.settleMs >= 3000 ? '3s+' : `${Math.round(sim.settleMs / 10) * 10}ms`}
          {sim.overshoot > 0.005 ? ` · ${Math.round(sim.overshoot * 100)}% over` : ''}
        </span>
      </div>
      <NumberCtl
        p={bounceP}
        value={bounce}
        modified={bounce !== bounceP.value}
        onChange={(b) => onChange(fromFeel(value, feel, Math.max(0.05, 1 - b / 100)))}
      />
      <NumberCtl
        p={feelP}
        value={feel}
        modified={feel !== feelP.value}
        onChange={(ms) => onChange(fromFeel(value, ms, zeta))}
      />
      <button className="spring-adv" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
        {advanced ? '−' : '+'} Advanced <span>stiffness {value.stiffness} · damping {value.damping}{value.mass !== undefined ? ` · mass ${value.mass}` : ''}</span>
      </button>
      {advanced && (
        <div className="insp-stack">
          <NumberCtl
            p={num('stiffness', original.stiffness, '', 1, Math.max(1500, original.stiffness * 2))}
            value={value.stiffness}
            modified={value.stiffness !== original.stiffness}
            onChange={(k) => onChange({ ...value, stiffness: Math.round(k) })}
          />
          <NumberCtl
            p={num('damping', original.damping, '', 0, Math.max(120, original.damping * 2))}
            value={value.damping}
            modified={value.damping !== original.damping}
            onChange={(d) => onChange({ ...value, damping: Math.round(d * 10) / 10 })}
          />
          {value.mass !== undefined && (
            <NumberCtl
              p={num('mass', original.mass ?? 1, '', 0.1, 5)}
              value={value.mass}
              modified={value.mass !== original.mass}
              onChange={(m) => onChange({ ...value, mass: Math.round(m * 100) / 100 })}
            />
          )}
        </div>
      )}
    </div>
  )
}

export function ColorCtl({ p, value, onChange }: { p: Param; value: string; onChange: (c: string) => void }) {
  const id = useId()
  const change = (c: string) => {
    // Coarse buckets of the colour, so a drag across the picker clicks rather than hums.
    const hex = /^#([0-9a-f]{6})/i.exec(c)?.[1]
    const n = hex ? parseInt(hex, 16) : 0
    const bucket = hex ? ((n >> 20) << 8) | (((n >> 12) & 0xf) << 4) | ((n >> 4) & 0xf) : Math.random()
    detent(id, bucket, ((n >> 16) & 0xff) / 255)
    onChange(c)
  }
  return <ColorField label={label(p.label ?? p.name)} value={value} onChange={change} />
}
