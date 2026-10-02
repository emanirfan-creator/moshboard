// Find the motion values a pasted component already has, without changing it.
//
// Scans a frame's source and its registry modules for literal timing values:
// motion/framer-motion transitions and variants, CSS transitions/animations
// (inline styles, <style> blocks, template strings), Tailwind duration/delay/ease
// classes, GSAP tweens and react-spring configs. Each value becomes a `Param`
// (same shape as `@param` ones, so the existing controls render it) plus the
// exact places it lives, so the preview can swap in live values on a copy and
// ⌘S can write tuned values back in the original units and format.
//
// Only literals count: `duration: open ? 0.2 : 0.4` or an imported constant is
// skipped rather than guessed at.

import { parse } from 'sucrase/dist/parser/index.js'
import { TokenType as tt } from 'sucrase/dist/parser/tokenizer/types.js'
import { NAMED_EASES } from './ease.ts'
import type { Bezier, Param, ParamValue, Spring } from './params.ts'

/** How a value is written in the code. JS formats are swapped for a runtime lookup; the rest are CSS text. */
export type Fmt =
  | 's' // JS number of seconds (shown as ms)
  | 'ms' // JS number of ms
  | 'num' // plain JS number
  | 'ease-array' // JS [x1, y1, x2, y2]
  | 'ease-name' // motion named ease ("easeOut")
  | 'gsap-ease' // GSAP ease string ("power2.out")
  | 'css-ease-js' // JS string holding a CSS easing (WAAPI `easing: "ease-out"`)
  | 'spring' // one part of a spring (stiffness/damping/mass)
  | 'css-time' // CSS time text, keeps its unit
  | 'css-ease' // CSS easing keyword or cubic-bezier()
  | 'tw-duration'
  | 'tw-delay'
  | 'tw-ease'

export interface Site {
  /** '' = the frame's own source, otherwise a module specifier from modules.json */
  file: string
  start: number
  end: number
  fmt: Fmt
  /** CSS time unit as written */
  unit?: 'ms' | 's'
  /** quote used around a JS string literal */
  quote?: string
  /** spring part, for fmt 'spring' */
  part?: keyof Spring
  /** Tailwind variant prefix, e.g. "hover:" */
  prefix?: string
}

export interface DetectedParam extends Param {
  label: string
  group: string
  file: string
  line: number
  sites: Site[]
  /** false when it sits in module-level code, which only runs on load (the frame reloads to apply it) */
  live: boolean
}

export interface DetectedGroup {
  id: string
  /** what it is, in plain words: "Scale spring", "Hover transition", "GSAP tween" */
  title: string
  /** where it lives: "GithubGraph · <motion.div>" */
  context: string
  /** title · context, for export */
  label: string
  file: string
  line: number
  params: DetectedParam[]
}

export interface Detection {
  params: DetectedParam[]
  groups: DetectedGroup[]
}

const JS_FMTS = new Set<Fmt>(['s', 'ms', 'num', 'ease-array', 'ease-name', 'gsap-ease', 'css-ease-js', 'spring'])
export const isJsSite = (s: Site) => JS_FMTS.has(s.fmt)

// ── easing tables ───────────────────────────────────────

const MOTION_EASES: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  circIn: [0.55, 0, 1, 0.45],
  circOut: [0, 0.55, 0.45, 1],
  circInOut: [0.85, 0, 0.15, 1],
  backIn: [0.36, 0, 0.66, -0.56],
  backOut: [0.34, 1.56, 0.64, 1],
  backInOut: [0.68, -0.6, 0.32, 1.6],
}
const CSS_EASES: Record<string, Bezier> = {
  linear: NAMED_EASES.linear,
  ease: NAMED_EASES.ease,
  'ease-in': NAMED_EASES['ease-in'],
  'ease-out': NAMED_EASES['ease-out'],
  'ease-in-out': NAMED_EASES['ease-in-out'],
}
const TW_EASES: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  in: [0.4, 0, 1, 1],
  out: [0, 0, 0.2, 1],
  'in-out': [0.4, 0, 0.2, 1],
}
const TW_STEPS = [0, 75, 100, 150, 200, 300, 500, 700, 1000]
// GSAP's eases as their closest cubic-beziers (power1 = quad … power4 = quint).
const GSAP_FAMILIES: Record<string, Record<'in' | 'out' | 'inOut', Bezier>> = {
  power1: { in: [0.11, 0, 0.5, 0], out: [0.5, 1, 0.89, 1], inOut: [0.45, 0, 0.55, 1] },
  power2: { in: [0.32, 0, 0.67, 0], out: [0.33, 1, 0.68, 1], inOut: [0.65, 0, 0.35, 1] },
  power3: { in: [0.5, 0, 0.75, 0], out: [0.25, 1, 0.5, 1], inOut: [0.76, 0, 0.24, 1] },
  power4: { in: [0.64, 0, 0.78, 0], out: [0.22, 1, 0.36, 1], inOut: [0.83, 0, 0.17, 1] },
  sine: { in: [0.12, 0, 0.39, 0], out: [0.61, 1, 0.88, 1], inOut: [0.37, 0, 0.63, 1] },
  expo: { in: [0.7, 0, 0.84, 0], out: [0.16, 1, 0.3, 1], inOut: [0.87, 0, 0.13, 1] },
  circ: { in: [0.55, 0, 1, 0.45], out: [0, 0.55, 0.45, 1], inOut: [0.85, 0, 0.15, 1] },
  back: { in: [0.36, 0, 0.66, -0.56], out: [0.34, 1.56, 0.64, 1], inOut: [0.68, -0.6, 0.32, 1.6] },
}
const GSAP_ALIAS: Record<string, string> = { quad: 'power1', cubic: 'power2', quart: 'power3', quint: 'power4', strong: 'power4' }

function gsapBezier(name: string): Bezier | null {
  if (name === 'none' || name === 'linear' || name === 'power0') return [0, 0, 1, 1]
  const m = /^(\w+?)(?:\.(in|out|inOut))?$/.exec(name)
  if (!m) return null
  const fam = GSAP_FAMILIES[GSAP_ALIAS[m[1]] ?? m[1]]
  return fam ? fam[(m[2] as 'in' | 'out' | 'inOut') ?? 'out'] : null
}

const sameBezier = (a: Bezier, b: Bezier) => a.every((n, i) => Math.abs(n - b[i]) < 0.005)
const nameFor = (table: Record<string, Bezier>, b: Bezier) => Object.entries(table).find(([, v]) => sameBezier(v, b))?.[0]
const bezierDist = (a: Bezier, b: Bezier) => a.reduce((s, n, i) => s + (n - b[i]) ** 2, 0)
const BEZIER_RE = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/

function cssEase(text: string): Bezier | null {
  const t = text.trim()
  if (t in CSS_EASES) return CSS_EASES[t]
  const m = BEZIER_RE.exec(t)
  return m ? [+m[1], +m[2], +m[3], +m[4]] : null
}

// ── helpers ─────────────────────────────────────────────

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d
const nice = (n: number) => +n.toPrecision(2)
const slug = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
const words = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const tag = (el?: string) => (el ? `<${el}>` : undefined)
const join = (...parts: (string | undefined | false)[]) => [...new Set(parts.filter(Boolean))].join(' · ')
// motion's shorthand keys, as people say them
const PROP_WORDS: Record<string, string> = {
  x: 'X position',
  y: 'Y position',
  z: 'Z position',
  rotate: 'Rotation',
  rotateX: 'X rotation',
  rotateY: 'Y rotation',
  scaleX: 'X scale',
  scaleY: 'Y scale',
  pathLength: 'Path length',
  backgroundColor: 'Background',
}
const propWords = (key: string) => PROP_WORDS[key] ?? cap(words(key))
// motion's gesture/state props, for "Hover transition" etc.
const STATE_PROPS: Record<string, string> = {
  whileHover: 'Hover',
  whileTap: 'Press',
  whileFocus: 'Focus',
  whileDrag: 'Drag',
  whileInView: 'In view',
  animate: 'Enter',
  initial: 'Initial',
  exit: 'Exit',
}
const fileLabel = (file: string, main: string) => (file ? `${file.split('/').pop()}.tsx` : main)

function lineAt(src: string, offset: number) {
  let n = 1
  for (let i = 0; i < offset && i < src.length; i++) if (src.charCodeAt(i) === 10) n++
  return n
}

/** What a detected value is, before it gets a name. */
interface Raw {
  prop: 'duration' | 'delay' | 'stagger' | 'delayChildren' | 'ease' | 'spring' | 'bounce'
  kind: 'number' | 'ease' | 'spring'
  value: ParamValue
  sites: Site[]
}
interface RawGroup {
  title: string
  context: string
  file: string
  at: number
  live: boolean
  values: Raw[]
}

function timeRaw(prop: Raw['prop'], ms: number, site: Site): Raw {
  return { prop, kind: 'number', value: round(ms, 2), sites: [site] }
}

// ── CSS ─────────────────────────────────────────────────

const CSS_DECL =
  /(?<![\w-])(transition|transition-duration|transition-delay|transition-timing-function|animation|animation-duration|animation-delay|animation-timing-function)\s*:\s*([^;{}"'`]+)/g
const CAMEL_CSS: Record<string, string> = {
  transition: 'transition',
  transitionDuration: 'transition-duration',
  transitionDelay: 'transition-delay',
  transitionTimingFunction: 'transition-timing-function',
  animation: 'animation',
  animationDuration: 'animation-duration',
  animationDelay: 'animation-delay',
  animationTimingFunction: 'animation-timing-function',
}
const TIME_RE = /^(-?\d*\.?\d+)(ms|s)$/

/** Split a CSS value on top-level commas (cubic-bezier has its own). */
function splitTop(value: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i <= value.length; i++) {
    const c = value[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if ((c === ',' && depth === 0) || i === value.length) {
      out.push({ text: value.slice(from, i), at: from })
      from = i + 1
    }
  }
  return out
}

/** One CSS declaration value → one group per transition/animation item. */
function cssGroups(prop: string, value: string, base: number, file: string, context: string, live: boolean): RawGroup[] {
  const groups: RawGroup[] = []
  const longhand = prop.split('-').slice(1).join('-')
  for (const item of splitTop(value)) {
    const values: Raw[] = []
    let times = 0
    let subject = ''
    for (const m of item.text.matchAll(/cubic-bezier\([^)]*\)|steps\([^)]*\)|[^\s]+/g)) {
      const tok = m[0]
      const start = base + item.at + m.index!
      const site = (fmt: Fmt, unit?: 'ms' | 's'): Site => ({ file, start, end: start + tok.length, fmt, unit })
      const time = TIME_RE.exec(tok)
      if (time && longhand !== 'timing-function') {
        const ms = +time[1] * (time[2] === 's' ? 1000 : 1)
        const which = longhand === 'delay' ? 'delay' : longhand === 'duration' ? 'duration' : times === 0 ? 'duration' : 'delay'
        times++
        values.push(timeRaw(which, ms, site('css-time', time[2] as 'ms' | 's')))
        continue
      }
      const ease = longhand === 'duration' || longhand === 'delay' ? null : cssEase(tok)
      if (ease) {
        values.push({ prop: 'ease', kind: 'ease', value: ease, sites: [site('css-ease')] })
        continue
      }
      if (!subject && !longhand && /^[a-z-]+$/i.test(tok)) subject = tok
    }
    if (!values.length) continue
    const animation = prop.startsWith('animation')
    const title = animation
      ? subject
        ? `“${subject}” animation`
        : 'Animation'
      : subject && subject !== 'all'
        ? `${propWords(subject)} transition`
        : 'Transition'
    groups.push({ title, context, file, at: base + item.at, live, values })
  }
  return groups
}

/** CSS text (a <style> block, a template string, an HTML file): every transition/animation declaration. */
function scanCss(text: string, base: number, file: string, fallback: string): RawGroup[] {
  const groups: RawGroup[] = []
  for (const m of text.matchAll(CSS_DECL)) {
    const before = text.slice(0, m.index)
    const open = before.lastIndexOf('{')
    const attr = before.lastIndexOf('style=')
    let where = fallback
    if (open > before.lastIndexOf('}') && open > attr) {
      const sel = before
        .slice(Math.max(before.lastIndexOf('}', open) + 1, 0), open)
        .replace(/^[\s\S]*<\w+[^>]*>/, '')
        .trim()
        .split('\n')
        .pop()!
        .trim()
      if (sel && sel.length < 60) where = join(fallback, sel)
    }
    const valueAt = m.index! + m[0].length - m[2].length
    groups.push(...cssGroups(m[1], m[2].trimEnd(), base + valueAt, file, where, true))
  }
  return groups
}

// ── Tailwind ────────────────────────────────────────────

const TW_RE = /(^|[\s"'`])((?:[\w-]+:)*)(duration|delay|ease)-(\d+|linear|in-out|in|out|\[[^\]\s]+\])(?=$|[\s"'`])/g

function scanTailwind(text: string, base: number, file: string, where: string): RawGroup | null {
  const values: Raw[] = []
  for (const m of text.matchAll(TW_RE)) {
    const start = base + m.index! + m[1].length
    const end = start + m[2].length + m[3].length + 1 + m[4].length
    const prefix = m[2]
    const v = m[4]
    const site = (fmt: Fmt): Site => ({ file, start, end, fmt, prefix })
    if (m[3] === 'ease') {
      const b = v.startsWith('[') ? cssEase(v.slice(1, -1).replace(/_/g, ' ')) : TW_EASES[v]
      if (b) values.push({ prop: 'ease', kind: 'ease', value: b, sites: [site('tw-ease')] })
      continue
    }
    let ms: number | null = null
    if (/^\d+$/.test(v)) ms = +v
    else {
      const t = TIME_RE.exec(v.slice(1, -1))
      if (t) ms = +t[1] * (t[2] === 's' ? 1000 : 1)
    }
    if (ms === null) continue
    values.push(timeRaw(m[3] as 'duration' | 'delay', ms, site(m[3] === 'duration' ? 'tw-duration' : 'tw-delay')))
  }
  const states = [...new Set(values.flatMap((v) => v.sites.map((s) => s.prefix?.replace(/:$/, '')).filter(Boolean)))]
  const title = states.length === 1 && values.every((v) => v.sites.every((s) => s.prefix)) ? `${cap(words(states[0]!))} transition` : 'Transition'
  return values.length ? { title: `${title} classes`, context: where, file, at: base, live: true, values } : null
}

// ── JS (motion, GSAP, react-spring, WAAPI, inline styles) ──

interface Tok {
  type: number
  start: number
  end: number
}
interface Prop {
  key: string
  tok: Tok
  /** value literal range, absent when the value isn't a literal */
  lit?: { start: number; end: number; kind: 'num' | 'str' | 'arr'; num?: number; str?: string; quote?: string; arr?: Bezier }
  child?: Entry
}
interface Entry {
  type: number
  open: number
  fn: boolean
  live: boolean
  ownerKey?: string
  attr?: string
  element?: string
  callee?: string
  args: number
  props: Prop[]
  parent?: Entry
  argOf?: Entry
}

const GSAP_CALL = /^(gsap|tl|timeline|tween|\w*[Tt]imeline\w*|\w*[Tt]l)\.(to|from|fromTo|set)$|^gsap\.(to|from|fromTo|set|timeline)$/
const SPRING_CALL = /^(useSpring|useSprings|useTrail|useTransition|useSpringValue|useSpringRef|\w+\.start|\w+\.set)$/
const MOTION_CALL = /^(animate|\w+\.start|animateMini|useAnimate)$/
const WAAPI_CALL = /\.animate$/

function scanJs(src: string, base: number, file: string, fallbackComponent: string): { groups: RawGroup[]; claimed: Set<number>; tokens: Tok[]; componentAt: (at: number) => string } | null {
  let tokens: Tok[]
  try {
    tokens = parse(src, true, true, false).tokens as Tok[]
  } catch {
    return null
  }
  const text = (t: Tok) => src.slice(t.start, t.end)
  const groups: RawGroup[] = []
  const claimed = new Set<number>()
  const hasGsap = /\bgsap\b/.test(src)

  // Names by position: components (`function Name`, `const Name =`) and any declaration,
  // so module-level variants read as "list · show" rather than the file name.
  const comps: { at: number; name: string }[] = []
  const decls: { at: number; name: string }[] = []
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i]
    if ((t.type === tt._function || t.type === tt._const || t.type === tt._let) && tokens[i + 1].type === tt.name) {
      const n = text(tokens[i + 1])
      decls.push({ at: tokens[i + 1].start, name: n })
      if (/^[A-Z]/.test(n)) comps.push({ at: tokens[i + 1].start, name: n })
    }
  }
  const nearest = (list: { at: number; name: string }[], at: number) => [...list].reverse().find((c) => c.at <= at)?.name
  const componentAt = (at: number) => nearest(comps, at) ?? fallbackComponent

  const elementAt = (i: number) => {
    for (let k = i; k >= 0; k--) {
      if (tokens[k].type === tt.jsxTagEnd) return undefined
      if (tokens[k].type === tt.jsxTagStart) {
        let n = ''
        for (let j = k + 1; j < i && (tokens[j].type === tt.jsxName || tokens[j].type === tt.dot); j++) {
          if (tokens[j].type === tt.jsxName && n && !n.endsWith('.')) break
          n += text(tokens[j])
        }
        return n || undefined
      }
    }
  }

  // Parameter lists: `(…) {`, `(…) =>`, `(…): Type {`. Defaults there run on every call, so they're live.
  const params = new Set<number>()
  {
    const opens: number[] = []
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === tt.parenL) opens.push(i)
      else if (tokens[i].type === tt.parenR) {
        const o = opens.pop()
        const n = tokens[i + 1]?.type
        if (o !== undefined && (n === tt.braceL || n === tt.arrow || n === tt.colon)) params.add(o)
      }
    }
  }

  const stack: Entry[] = []
  const top = () => stack[stack.length - 1]
  const inFn = () => stack.some((e) => e.fn)
  const OPEN = new Set([tt.braceL, tt.parenL, tt.bracketL, tt.dollarBraceL, tt.braceBarL])
  const CLOSE = new Set([tt.braceR, tt.parenR, tt.bracketR, tt.braceBarR])

  const calleeBefore = (i: number) => {
    let k = i - 1
    const parts: string[] = []
    while (k >= 0 && tokens[k].type === tt.name) {
      parts.unshift(text(tokens[k]))
      if (tokens[k - 1]?.type === tt.dot || tokens[k - 1]?.type === tt.questionDot) {
        parts.unshift('.')
        k -= 2
      } else break
    }
    return parts.join('')
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const prev = tokens[i - 1]
    if (OPEN.has(t.type)) {
      const parent = top()
      const fn =
        !!prev &&
        (prev.type === tt.arrow ||
          (t.type === tt.braceL &&
            (prev.type === tt.parenR ||
              prev.type === tt.jsxTagEnd ||
              prev.type === tt.jsxText ||
              (prev.type === tt.eq && tokens[i - 2]?.type === tt.jsxName))))
      const isParams = t.type === tt.parenL && params.has(i)
      const e: Entry = { type: t.type, open: i, fn: fn || isParams, live: fn || isParams || inFn(), args: 0, props: [], parent }
      if (t.type === tt.parenL) e.callee = calleeBefore(i)
      if (t.type === tt.braceL) {
        if (prev?.type === tt.eq && tokens[i - 2]?.type === tt.jsxName) {
          e.attr = text(tokens[i - 2])
          e.element = elementAt(i - 2)
        } else if (prev?.type === tt.braceL && parent?.attr) {
          e.attr = parent.attr
          e.element = parent.element
        } else if (prev?.type === tt.eq && tokens[i - 2]?.type === tt.name) {
          // `transition = { … }` (a default parameter or a variable)
          e.ownerKey = text(tokens[i - 2])
        } else if (prev?.type === tt.colon && parent?.type === tt.braceL) {
          const key = parent.props[parent.props.length - 1]
          if (key && key.tok === tokens[i - 2]) {
            e.ownerKey = key.key
            key.child = e
          }
        }
        if (parent?.type === tt.parenL && (prev?.type === tt.parenL || prev?.type === tt.comma)) e.argOf = parent
      }
      stack.push(e)
      continue
    }
    if (CLOSE.has(t.type)) {
      const e = stack.pop()
      if (e?.type === tt.braceL) groups.push(...objectGroups(e))
      continue
    }
    if (t.type === tt.comma && top()) top().args++

    // `key: literal` directly in the object on top of the stack.
    const e = top()
    if (
      e?.type === tt.braceL &&
      (t.type === tt.name || t.type === tt.string) &&
      tokens[i + 1]?.type === tt.colon &&
      (prev?.type === tt.braceL || prev?.type === tt.comma)
    ) {
      const key = t.type === tt.string ? text(t).slice(1, -1) : text(t)
      const p: Prop = { key, tok: t }
      let j = i + 2
      let neg = false
      if (tokens[j]?.type === tt.minus && tokens[j + 1]?.type === tt.num) {
        neg = true
        j++
      }
      const v = tokens[j]
      const ends = (k: number) => {
        const n = tokens[k]
        return n?.type === tt.comma || n?.type === tt.braceR || (n?.type === tt.name && text(n) === 'as')
      }
      const start = neg ? tokens[j - 1].start : v?.start
      if (v?.type === tt.num && ends(j + 1)) {
        p.lit = { start, end: v.end, kind: 'num', num: (neg ? -1 : 1) * Number(text(v).replace(/_/g, '')) }
      } else if (v?.type === tt.string && ends(j + 1)) {
        const raw = text(v)
        p.lit = { start: v.start, end: v.end, kind: 'str', str: raw.slice(1, -1), quote: raw[0] }
      } else if (v?.type === tt.bracketL) {
        const nums: number[] = []
        let k = j + 1
        while (nums.length < 4) {
          const sign = tokens[k]?.type === tt.minus ? -1 : 1
          if (sign < 0) k++
          if (tokens[k]?.type !== tt.num) break
          nums.push(sign * Number(text(tokens[k])))
          k++
          if (nums.length < 4 && tokens[k]?.type === tt.comma) k++
        }
        if (nums.length === 4 && tokens[k]?.type === tt.bracketR && ends(k + 1)) {
          p.lit = { start: v.start, end: tokens[k].end, kind: 'arr', arr: nums as Bezier }
        }
      }
      e.props.push(p)
    }
  }

  function objectGroups(e: Entry): RawGroup[] {
    const lit = (k: string) => e.props.find((p) => p.key === k)?.lit
    const num = (k: string) => {
      const l = lit(k)
      return l?.kind === 'num' ? l : undefined
    }
    const callee = e.argOf?.callee ?? ''
    const parentCallee = e.parent?.argOf?.callee ?? ''
    const component = e.live ? componentAt(tokens[e.open].start) : (nearest(decls, tokens[e.open].start) ?? fallbackComponent)
    const at = base + tokens[e.open].start
    const site = (l: NonNullable<Prop['lit']>, fmt: Fmt, part?: keyof Spring): Site => ({
      file,
      start: base + l.start,
      end: base + l.end,
      fmt,
      quote: l.quote,
      part,
    })
    const out: RawGroup[] = []
    const values: Raw[] = []
    let title = ''
    let context = component

    // CSS-in-JS: `style={{ transition: "transform 240ms ease" }}`
    for (const p of e.props) {
      const prop = CAMEL_CSS[p.key]
      if (!prop || p.lit?.kind !== 'str') continue
      claimed.add(base + p.lit.start)
      out.push(...cssGroups(prop, p.lit.str!, base + p.lit.start + 1, file, join(component, tag(e.element)), true))
    }

    const springParts = (map: Record<string, keyof Spring>) => {
      const parts = Object.entries(map).flatMap(([k, part]) => {
        const l = num(k)
        return l ? [{ l, part }] : []
      })
      if (!parts.some((p) => p.part === 'stiffness') || !parts.some((p) => p.part === 'damping')) return
      const value: Spring = { stiffness: 0, damping: 0 }
      for (const { l, part } of parts) value[part] = l.num!
      values.push({ prop: 'spring', kind: 'spring', value, sites: parts.map(({ l, part }) => site(l, 'spring', part)) })
    }
    const time = (k: string, prop: Raw['prop'], fmt: 's' | 'ms') => {
      const l = num(k)
      if (l && l.num! >= 0) values.push(timeRaw(prop, fmt === 's' ? l.num! * 1000 : l.num!, site(l, fmt)))
    }

    const isGsap = hasGsap && (GSAP_CALL.test(callee) || (e.ownerKey === 'defaults' && /timeline/.test(parentCallee)))
    const isSpring = !!num('tension') || !!num('friction')
    const transitionish =
      e.ownerKey === 'transition' ||
      /Transition$/.test(e.ownerKey ?? '') ||
      (e.attr === 'transition' && !e.ownerKey) ||
      MOTION_CALL.test(callee) ||
      lit('type')?.str === 'spring'

    if (isSpring && (e.ownerKey === 'config' || SPRING_CALL.test(callee) || !e.ownerKey)) {
      title = 'Spring'
      context = join(component, (e.parent?.argOf?.callee || callee) && `${e.parent?.argOf?.callee || callee}()`)
      springParts({ tension: 'stiffness', friction: 'damping', mass: 'mass' })
      time('duration', 'duration', 'ms')
    } else if (isGsap) {
      title = callee ? 'GSAP tween' : 'GSAP timeline defaults'
      context = join(component, callee && `${callee}()`)
      time('duration', 'duration', 's')
      time('delay', 'delay', 's')
      const ease = lit('ease')
      const b = ease?.kind === 'str' ? gsapBezier(ease.str!) : null
      if (ease && b) values.push({ prop: 'ease', kind: 'ease', value: b, sites: [site(ease, 'gsap-ease')] })
      time('stagger', 'stagger', 's')
      const each = e.props.find((p) => p.key === 'stagger')?.child?.props.find((p) => p.key === 'each')?.lit
      if (each?.kind === 'num') values.push(timeRaw('stagger', each.num! * 1000, site(each, 's')))
    } else if (WAAPI_CALL.test(callee) && e.argOf && e.argOf.args >= 1) {
      title = 'Web animation'
      context = join(component, `${callee.replace(/^\./, '')}()`)
      time('duration', 'duration', 'ms')
      time('delay', 'delay', 'ms')
      const ease = lit('easing')
      const b = ease?.kind === 'str' ? cssEase(ease.str!) : null
      if (ease && b) {
        claimed.add(base + ease.start)
        values.push({ prop: 'ease', kind: 'ease', value: b, sites: [site(ease, 'css-ease-js')] })
      }
    } else if (transitionish) {
      const unit = 's'
      time('duration', 'duration', unit)
      time('delay', 'delay', unit)
      time('staggerChildren', 'stagger', unit)
      time('delayChildren', 'delayChildren', unit)
      const ease = lit('ease')
      if (ease?.kind === 'arr') values.push({ prop: 'ease', kind: 'ease', value: ease.arr!, sites: [site(ease, 'ease-array')] })
      else if (ease?.kind === 'str' && Object.hasOwn(MOTION_EASES, ease.str!)) {
        values.push({ prop: 'ease', kind: 'ease', value: MOTION_EASES[ease.str!], sites: [site(ease, 'ease-name')] })
      }
      springParts({ stiffness: 'stiffness', damping: 'damping', mass: 'mass' })
      const bounce = num('bounce')
      if (bounce) values.push({ prop: 'bounce', kind: 'number', value: bounce.num!, sites: [site(bounce, 'num')] })

      // Name it for a person: what it animates, which state, which variant.
      const kind = values.some((v) => v.kind === 'spring') || lit('type')?.str === 'spring' ? 'spring' : 'transition'
      const key = e.ownerKey
      const parent = e.parent?.type === tt.braceL ? e.parent : undefined
      if (key === 'transition' && parent) {
        // `{ …, transition: {…} }` inside a variant or a state prop (`whileHover={{ … }}`)
        const state = parent.attr && STATE_PROPS[parent.attr]
        const variant = !parent.attr ? parent.ownerKey : undefined
        title = state ? `${state} ${kind}` : variant ? `“${variant}” variant` : cap(kind)
        context = join(component, tag(parent.element), variant && parent.parent?.ownerKey)
      } else if (key && /transition$/i.test(key)) {
        // `transition = {…}`, `tooltipTransition = {…}` (defaults or variables)
        title = cap(words(key).replace(/transition$/, kind))
      } else if (key && parent) {
        // per-property: `transition={{ y: { type: "spring", … } }}`, or a named entry in a config object
        const inTransition = parent.ownerKey === 'transition' || parent.attr === 'transition'
        title = `${propWords(key)} ${kind}`
        context = join(component, tag(parent.element), !inTransition && parent.ownerKey !== component && parent.ownerKey)
      } else if (e.attr === 'transition' || e.element) {
        title = cap(kind)
        context = join(component, tag(e.element))
      } else if (callee) {
        title = `${callee}() ${kind}`
      } else title = cap(kind)
    }
    if (values.length) out.push({ title: title || 'Motion', context, file, at, live: e.live, values })
    return out
  }

  return { groups, claimed, tokens, componentAt }
}

/** Template strings (CSS-in-JS, <style>{`…`}</style>) and class strings in TSX. */
function scanJsStrings(src: string, scan: NonNullable<ReturnType<typeof scanJs>>, file: string): RawGroup[] {
  const { tokens, claimed, componentAt } = scan
  const out: RawGroup[] = []
  const elementFor = (i: number) => {
    // `className="…"` → the element whose tag this attribute is on.
    if (tokens[i - 1]?.type !== tt.eq || tokens[i - 2]?.type !== tt.jsxName) return undefined
    for (let k = i - 2; k >= 0; k--) {
      if (tokens[k].type === tt.jsxTagStart) {
        let n = ''
        for (let j = k + 1; tokens[j] && (tokens[j].type === tt.jsxName || tokens[j].type === tt.dot); j++) {
          if (tokens[j].type === tt.jsxName && n && !n.endsWith('.')) break
          n += src.slice(tokens[j].start, tokens[j].end)
        }
        return n
      }
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const comp = componentAt(t.start)
    if (t.type === tt.template) {
      const body = src.slice(t.start, t.end)
      const css = scanCss(body, t.start, file, comp)
      if (css.length) out.push(...css)
      else {
        const tw = scanTailwind(body, t.start, file, comp)
        if (tw) out.push(tw)
      }
    } else if (t.type === tt.string && !claimed.has(t.start)) {
      const body = src.slice(t.start + 1, t.end - 1)
      if (CSS_DECL.test(body)) {
        CSS_DECL.lastIndex = 0
        out.push(...scanCss(body, t.start + 1, file, comp))
        continue
      }
      CSS_DECL.lastIndex = 0
      const el = elementFor(i)
      const tw = scanTailwind(body, t.start + 1, file, join(comp, tag(el)))
      if (tw) out.push(tw)
    }
  }
  return out
}

function scanFile(src: string, file: string, kind: 'tsx' | 'html', fallback: string): RawGroup[] {
  if (kind === 'html') {
    const groups = scanCss(src, 0, file, fallback)
    for (const m of src.matchAll(/\bclass\s*=\s*(["'])([^"']*)\1/g)) {
      const tw = scanTailwind(m[2], m.index! + m[0].length - m[2].length - 1, file, fallback)
      if (tw) groups.push(tw)
    }
    for (const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      const at = m.index! + m[0].indexOf('>') + 1
      const js = scanJs(m[1], at, file, fallback)
      if (js) groups.push(...js.groups)
    }
    return groups
  }
  const js = scanJs(src, 0, file, fallback)
  if (!js) return []
  // scanJs offsets are relative to `src` already (base 0).
  return [...js.groups, ...scanJsStrings(src, js, file)]
}

// ── public API ──────────────────────────────────────────

const LABEL: Record<Raw['prop'], string> = {
  duration: 'duration',
  delay: 'delay',
  stagger: 'stagger',
  delayChildren: 'delay children',
  ease: 'ease',
  spring: 'spring',
  bounce: 'bounce',
}

function range(r: Raw): { min?: number; max?: number; unit: string } {
  if (r.kind !== 'number') return { unit: '' }
  const v = r.value as number
  if (r.prop === 'bounce') return { unit: '', min: 0, max: 1 }
  if (r.prop === 'stagger') return { unit: 'ms', min: 0, max: Math.max(300, nice(v * 4)) }
  return { unit: 'ms', min: 0, max: Math.max(1000, nice(v * 3)) }
}

const cache = new Map<string, Detection>()

/**
 * Detect motion values in a frame's source and its modules. Memoized by content,
 * so the canvas and the inspector share one run per source change.
 */
export function detectMotion(
  source: string,
  modules: Record<string, string> = {},
  kind: 'tsx' | 'html' = 'tsx',
  mainName = 'frame.tsx',
): Detection {
  const key = `${kind}\0${mainName}\0${source}\0${JSON.stringify(modules)}`
  const hit = cache.get(key)
  if (hit) return hit

  const files: [string, string, 'tsx' | 'html'][] = [['', source, kind], ...Object.entries(modules).map(([k, v]) => [k, v, 'tsx'] as [string, string, 'tsx'])]
  const params: DetectedParam[] = []
  const groups: DetectedGroup[] = []
  const used = new Set<string>()
  for (const [file, src, k] of files) {
    const fallback = file ? (file.split('/').pop() ?? file) : mainName.replace(/\.\w+$/, '')
    const raws = scanFile(src, file, k, fallback).sort((a, b) => a.at - b.at)
    for (const g of raws) {
      const where = fileLabel(file, mainName)
      const line = lineAt(src, g.at)
      const label = join(g.title, g.context)
      const stem = slug(`${file ? fallback : ''} ${g.context} ${g.title}`) || 'motion'
      let id = stem
      for (let n = 2; used.has(id); n++) id = `${stem}-${n}`
      used.add(id)
      const seen = new Set<string>()
      const gp: DetectedParam[] = []
      for (const r of g.values) {
        // Two durations in one CSS item (e.g. the second animation) get their own names.
        let label = LABEL[r.prop]
        for (let n = 2; seen.has(label); n++) label = `${LABEL[r.prop]} ${n}`
        seen.add(label)
        const name = `${id}-${slug(label)}`
        const first = r.sites[0]
        gp.push({
          name,
          label,
          kind: r.kind,
          value: r.value,
          ...range(r),
          start: first.start,
          end: first.end,
          group: id,
          file,
          line: lineAt(src, first.start),
          sites: r.sites,
          live: g.live,
        })
      }
      params.push(...gp)
      groups.push({ id, title: g.title, context: g.context, label, file: where, line, params: gp })
    }
  }
  const out = { params, groups }
  cache.set(key, out)
  if (cache.size > 60) cache.delete(cache.keys().next().value!)
  return out
}

/** Files of a detection, keyed like sites: '' = main source. */
export type Sources = { main: string; modules: Record<string, string> }

function rewrite(text: string, edits: { start: number; end: number; text: string }[]) {
  let out = text
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

function byFile(sources: Sources, edits: { file: string; start: number; end: number; text: string }[]): Sources {
  const grouped = new Map<string, typeof edits>()
  for (const e of edits) grouped.set(e.file, [...(grouped.get(e.file) ?? []), e])
  const modules = { ...sources.modules }
  let main = sources.main
  for (const [file, list] of grouped) {
    if (file) modules[file] = rewrite(modules[file] ?? '', list)
    else main = rewrite(main, list)
  }
  return { main, modules }
}

const cssTimeText = (ms: number) => `${round(ms, 2)}ms`
const bezierText = (b: Bezier, sep = ', ') => `cubic-bezier(${b.map((n) => round(n)).join(sep)})`

/**
 * A copy of the code where every detected value reads its live value: JS values
 * go through `__mbP(name, original, fmt)`, CSS and Tailwind values through
 * `var(--p-name, original)`. The stored source is never touched.
 */
export function previewSources(d: Detection, sources: Sources): Sources {
  const edits = d.params.flatMap((p) =>
    p.sites.map((s) => {
      const original = (s.file ? sources.modules[s.file] : sources.main)?.slice(s.start, s.end) ?? ''
      let text = original
      if (isJsSite(s)) {
        text = `globalThis.__mbP(${JSON.stringify(p.name)}, ${original}, ${JSON.stringify(s.fmt)}${s.part ? `, ${JSON.stringify(s.part)}` : ''})`
      } else if (s.fmt === 'css-time' || s.fmt === 'css-ease') {
        text = `var(--p-${p.name}, ${original})`
      } else if (s.fmt === 'tw-duration' || s.fmt === 'tw-delay') {
        text = `${s.prefix ?? ''}${s.fmt === 'tw-duration' ? 'duration' : 'delay'}-[var(--p-${p.name},${cssTimeText(p.value as number)})]`
      } else if (s.fmt === 'tw-ease') {
        text = `${s.prefix ?? ''}ease-[var(--p-${p.name},${bezierText(p.value as Bezier, ',')})]`
      }
      return { file: s.file, start: s.start, end: s.end, text }
    }),
  )
  return byFile(sources, edits)
}

/** Text for a value written back in the site's own format and units. */
function formatSite(s: Site, v: ParamValue): string {
  switch (s.fmt) {
    case 's':
      return String(round((v as number) / 1000))
    case 'ms':
      return String(Math.round(v as number))
    case 'num':
      return String(round(v as number))
    case 'spring':
      return String(round((v as Spring)[s.part!] ?? 0, 2))
    case 'ease-array':
      return `[${(v as Bezier).map((n) => round(n)).join(', ')}]`
    case 'ease-name': {
      const n = nameFor(MOTION_EASES, v as Bezier)
      return n ? `${s.quote}${n}${s.quote}` : `[${(v as Bezier).map((n) => round(n)).join(', ')}]`
    }
    case 'gsap-ease': {
      let best = 'none'
      let dist = bezierDist([0, 0, 1, 1], v as Bezier)
      for (const [fam, dirs] of Object.entries(GSAP_FAMILIES))
        for (const [dir, b] of Object.entries(dirs)) {
          const d = bezierDist(b, v as Bezier)
          if (d < dist) {
            dist = d
            best = `${fam}.${dir}`
          }
        }
      return `${s.quote}${best}${s.quote}`
    }
    case 'css-ease-js': {
      const n = nameFor(CSS_EASES, v as Bezier)
      return `${s.quote}${n ?? bezierText(v as Bezier)}${s.quote}`
    }
    case 'css-time':
      return s.unit === 's' ? `${round((v as number) / 1000)}s` : `${Math.round(v as number)}ms`
    case 'css-ease':
      return nameFor(CSS_EASES, v as Bezier) ?? bezierText(v as Bezier)
    case 'tw-duration':
    case 'tw-delay': {
      const ms = Math.round(v as number)
      const base = s.fmt === 'tw-duration' ? 'duration' : 'delay'
      return `${s.prefix ?? ''}${base}-${TW_STEPS.includes(ms) ? ms : `[${ms}ms]`}`
    }
    case 'tw-ease': {
      const n = nameFor(TW_EASES, v as Bezier)
      return `${s.prefix ?? ''}ease-${n ?? `[${bezierText(v as Bezier, ',')}]`}`
    }
  }
}

/** Write tuned values back into the original literals (⌘S). Untouched params keep their text exactly. */
export function writeBack(d: Detection, sources: Sources, values: Record<string, ParamValue>): Sources {
  const edits = d.params.flatMap((p) =>
    p.name in values ? p.sites.map((s) => ({ file: s.file, start: s.start, end: s.end, text: formatSite(s, values[p.name]) })) : [],
  )
  return byFile(sources, edits)
}

/** Human description for export/docs, e.g. "420ms", "cubic-bezier(…)". */
export function describeValue(p: DetectedParam, v: ParamValue = p.value): string {
  if (p.kind === 'ease') return bezierText(v as Bezier)
  if (p.kind === 'spring') {
    const s = v as Spring
    return `stiffness=${round(s.stiffness, 1)} damping=${round(s.damping, 1)}${s.mass !== undefined ? ` mass=${round(s.mass, 2)}` : ''}`
  }
  return p.unit === 'ms' ? `${round(v as number, 1)}ms` : String(round(v as number))
}
