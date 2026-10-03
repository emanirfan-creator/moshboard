// A component's own props, read from its code, as controls for the side panel.
//
// The default-exported component's destructured defaults give the starting
// values; its props type (an interface or type in the frame or any of its
// modules) gives each prop's kind, choices and description. Props with no
// sensible control (callbacks, refs, nodes, objects) are left out.

export type PropKind = 'number' | 'boolean' | 'choice' | 'color' | 'text'

export interface PropDef {
  name: string
  kind: PropKind
  /** "Fbm amplitude" → "FBM amplitude": plain words, sentence case */
  label: string
  /** the prop's doc comment, when it says more than the label */
  help?: string
  /** section in the panel ("Sphere", "Noise", "Color"…) */
  group: string
  /** value the component falls back to; undefined when it has no default */
  value: unknown
  /** choice */
  options?: string[]
  /** choice: the options are numbers (`64 | 32 | 20`), shown as text */
  numeric?: boolean
  /** number: the slider's span (typing a value past it still works) */
  min?: number
  max?: number
  step?: number
  /** color: a CSS string, or an [r, g, b] array in 0..1 or 0..255 */
  format?: 'css' | 'rgb01' | 'rgb255'
}

/** Overrides for props are kept apart from @param and motion names. */
export const PROP_PREFIX = 'prop:'
export const isPropName = (name: string) => name.startsWith(PROP_PREFIX)

/** Values to render the component with: saved ones, then unsaved tweaks (`prop:<name>` overrides). */
export function componentProps(saved: Record<string, unknown> | undefined, overrides: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...saved }
  for (const [k, v] of Object.entries(overrides)) if (isPropName(k)) out[k.slice(PROP_PREFIX.length)] = v
  return out
}

const SKIP = new Set(['className', 'style', 'children', 'ref', 'key', 'as', 'asChild', 'id', 'slot'])
/** A prop is a color when its name ends in a color word: `fluidColor`, `background`, `strokeTint`. */
const isColorName = (name: string) => /^(colou?r|tint|fill|stroke|background|bg)$/.test(words(name).at(-1) ?? '')
const CSS_COLOR = /^(#[0-9a-f]{3,8}|(?:rgba?|hsla?|oklch|oklab)\(.*\))$/i

export function detectProps(source: string, modules: Record<string, string> = {}): PropDef[] {
  const name = componentName(source)
  if (!name) return []
  const sources = [source, ...Object.values(modules)]
  const sig = signature(source, name)
  if (!sig) return []

  const defaults = sig.pattern ? destructured(sig.pattern) : new Map<string, string | undefined>()
  const members = new Map<string, Member>()
  for (const body of typeBodies(sig.type, name, sources)) for (const m of typeMembers(body)) if (!members.has(m.name)) members.set(m.name, m)

  // Interface order first (its authors grouped related props), then any destructured extras.
  const names = [...members.keys(), ...[...defaults.keys()].filter((n) => !members.has(n))]
  if (sig.pattern) {
    // A component that destructures only some of its type's props: the rest go to the DOM, not to us.
    const rest = /\.\.\.\s*\w+\s*$/.test(sig.pattern.trim())
    if (!rest) names.splice(0, names.length, ...names.filter((n) => defaults.has(n)))
  }

  const out: PropDef[] = []
  for (const n of names) {
    if (SKIP.has(n) || /^on[A-Z]/.test(n)) continue
    const m = members.get(n)
    const value = literal(defaults.get(n))
    const def = toDef(n, m ? resolveAliases(m.type, sources) : undefined, value)
    if (!def) continue
    const help = m?.doc && cleanHelp(m.doc, def.label)
    if (help) def.help = help
    if (def.kind === 'number') Object.assign(def, docRange(m?.doc) ?? range(n, def.value as number))
    out.push(def)
  }
  return group(out)
}

// ── finding the component ───────────────────────────────

function componentName(src: string) {
  return (
    /export\s+default\s+(?:async\s+)?function\s+([A-Z]\w*)/.exec(src)?.[1] ??
    /export\s+default\s+(?:React\.)?(?:memo|forwardRef)\s*\(\s*([A-Z]\w*)\s*\)/.exec(src)?.[1] ??
    /export\s+default\s+([A-Z]\w*)\s*;?\s*$/m.exec(src)?.[1] ??
    /export\s+(?:function|const|let|class)\s+([A-Z]\w*)/.exec(src)?.[1] ??
    /export\s*\{\s*([A-Z]\w*)/.exec(src)?.[1] ??
    /(?:function|const)\s+([A-Z]\w*)/.exec(src)?.[1]
  )
}

/** The component's parameter: its destructuring pattern (if any) and the type it's annotated with. */
function signature(src: string, name: string): { pattern?: string; type: string } | undefined {
  const decl = new RegExp(`(?:function\\s+${name}\\b|(?:const|let)\\s+${name}\\b)`).exec(src)
  if (!decl) return
  const from = decl.index + decl[0].length
  // forwardRef<El, Props>(…): the props type is the second type argument.
  const generic = /^\s*(?::[^=]*)?=\s*(?:React\.)?forwardRef\s*<([^>]*)>/.exec(src.slice(from))
  const open = src.indexOf('(', from)
  if (open < 0 || open - from > 300) return
  // `memo((…) => …)` / `forwardRef(function (…) …)`: step into the inner function's parameters.
  let at = open + 1
  const inner = /^\s*(?:function\s*\w*\s*)?\(/.exec(src.slice(at))
  if (inner && /(?:memo|forwardRef)\s*(?:<[^>]*>)?\s*$/.test(src.slice(from, open))) at += inner[0].length
  const close = matchClose(src, at - 1)
  if (close < 0) return
  const params = src.slice(at, close)
  const first = splitTop(params, ',')[0]?.trim() ?? ''
  let pattern: string | undefined
  let type = ''
  if (first.startsWith('{')) {
    const end = matchClose(first, 0)
    pattern = first.slice(1, end)
    type = first.slice(end + 1).replace(/^\s*:/, '').trim()
  } else {
    type = first.replace(/^\w+\s*\??\s*:?/, '').trim()
  }
  if (generic) type = `${type} & ${splitTop(generic[1], ',')[1] ?? ''}`
  return { pattern, type }
}

// ── types ───────────────────────────────────────────────

interface Member {
  name: string
  type: string
  doc?: string
}

/** The members of a named props type (and what it extends), from any of `sources`. */
export function propsTypeMembers(typeName: string, sources: string[]): Member[] {
  return typeBodies(typeName, '', sources).flatMap(typeMembers)
}

/** Bodies (`{ … }`) of the props type: inline, or found by name in any source. */
function typeBodies(type: string, component: string, sources: string[]): string[] {
  const bodies: string[] = []
  const t = type.trim()
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== '{') continue
    const end = matchClose(t, i)
    bodies.push(t.slice(i + 1, end))
    i = end
  }
  const names = new Set(t.replace(/\{[\s\S]*\}/g, '').match(/\b[A-Z]\w*\b/g) ?? [])
  if (!t) names.add(`${component}Props`)
  for (const n of names) {
    for (const src of sources) {
      const m = new RegExp(`(?:interface\\s+${n}\\b[^{]*|type\\s+${n}\\s*(?:<[^>]*>)?\\s*=\\s*[^{;]*)\\{`).exec(src)
      if (!m) continue
      const open = m.index + m[0].length - 1
      bodies.push(src.slice(open + 1, matchClose(src, open)))
      // `interface A extends B`: B's props count too, when B is one of ours.
      const ext = /extends\s+([^{]+)$/.exec(m[0].slice(0, -1))?.[1]
      if (ext) for (const b of typeBodies(ext.replace(/<[^>]*>/g, ''), '', sources)) bodies.push(b)
      break
    }
  }
  return bodies
}

/** `/** doc *\/ name?: type` entries at the top level of a type body. */
function typeMembers(body: string): Member[] {
  const out: Member[] = []
  let doc: string | undefined
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (/\s|[;,]/.test(c)) {
      i++
      continue
    }
    if (body.startsWith('/*', i)) {
      const end = body.indexOf('*/', i + 2)
      doc = body
        .slice(i + 2, end < 0 ? body.length : end)
        .replace(/^\*+/, '')
        .split('\n')
        .map((l) => l.replace(/^\s*\*\s?/, '').trim())
        .filter(Boolean)
        .join(' ')
      i = end < 0 ? body.length : end + 2
      continue
    }
    if (body.startsWith('//', i)) {
      const end = body.indexOf('\n', i)
      i = end < 0 ? body.length : end
      continue
    }
    const m = /^(?:readonly\s+)?(['"]?)([A-Za-z_$][\w$-]*)\1\s*(\?)?\s*:/.exec(body.slice(i))
    if (!m) {
      // Index signatures, methods, anything else: skip to the next entry.
      i = nextEntry(body, i)
      doc = undefined
      continue
    }
    const start = i + m[0].length
    const end = nextEntry(body, start)
    let type = body.slice(start, end).trim()
    // A trailing `// note` on the same line documents the prop too.
    const trailing = /\/\/(.*)$/.exec(type)
    if (trailing) {
      type = type.slice(0, trailing.index).trim()
      doc ??= trailing[1].trim()
    }
    out.push({ name: m[2], type, doc })
    doc = undefined
    i = end
  }
  return out
}

function nextEntry(s: string, from: number) {
  let depth = 0
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(s, i)
      continue
    }
    if (s.startsWith('/*', i) && depth === 0) return i
    if ('{[(<'.includes(c)) depth++
    else if ('}])>'.includes(c) && !(c === '>' && s[i - 1] === '=')) depth--
    else if (depth === 0 && (c === ';' || c === ',' || c === '\n')) {
      // A union continued on the next line (`\n | 'b'`) is still this entry.
      if (c === '\n' && /^\s*[|&]/.test(s.slice(i + 1))) continue
      if (c === '\n' && /[|&:]\s*$/.test(s.slice(from, i))) continue
      return i
    }
  }
  return s.length
}

/** `AudioMode` → `'ambient' | 'mic' | 'file'`, one level deep, from any source. */
function resolveAliases(type: string, sources: string[]) {
  return type.replace(/\b[A-Z]\w*\b/g, (n) => {
    for (const src of sources) {
      const m = new RegExp(`type\\s+${n}\\s*=\\s*([^;\\n]+(?:\\n\\s*\\|[^;\\n]+)*)`).exec(src)
      if (m && !m[1].trim().startsWith('{')) return `(${m[1].trim()})`
    }
    return n
  })
}

function toDef(name: string, type: string | undefined, value: unknown): PropDef | undefined {
  const label = humanize(name)
  const base = { name, label, group: '', value }
  if (type !== undefined) {
    const t = type.replace(/\s+/g, ' ').replace(/^\(|\)$/g, '').trim()
    if (/=>|\bReact(Node|Element)\b|\bRef(Object)?\b|\bJSX\b|Element\b|CSSProperties|\bRecord\b|\bfunction\b/.test(t)) return
    const parts = t
      .split('|')
      .map((p) => p.replace(/^\(|\)$/g, '').trim())
      .filter((p) => p && p !== 'undefined' && p !== 'null')
    if (parts.length && parts.every((p) => /^(['"]).*\1$/.test(p))) {
      return { ...base, kind: 'choice', options: parts.map((p) => p.slice(1, -1)) }
    }
    if (parts.length > 1 && parts.every((p) => /^-?\d*\.?\d+$/.test(p))) {
      return { ...base, kind: 'choice', options: parts, numeric: true }
    }
    if (parts.length === 1 && parts[0] === 'boolean') return { ...base, kind: 'boolean', value: value ?? false }
    if (parts.length === 1 && parts[0] === 'number') {
      if (typeof value === 'number' && !Number.isFinite(value)) return
      return { ...base, kind: 'number', value: typeof value === 'number' ? value : 0 }
    }
    if (parts.length === 1 && parts[0] === 'string') {
      if (isColorName(name) || (typeof value === 'string' && CSS_COLOR.test(value)))
        return { ...base, kind: 'color', format: 'css', value: value ?? '#ffffff' }
      return { ...base, kind: 'text', value: value ?? '' }
    }
    if (/^(\[\s*number(\s*,\s*number){2,3}\s*\]|number\[\])$/.test(parts.join('|')) && isColorName(name)) {
      return colorArray(base, value)
    }
    // Anything else (objects, mixed unions) only gets a control if its default says what it is.
    if (value === undefined) return
  }
  if (typeof value === 'boolean') return { ...base, kind: 'boolean' }
  if (typeof value === 'number') return Number.isFinite(value) ? { ...base, kind: 'number' } : undefined
  if (typeof value === 'string') {
    if (CSS_COLOR.test(value)) return { ...base, kind: 'color', format: 'css' }
    return { ...base, kind: 'text' }
  }
  if (Array.isArray(value) && isColorName(name) && value.length >= 3 && value.every((n) => typeof n === 'number')) {
    return colorArray(base, value)
  }
}

function colorArray(base: Omit<PropDef, 'kind'>, value: unknown): PropDef {
  const arr = Array.isArray(value) ? (value as number[]) : [1, 1, 1]
  return { ...base, kind: 'color', format: arr.some((n) => n > 1) ? 'rgb255' : 'rgb01', value: arr }
}

// ── values ──────────────────────────────────────────────

/** `{ a = 1, b, c: alias = 'x', ...rest }` (without the braces) → name → default text. */
function destructured(pattern: string) {
  const out = new Map<string, string | undefined>()
  for (const entry of splitTop(pattern, ',')) {
    const e = entry.trim()
    if (!e || e.startsWith('...')) continue
    const m = /^([A-Za-z_$][\w$]*)\s*(?::\s*[A-Za-z_$][\w$]*\s*)?(?:=\s*([\s\S]+))?$/.exec(e)
    if (m) out.set(m[1], m[2]?.trim())
  }
  return out
}

/** The default's value when it's a plain literal; undefined for anything computed. */
function literal(text: string | undefined): unknown {
  if (text === undefined) return undefined
  const t = text.trim()
  if (t === 'true' || t === 'false') return t === 'true'
  if (/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(t)) return Number(t)
  if (t === 'Infinity') return Infinity
  if (/^(['"])(?:(?!\1)[^\\]|\\.)*\1$/.test(t) || /^`[^`$]*`$/.test(t)) return t.slice(1, -1)
  if (/^\[[\s\d.,-]*\]$/.test(t)) {
    try {
      return JSON.parse(t)
    } catch {
      return undefined
    }
  }
  return undefined
}

// ── ranges ──────────────────────────────────────────────

/** `@min 0 @max 2 @step 0.1`, or "0-1" / "0 to 1" / "0..1" in the doc. */
function docRange(doc?: string): Partial<PropDef> | undefined {
  if (!doc) return
  const tag = (t: string) => {
    const m = new RegExp(`@${t}\\s+(-?[\\d.]+)`).exec(doc)
    return m ? Number(m[1]) : undefined
  }
  const min = tag('min')
  const max = tag('max')
  if (min !== undefined && max !== undefined) return { min, max, step: tag('step') }
  const m = /(-?\d*\.?\d+)\s*(?:–|-|to|\.\.)\s*(-?\d*\.?\d+)/.exec(doc)
  if (m && Number(m[2]) > Number(m[1])) return { min: Number(m[1]), max: Number(m[2]) }
}

const UNIT = /(opacity|alpha|strength|amount|mix|intensity|progress|ratio|blend|weight)$/i
const COUNT = /(count|segments|steps|particles|columns|cols|rows|lines|samples|octaves|iterations|items|points|sides|layers|^num[A-Z])/
const SIGNED = /(contrast|offset|rotation|rotate|angle|tilt|skew|^[xyz]$|[XYZ]$|hue|bias|shift|exposure)/i

/** A slider span that fits the default: a 0..1 mix stays 0..1, a count steps by 1, the rest scale off the default. */
function range(name: string, v: number): Partial<PropDef> {
  if (UNIT.test(name) && v >= 0 && v <= 1) return { min: 0, max: 1, step: 0.01 }
  if (COUNT.test(name) && Number.isInteger(v)) return { min: 0, max: Math.max(10, nice(v * 3)), step: 1 }
  if (v === 0) return SIGNED.test(name) ? { min: -1, max: 1 } : { min: 0, max: 1 }
  const top = nice(Math.abs(v) * 3)
  if (v < 0 || SIGNED.test(name)) return { min: -top, max: top }
  return { min: 0, max: top, step: Number.isInteger(v) && v >= 10 ? 1 : undefined }
}

/** Round up to 1, 2, 2.5 or 5 × 10ⁿ. */
function nice(x: number) {
  const p = 10 ** Math.floor(Math.log10(x))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= x - 1e-9) return m * p
  return 10 * p
}

// ── words ───────────────────────────────────────────────

const ACRONYMS = new Set(['rgb', 'rgba', 'fps', 'hdr', 'uv', 'svg', 'css', 'html', 'api', 'ui', 'gpu', 'hsl', 'xy', 'xyz', '2d', '3d'])

/** Developer words in prop names, said plainly. Multi-word ones match first. */
const PLAIN: [string[], string[]][] = [
  [['time', 'scale'], ['speed']],
  [['sound', 'scale'], ['sound', 'strength']],
  [['audio', 'scale'], ['audio', 'strength']],
  [['overall'], []],
  [['src'], ['source']],
  [['url'], ['link']],
  [['href'], ['link']],
  [['img'], ['image']],
  [['bg'], ['background']],
  [['alpha'], ['opacity']],
  [['amplitude'], ['strength']],
  [['amp'], ['strength']],
  [['fbm'], ['swirl']],
  [['dpr'], ['sharpness']],
  [['fov'], ['field', 'of', 'view']],
  [['lerp'], ['smoothing']],
  [['num'], ['number', 'of']],
  [['max'], ['maximum']],
  [['min'], ['minimum']],
  [['btn'], ['button']],
  [['msg'], ['message']],
  [['idx'], ['index']],
  [['cfg'], ['settings']],
]

/** Words of an identifier: `fbmAmplitude` → ["fbm", "amplitude"]. */
export function words(name: string) {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

/** Words said plainly: ["fbm", "amplitude"] → ["swirl", "strength"]. */
function plain(ws: string[]) {
  const out: string[] = []
  for (let i = 0; i < ws.length; ) {
    const hit = PLAIN.find(([from]) => from.every((w, j) => ws[i + j] === w))
    if (hit) {
      out.push(...hit[1])
      i += hit[0].length
    } else out.push(ws[i++])
  }
  return out.length ? out : ws
}

/** `fbmAmplitude` → "Swirl strength", `audioSrc` → "Audio source". */
export function humanize(name: string) {
  return plain(words(name))
    .map((w, i) => (ACRONYMS.has(w) ? w.toUpperCase() : i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/** Words that mean a doc comment was written for developers, not for the person tuning. */
const JARGON =
  /\b(legacy|deprecated|ref|refs|prop|props|render(s|ed|ing)?|re-?render|rebinds?|binds?|analy[sz]er|callback|boolean|override(s|n)?|overridden|ssr|hydrat\w*|dom|node|instance|mount(s|ed)?|unmount|hook|context|provider|memo\w*|async|promise|null|undefined|uniform|shader|buffer|canvas|webgl|webgpu|fallback|default(s|ed)?|internal(ly)?|api|prefix|suffix|param(s|eter)?)\b/i

/**
 * A component's doc comment as help, when it helps someone who isn't a developer:
 * the first sentence, without asides in brackets or after a dash; dropped when it
 * names code (`audioMode`), uses developer words, or only repeats the label.
 */
function cleanHelp(doc: string, label: string) {
  let text = doc
    .replace(/@\w+\s+\S+/g, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\bCSS (pixels|px)\b/gi, 'pixels')
    .replace(/\s+[—–-]\s+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  text = (/^.*?[.!?](\s|$)/.exec(text)?.[0] ?? text).trim().replace(/[.!?]$/, '')
  if (!text || text.length > 90) return
  if (/[a-z][A-Z]|`|=>|[{}[\]<>]|\w\.\w|"[a-z]+"/.test(text) || JARGON.test(text)) return
  const stop = new Set(['the', 'a', 'an', 'of', 'to', 'for', 'and', 'or', 'in', 'on', 'is', 'current', 'value', 'mode', 'type', 'setting'])
  const own = new Set(words(label).filter((w) => !stop.has(w)))
  const extra = plain(words(text)).filter((w) => !stop.has(w) && !own.has(w))
  if (extra.length <= 1) return
  return text.replace(/^./, (c) => c.toUpperCase()) + '.'
}

// ── sections ────────────────────────────────────────────

/** Prefixes that say nothing about what a prop is about. */
const VERBS = new Set(['use', 'is', 'has', 'show', 'enable', 'disable', 'with', 'should', 'can', 'allow', 'auto', 'default', 'overall', 'initial', 'base'])

const TOPICS: [RegExp, string][] = [
  [/^(audio|sound|mic|microphone|volume|music|beat)$/, 'Audio'],
  [/^(colou?r|opacity|alpha|exposure|contrast|saturation|brightness|hue|tint|gamma|fill|stroke|background|bg)$/, 'Color'],
  [/^(speed|duration|delay|time|animated|animate|animation|fade|loop|stagger|interval|ease|easing|spring|damping|stiffness|autoplay)$/, 'Motion'],
  [/^(size|scale|radius|width|height|gap|padding|margin|spacing|thickness|zoom|corner)$/, 'Size'],
  [/^(text|label|title|font|placeholder|content|caption)$/, 'Text'],
]

/**
 * Sections by what props are about: names that share a first word ("sphereScale",
 * "spherePower") form a section named after it; the rest fall into topic sections
 * (Size, Color, Motion, Audio…) by the words in their names, or General.
 */
function group(props: PropDef[]): PropDef[] {
  const head = (p: PropDef) => words(p.name).find((w) => !VERBS.has(w)) ?? words(p.name)[0]
  const counts = new Map<string, number>()
  for (const p of props) counts.set(head(p), (counts.get(head(p)) ?? 0) + 1)
  const topicOf = (p: PropDef) => {
    const ws = words(p.name)
    // The first telling word: ring *color* opacity, *time* scale, overall *sound* scale.
    for (const w of ws) for (const [re, name] of TOPICS) if (re.test(w)) return name
  }
  for (const p of props) {
    const h = head(p)
    const own = (counts.get(h) ?? 0) >= 2 && !TOPICS.some(([re]) => re.test(h))
    p.group = own ? humanize(h) : (topicOf(p) ?? (p.kind === 'color' ? 'Color' : 'General'))
  }
  // A topic section with a single prop reads better folded into General.
  const sizes = new Map<string, number>()
  for (const p of props) sizes.set(p.group, (sizes.get(p.group) ?? 0) + 1)
  if (sizes.size > 1) for (const p of props) if (sizes.get(p.group) === 1 && p.group !== 'General') p.group = 'General'
  return props
}

/** Sections in order: General first, then as they first appear in the type. */
export function sections(props: PropDef[]): { title: string; props: PropDef[] }[] {
  const by = new Map<string, PropDef[]>()
  for (const p of props) {
    if (!by.has(p.group)) by.set(p.group, [])
    by.get(p.group)!.push(p)
  }
  const out = [...by].map(([title, ps]) => ({ title, props: ps }))
  return out.sort((a, b) => (a.title === 'General' ? -1 : b.title === 'General' ? 1 : 0))
}

// ── color values ────────────────────────────────────────

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')

/** A color prop's value as a CSS hex, for the picker. */
export function colorToCss(p: PropDef, v: unknown): string {
  if (p.format === 'css' || typeof v === 'string') return typeof v === 'string' ? v : '#ffffff'
  const arr = Array.isArray(v) ? (v as number[]) : [1, 1, 1]
  const k = p.format === 'rgb255' ? 1 : 255
  return `#${hex2(arr[0] * k)}${hex2(arr[1] * k)}${hex2(arr[2] * k)}`
}

/** The picker's hex back in the prop's own format. */
export function colorFromCss(p: PropDef, css: string, prev: unknown): unknown {
  if (p.format === 'css') return css
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(css)
  if (!m) return prev
  const k = p.format === 'rgb255' ? 1 : 1 / 255
  const rgb = [m[1], m[2], m[3]].map((h) => Math.round(parseInt(h, 16) * k * 1000) / 1000)
  const rest = Array.isArray(prev) && prev.length > 3 ? prev.slice(3) : []
  return [...rgb, ...rest]
}

// ── scanning ────────────────────────────────────────────

function skipString(s: string, i: number) {
  const q = s[i]
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') j++
    else if (s[j] === q) return j
  }
  return s.length
}

/** Index of the bracket closing the one at `open`. */
function matchClose(s: string, open: number) {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(s, i)
      continue
    }
    if (s.startsWith('//', i)) {
      const nl = s.indexOf('\n', i)
      i = nl < 0 ? s.length : nl
      continue
    }
    if (s.startsWith('/*', i)) {
      const end = s.indexOf('*/', i + 2)
      i = end < 0 ? s.length : end + 1
      continue
    }
    if ('{[('.includes(c)) depth++
    else if ('}])'.includes(c) && --depth === 0) return i
  }
  return -1
}

/** Split on `sep` at bracket depth 0, outside strings. */
function splitTop(s: string, sep: string) {
  const out: string[] = []
  let depth = 0
  let last = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(s, i)
      continue
    }
    if ('{[(<'.includes(c)) depth++
    else if ('}])>'.includes(c) && !(c === '>' && s[i - 1] === '=')) depth--
    else if (c === sep && depth === 0) {
      out.push(s.slice(last, i))
      last = i + 1
    }
  }
  out.push(s.slice(last))
  return out
}
