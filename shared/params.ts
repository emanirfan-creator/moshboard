// `@param` annotations in code frames.
//
//   /* @param duration 320ms 80..1200 */
//   /* @param ease cubic-bezier(0.16, 1, 0.3, 1) */
//   /* @param spring stiffness=380 damping=26 */
//   /* @param tint #5e6ad2 */
//
// Each becomes a live control on the canvas, a CSS var (`--p-<name>`) and a
// value returned by `useParams()` inside the frame.

export type Bezier = [number, number, number, number]
export interface Spring {
  stiffness: number
  damping: number
  mass?: number
}
export type ParamKind = 'number' | 'ease' | 'spring' | 'color'
export type ParamValue = number | Bezier | Spring | string

export interface Param {
  name: string
  kind: ParamKind
  value: ParamValue
  unit: string
  min?: number
  max?: number
  /** display name when it differs from `name` (detected params) */
  label?: string
  /** offsets of the value text inside the source, for writing locked values back */
  start: number
  end: number
}

const PARAM_RE = /@param\s+([A-Za-z_][\w-]*)[ \t]+(.*?)(?=\*\/|\n|$)/g
const EASE_RE = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/
const COLOR_RE = /^(#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch|oklab)\([^)]*\))/i
const NUM_RE = /^(-?\d*\.?\d+)\s*([a-z%]*)\s*(?:(-?\d*\.?\d+)\s*\.\.\s*(-?\d*\.?\d+))?/i

export function parseParams(source: string): Param[] {
  const out: Param[] = []
  for (const m of source.matchAll(PARAM_RE)) {
    const name = m[1]
    const raw = m[2].trimEnd()
    const start = m.index! + m[0].length - m[2].length
    const end = start + raw.length
    const base = { name, start, end }
    let e: RegExpExecArray | null
    if ((e = EASE_RE.exec(raw))) {
      out.push({ ...base, kind: 'ease', unit: '', value: [+e[1], +e[2], +e[3], +e[4]] })
    } else if (/stiffness\s*=/.test(raw)) {
      const kv = Object.fromEntries([...raw.matchAll(/(\w+)\s*=\s*(-?[\d.]+)/g)].map((x) => [x[1], +x[2]]))
      const spring: Spring = { stiffness: kv.stiffness ?? 300, damping: kv.damping ?? 30 }
      if (kv.mass !== undefined) spring.mass = kv.mass
      out.push({ ...base, kind: 'spring', unit: '', value: spring })
    } else if ((e = COLOR_RE.exec(raw))) {
      out.push({ ...base, kind: 'color', unit: '', value: e[1] })
    } else if ((e = NUM_RE.exec(raw))) {
      const p: Param = { ...base, kind: 'number', unit: e[2] ?? '', value: +e[1] }
      if (e[3] !== undefined) {
        p.min = +e[3]
        p.max = +e[4]
      }
      out.push(p)
    }
  }
  return out
}

const round = (n: number, d = 2) => {
  const f = 10 ** d
  return Math.round(n * f) / f
}

export function roundFor(p: Param, n: number) {
  return p.unit === 'ms' || p.unit === 'px' ? Math.round(n) : round(n)
}

export function formatParam(p: Param, v: ParamValue): string {
  switch (p.kind) {
    case 'ease': {
      const b = v as Bezier
      return `cubic-bezier(${b.map((n) => round(n)).join(', ')})`
    }
    case 'spring': {
      const s = v as Spring
      return `stiffness=${Math.round(s.stiffness)} damping=${round(s.damping, 1)}${s.mass !== undefined ? ` mass=${round(s.mass)}` : ''}`
    }
    case 'color':
      return String(v)
    case 'number': {
      const range = p.min !== undefined ? ` ${p.min}..${p.max}` : ''
      return `${roundFor(p, v as number)}${p.unit}${range}`
    }
  }
}

/** Write values back into the annotations ("lock"). */
export function applyParams(source: string, params: Param[], values: Record<string, ParamValue>): string {
  let out = source
  for (const p of [...params].sort((a, b) => b.start - a.start)) {
    if (!(p.name in values)) continue
    out = out.slice(0, p.start) + formatParam(p, values[p.name]) + out.slice(p.end)
  }
  return out
}

export function cssValue(p: Param, v: ParamValue): string | null {
  switch (p.kind) {
    case 'ease':
      return formatParam(p, v)
    case 'color':
      return String(v)
    case 'number':
      return `${roundFor(p, v as number)}${p.unit}`
    case 'spring':
      return null
  }
}

export function cssVars(params: Param[], values: Record<string, ParamValue>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of params) {
    const v = cssValue(p, values[p.name] ?? p.value)
    if (v !== null) out[`--p-${p.name}`] = v
  }
  return out
}

/** What `useParams()` returns inside a frame. Springs are motion-ready transitions. */
export function runtimeValues(params: Param[], values: Record<string, ParamValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of params) {
    const v = values[p.name] ?? p.value
    out[p.name] = p.kind === 'spring' ? { type: 'spring', ...(v as Spring) } : p.kind === 'number' ? roundFor(p, v as number) : v
  }
  return out
}

export function defaults(params: Param[]): Record<string, ParamValue> {
  return Object.fromEntries(params.map((p) => [p.name, p.value]))
}

/** Free-form annotations: `@trigger hover`, `@animates transform, opacity`. */
export function annotation(source: string, key: string): string | undefined {
  const m = new RegExp(`@${key}[ \\t]+(.*?)(?=\\*\\/|\\n|$)`).exec(source)
  return m?.[1].trim()
}
