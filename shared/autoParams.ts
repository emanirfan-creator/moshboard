// Give pasted components live controls. Literal values that look tunable
// (colors, easing curves, springs, timing/size numbers) become `@param`
// annotations, and the literal in the code is swapped for a live read:
//
//   config={{ atmosphereColor: "#4da6ff", autoRotateSpeed: 0.3 }}
//   →  /* @param atmosphereColor #4da6ff */
//      /* @param autoRotateSpeed 0.3 0..0.9 */
//      config={{ atmosphereColor: getParams().atmosphereColor, autoRotateSpeed: getParams().autoRotateSpeed }}
//
// Only values inside a function body or JSX are picked: module-level constants
// are evaluated once, so a control on them would do nothing (and they're usually data).
// The frame re-renders on every param change, so `getParams()` reads stay live.

import { parse } from 'sucrase/dist/parser/index.js'
import { TokenType as tt } from 'sucrase/dist/parser/tokenizer/types.js'

const MAX = 8

const COLOR = /^(#[0-9a-f]{3,8}|(?:rgba?|hsla?|oklch|oklab)\([^)]*\))$/i
const BEZIER = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/
// Names worth a slider, in priority order.
const TIMING = /duration|delay|stagger|speed|interval/i
const TUNABLE =
  /intensity|scale|opacity|blur|radius|bounce|velocity|amplitude|frequency|strength|amount|rotat|distance|offset|spacing|gap|size|angle|zoom|density|glow|spread|thickness|depth|tilt|parallax|power|damping|stiffness|mass|friction|tension|decay|threshold|sensitivity/i
const SKIP = /^(lat|lng|lon|id|index|key|zindex|tabindex|width|height|x|y|z)$/i

interface Token {
  type: number
  start: number
  end: number
}

interface Candidate {
  name: string
  kind: 'number' | 'color' | 'ease' | 'spring'
  /** annotation text after the name */
  value: string
  /** source edits: [start, end, replacement-builder] */
  edits: { start: number; end: number; expr: (ref: string) => string }[]
  priority: number
  at: number
  /** JSX attribute the value sits in (`animate`, `initial`…), to tell same-named values apart */
  context?: string
}

const unquote = (s: string) => s.slice(1, -1)
const nice = (n: number) => +n.toPrecision(2)

function numberRange(name: string, v: number) {
  if (/opacity/i.test(name) && v >= 0 && v <= 1) return '0..1'
  if (v === 0) return TIMING.test(name) ? '0..1' : '-1..1'
  if (v < 0) return `${nice(v * 3)}..0`
  const max = nice(v * 3)
  return `0..${Number.isInteger(v) && v >= 10 ? Math.round(max) : max}`
}

/** Has `@param` annotations already, or reads params itself. */
export const isTunable = (source: string) => /@param\s/.test(source) || /from\s*['"]moodboard['"]/.test(source)

/**
 * Returns the source with params added, or null when nothing tunable was found
 * (or the code can't be tokenized, or it's tuned already).
 */
export function autoParams(source: string): { source: string; names: string[] } | null {
  if (isTunable(source)) return null
  let tokens: Token[]
  try {
    tokens = parse(source, true, true, false).tokens as Token[]
  } catch {
    return null
  }
  const text = (t: Token) => source.slice(t.start, t.end)

  // Which brackets are function bodies (or arrow-expression bodies).
  const stack: { fn: boolean; open: number; attr?: string }[] = []
  const inFn = () => stack.some((s) => s.fn)
  // For each object literal (by its opening token index): its key → candidate, to group springs.
  const found: Candidate[] = []
  const springParts = new Map<number, Map<string, { tok: Token; value: number }>>()

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const prev = tokens[i - 1]
    if (t.type === tt.braceL || t.type === tt.parenL || t.type === tt.bracketL || t.type === tt.dollarBraceL) {
      // A function body, or a JSX expression (JSX only runs during render).
      const fn =
        !!prev &&
        (prev.type === tt.arrow ||
          (t.type === tt.braceL &&
            (prev.type === tt.parenR ||
              prev.type === tt.jsxTagEnd ||
              prev.type === tt.jsxText ||
              (prev.type === tt.eq && tokens[i - 2]?.type === tt.jsxName))))
      const attr = prev?.type === tt.eq && tokens[i - 2]?.type === tt.jsxName ? text(tokens[i - 2]) : undefined
      stack.push({ fn, open: i, attr })
      continue
    }
    if (t.type === tt.braceR || t.type === tt.parenR || t.type === tt.bracketR) {
      stack.pop()
      continue
    }
    if (!inFn() && t.type !== tt.jsxName) continue
    const context = [...stack].reverse().find((e) => e.attr && e.attr !== 'style')?.attr
    const push = (c: Candidate) => found.push({ ...c, context })

    // `key: literal` in an object, or `name="…"` / `name={literal}` on a JSX element.
    const isKey =
      (t.type === tt.name || t.type === tt.string) &&
      tokens[i + 1]?.type === tt.colon &&
      (prev?.type === tt.braceL || prev?.type === tt.comma)
    const isAttr = t.type === tt.jsxName && tokens[i + 1]?.type === tt.eq
    if (!isKey && !isAttr) continue

    const name = t.type === tt.string ? unquote(text(t)) : text(t)
    if (!/^[A-Za-z_][\w-]*$/.test(name) || SKIP.test(name)) continue

    // Locate the value: for attributes it's a string, or `{ literal }`.
    let j = i + 2
    let wrapped = false
    if (isAttr && tokens[j]?.type === tt.braceL) {
      wrapped = true
      j++
    }
    let neg = false
    if (tokens[j]?.type === tt.minus && tokens[j + 1]?.type === tt.num) {
      neg = true
      j++
    }
    const v = tokens[j]
    if (!v) continue
    const after = tokens[j + 1]
    const closes = wrapped
      ? after?.type === tt.braceR
      : isAttr || after?.type === tt.comma || after?.type === tt.braceR
    const start = neg ? tokens[j - 1].start : v.start

    // An ease given as a 4-number array: `ease: [0.16, 1, 0.3, 1]`.
    if (v.type === tt.bracketL && /^ease$|easing|timingFunction/i.test(name)) {
      const nums = tokens.slice(j + 1, j + 8)
      const pattern = [tt.num, tt.comma, tt.num, tt.comma, tt.num, tt.comma, tt.num]
      if (nums.every((n, k) => n.type === pattern[k]) && tokens[j + 8]?.type === tt.bracketR) {
        const b = [0, 2, 4, 6].map((k) => text(nums[k]))
        const end = tokens[j + 8].end
        push({
          name,
          kind: 'ease',
          value: `cubic-bezier(${b.join(', ')})`,
          edits: [{ start: v.start, end, expr: (r) => r }],
          priority: 0,
          at: t.start,
        })
      }
      continue
    }
    if (!closes) continue

    const replace = (expr: (r: string) => string) => [
      { start, end: v.end, expr: isAttr && !wrapped ? (r: string) => `{${expr(r)}}` : expr },
    ]

    if (v.type === tt.string) {
      const s = unquote(text(v)).trim()
      if (COLOR.test(s)) {
        push({ name, kind: 'color', value: s, edits: replace((r) => r), priority: 2, at: t.start })
      } else if (BEZIER.test(s)) {
        push({
          name,
          kind: 'ease',
          value: s.replace(/\s+/g, ' '),
          edits: replace((r) => `\`cubic-bezier(\${${r}.join(", ")})\``),
          priority: 0,
          at: t.start,
        })
      }
      continue
    }
    if (v.type !== tt.num) continue
    const n = (neg ? -1 : 1) * Number(text(v).replace(/_/g, ''))
    if (!Number.isFinite(n)) continue

    // Springs: collect stiffness/damping/mass siblings, decide after the loop.
    if (isKey && /^(stiffness|damping|mass)$/.test(name)) {
      const obj = stack[stack.length - 1]?.open ?? -1
      if (!springParts.has(obj)) springParts.set(obj, new Map())
      springParts.get(obj)!.set(name, { tok: { ...v, start }, value: n })
      continue
    }
    const pri = TIMING.test(name) ? 1 : TUNABLE.test(name) ? 3 : -1
    if (pri < 0) continue
    push({
      name,
      kind: 'number',
      value: `${n} ${numberRange(name, n)}`,
      edits: replace((r) => r),
      priority: pri,
      at: t.start,
    })
  }

  for (const parts of springParts.values()) {
    const s = parts.get('stiffness')
    const d = parts.get('damping')
    if (s && d) {
      const m = parts.get('mass')
      found.push({
        name: 'spring',
        kind: 'spring',
        value: `stiffness=${s.value} damping=${d.value}${m ? ` mass=${m.value}` : ''}`,
        edits: [...parts].map(([k, p]) => ({ start: p.tok.start, end: p.tok.end, expr: (r: string) => `${r}.${k}` })),
        priority: 0,
        at: s.tok.start,
      })
    } else {
      // A lone damping/stiffness is still a useful number.
      for (const [k, p] of parts)
        found.push({
          name: k,
          kind: 'number',
          value: `${p.value} ${numberRange(k, p.value)}`,
          edits: [{ start: p.tok.start, end: p.tok.end, expr: (r) => r }],
          priority: 3,
          at: p.tok.start,
        })
    }
  }
  if (!found.length) return null

  // Keep the most useful few, then present them in source order with unique names.
  const picked = [...found]
    .sort((a, b) => a.priority - b.priority || a.at - b.at)
    .slice(0, MAX)
    .sort((a, b) => a.at - b.at)
  // Same name in different props (`initial={{ scale }}` / `animate={{ scale }}`): prefix the prop.
  const cap = (n: string) => n[0].toUpperCase() + n.slice(1)
  const dupes = picked.filter((c) => c.context && picked.some((o) => o !== c && o.name === c.name))
  for (const c of dupes) c.name = `${c.context}${cap(c.name)}`
  const used = new Set<string>()
  for (const c of picked) {
    let n = c.name
    for (let k = 2; used.has(n); k++) n = `${c.name}${k}`
    used.add(n)
    c.name = n
  }

  const edits = picked
    .flatMap((c) => {
      const ref = /^[A-Za-z_]\w*$/.test(c.name) ? `getParams().${c.name}` : `getParams()[${JSON.stringify(c.name)}]`
      return c.edits.map((e) => ({ ...e, ref }))
    })
    .sort((a, b) => b.start - a.start)
  let body = source
  for (const e of edits) body = body.slice(0, e.start) + e.expr(e.ref) + body.slice(e.end)

  const header = picked.map((c) => `/* @param ${c.name} ${c.value} */`).join('\n')
  const directive = /^\s*(['"])use client\1;?[ \t]*\n?/.exec(body)
  const rest = directive ? body.slice(directive[0].length) : body
  return {
    source: `${directive ? directive[0].trimEnd() + '\n' : ''}${header}\nimport { getParams } from "moodboard";\n${rest}`,
    names: picked.map((c) => c.name),
  }
}
