// `@param` annotations in code frames.
//
//   /* @param duration 320ms 80..1200 */
//   /* @param ease cubic-bezier(0.16, 1, 0.3, 1) */
//   /* @param spring stiffness=380 damping=26 */
//   /* @param tint #5e6ad2 */
//   /* @param mix 0.3 0..1 blur|sharp */   (a share between two named parts: a split control)
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
  /** values snap to this (a count steps by 1) */
  step?: number
  /** min/max only span the slider; a typed value can go past them */
  soft?: boolean
  /** a share between two named parts (`blur|sharp`): the value is the first part's share */
  parts?: [string, string]
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
      const parts = /([A-Za-z][\w-]*)\s*\|\s*([A-Za-z][\w-]*)/.exec(raw.slice(e[0].length))
      if (parts) p.parts = [parts[1], parts[2]]
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
  if (p.step) return round(Math.round(n / p.step) * p.step)
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
      const parts = p.parts ? ` ${p.parts.join('|')}` : ''
      return `${roundFor(p, v as number)}${p.unit}${range}${parts}`
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

const HOOK_RE = /\b(?:React\.)?(?:useEffect|useLayoutEffect|useInsertionEffect|useMemo|useCallback|useState|useReducer|useRef)\s*\(/g
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The text inside the parentheses that open at `open` (strings and comments skipped). */
function callBody(src: string, open: number) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++
    } else if (c === '/' && src[i + 1] === '/') i = src.indexOf('\n', i) === -1 ? src.length : src.indexOf('\n', i)
    else if (c === '/' && src[i + 1] === '*') i = src.indexOf('*/', i + 2) === -1 ? src.length : src.indexOf('*/', i + 2) + 1
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return src.slice(open + 1, i)
  }
  return src.slice(open + 1)
}

/**
 * Params the code only reads when it starts: inside an effect, memo, callback,
 * or a state/ref initializer. Re-rendering doesn't pick up a new value there,
 * so the frame restarts after those are tuned.
 */
export function startupParams(source: string, names: string[]): Set<string> {
  const bodies = [...source.matchAll(HOOK_RE)].map((m) => callBody(source, m.index! + m[0].length - 1))
  if (!bodies.length) return new Set()
  // How the code can refer to a param: getParams().x, p.x for `const p = useParams()`, or a destructured local.
  const aliases = [...source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:useParams|getParams)\(\)/g)].map((m) => m[1])
  const locals = new Map<string, string>()
  for (const m of source.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:useParams|getParams)\(\)/g))
    for (const part of m[1].split(',')) {
      const [key, local] = part.split(':').map((s) => s.trim().split('=')[0].trim())
      if (key) locals.set(key, local || key)
    }
  const out = new Set<string>()
  for (const name of names) {
    const n = esc(name)
    const reads = [
      `getParams\\(\\)\\s*(?:\\.\\s*${n}\\b|\\[\\s*["'\`]${n}["'\`]\\s*\\])`,
      ...aliases.map((a) => `\\b${esc(a)}\\s*\\.\\s*${n}\\b`),
      ...(locals.has(name) ? [`(?<![.\\w$])${esc(locals.get(name)!)}\\b`] : []),
    ]
    const re = new RegExp(reads.join('|'))
    if (bodies.some((b) => re.test(b))) out.add(name)
  }
  return out
}

/**
 * Where the code uses a param, for a readable label and a section to put it in:
 * `<Pause size={getParams().size2} />` → { element: 'Pause', prop: 'size' }.
 */
export function paramUse(source: string, name: string): { element?: string; prop?: string } {
  const n = esc(name)
  const aliases = [...source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:useParams|getParams)\(\)/g)].map((m) => esc(m[1]))
  const reads = [`getParams\\(\\)\\s*\\.\\s*${n}\\b`, ...aliases.map((a) => `\\b${a}\\s*\\.\\s*${n}\\b`), `var\\(--p-${n}\\b`]
  for (const m of source.matchAll(new RegExp(reads.join('|'), 'g'))) {
    const before = source.slice(Math.max(0, m.index! - 400), m.index)
    // A JSX attribute: `<Tag … prop={… here`, or `prop={{ key: here` (then the key is the prop).
    const jsx = /<([A-Za-z][\w.]*)\b[^<>]*?\s([A-Za-z][\w-]*)=\{(\{[^{}]*?([A-Za-z_][\w-]*)\s*:\s*)?[^{}]*$/.exec(before)
    // Only components name things (`<Pause>`); a plain `<div style>` says nothing a param name doesn't.
    const element = jsx?.[1].split('.').pop()
    if (jsx && element && /^[A-Z]/.test(element)) return { element, prop: jsx[4] ?? jsx[2] }
  }
  return {}
}

/** `autoRotateSpeed` / `auto_rotate-speed` → "Auto rotate speed" */
export const humanize = (name: string) =>
  name
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\d+$/, '')
    .trim()
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())

const SHARE_NAME = /^(mix|blend|crossfade|ratio|split|share|balance)$/i

/**
 * A number that's a share between two parts gets a split control: one with named parts
 * (`blur|sharp`), or a mix/ratio/balance… from 0 to 1 (or 0 to 100). The value is the first part's share.
 */
export function shareParts(p: Param): [string, string] | null {
  if (p.kind !== 'number') return null
  const whole = p.min === 0 && (p.max === 1 || p.max === 100)
  if (p.parts && whole) return p.parts
  if (!whole || !SHARE_NAME.test(p.name)) return null
  return /balance/i.test(p.name) ? ['Left', 'Right'] : [humanize(p.name), 'Rest']
}
