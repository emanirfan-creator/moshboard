// Motion measured inside a running code frame (see the probe in src/frames/sandbox.ts):
// CSS transitions/animations read from computed styles and Web Animations as they're
// created. This works for any library that ends up as CSS or WAAPI (Chakra, MUI,
// Tailwind, plain CSS…), including values that come from a theme rather than a literal.
// Values found in the code itself are left to detect-motion; these only fill the gaps.

import type { DetectedGroup, DetectedParam } from './detect-motion.ts'
import { NAMED_EASES } from './ease.ts'
import type { Bezier, ParamValue } from './params.ts'
import type { RuntimeTune } from './types.ts'

export interface RuntimeItem {
  /** kind|selector|index (CSS) or waapi|selector|properties */
  key: string
  kind: 'transition' | 'animation' | 'waapi'
  selector: string
  /** short element description: <button.chakra-button> */
  desc: string
  /** transitioned properties, animation name, or animated properties */
  props: string
  duration: number
  delay: number
  easing: string
  /** elements sharing this exact selector */
  count: number
}

type Field = 'duration' | 'delay' | 'ease'
const PREFIX = 'rt:'
const MAX_GROUPS = 12

/** Override key for one measured value: rt:<field>:<item key>. */
export const runtimeName = (field: Field, key: string) => `${PREFIX}${field}:${key}`
export const isRuntimeName = (name: string) => name.startsWith(PREFIX)
export function parseRuntimeName(name: string): { field: Field; key: string } | null {
  const m = /^rt:(duration|delay|ease):([\s\S]+)$/.exec(name)
  return m ? { field: m[1] as Field, key: m[2] } : null
}

const BEZIER_RE = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/
/** CSS easing → bezier, or null for steps()/linear() (springs), which get no curve control. */
export function easingBezier(text: string): Bezier | null {
  const t = text.trim()
  if (t in NAMED_EASES) return NAMED_EASES[t]
  const m = BEZIER_RE.exec(t)
  return m ? [+m[1], +m[2], +m[3], +m[4]] : null
}
const bezierCss = (b: Bezier) => `cubic-bezier(${b.join(', ')})`

// ── names a designer reads: "Button transition", "color, shadow, movement" ──

const KIND = { transition: 'transition', animation: 'animation', waapi: 'animation' }

const TAGS: Record<string, string> = {
  button: 'Button', a: 'Link', input: 'Field', textarea: 'Field', select: 'Dropdown', img: 'Image', svg: 'Icon',
  path: 'Icon', li: 'List item', ul: 'List', ol: 'List', nav: 'Navigation', header: 'Header', footer: 'Footer',
  dialog: 'Dialog', label: 'Label', p: 'Text', h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading',
  h5: 'Heading', h6: 'Heading', section: 'Section', aside: 'Sidebar', form: 'Form', table: 'Table', video: 'Video',
}

/** "<button.chakra-button>" → "Button", "<div.MuiCard-root>" → "Card", "<div>" → "Element" */
export function elementName(desc: string): string {
  const m = /^<(\w+)(?:\.([^>]+))?>$/.exec(desc)
  if (!m) return 'Element'
  const [, tag, cls] = m
  const hint = cls
    ?.replace(/^(chakra|mantine|mui|ant|radix|headlessui|el|v|q|p|n)-/i, '')
    .replace(/^Mui/, '')
    .replace(/-(root|base|wrapper|container|inner)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
  const pretty = hint && hint.length > 1 && hint.length < 24 ? hint[0].toUpperCase() + hint.slice(1).toLowerCase() : ''
  if (TAGS[tag] && !(pretty && ['div', 'span', 'li', 'section'].includes(tag))) return TAGS[tag]
  return pretty || TAGS[tag] || 'Element'
}

const PROPS: [RegExp, string][] = [
  [/^(color|background(-color)?|background-image|border(-\w+)?-color|fill|stroke|outline-color|text-decoration-color|caret-color|accent-color)$/, 'color'],
  [/^opacity$/, 'fade'],
  [/shadow/, 'shadow'],
  [/^(transform|translate|rotate|top|left|right|bottom|inset)$/, 'movement'],
  [/^scale$/, 'scale'],
  [/^(width|height|max-\w+|min-\w+|flex-basis|padding.*|margin.*|gap|grid-template-\w+)$/, 'size'],
  [/radius/, 'corners'],
  [/filter/, 'blur'],
  [/^(border(-\w+)?-width|outline(-width)?)$/, 'border'],
]

/** What changes, in plain words: "color, shadow, movement". */
export function changeNames(props: string): string {
  if (props === 'all') return 'any property'
  const out: string[] = []
  for (const p of props.split(/,\s*/)) {
    const hit = PROPS.find(([re]) => re.test(p))?.[1] ?? p.replace(/-/g, ' ')
    if (!out.includes(hit)) out.push(hit)
  }
  return out.length > 3 ? `${out.slice(0, 3).join(', ')} and more` : out.join(', ')
}

const titleFor = (it: RuntimeItem) => `${elementName(it.desc)} ${KIND[it.kind]}${it.count > 1 ? ` ×${it.count}` : ''}`

/**
 * Inspector groups for measured motion the code scan didn't already cover. `known` holds
 * the ms values the code's own params and detected literals produce, so a Tailwind
 * `duration-300` that detect-motion found doesn't show up twice.
 */
export function runtimeGroups(
  items: RuntimeItem[] | undefined,
  known: Set<number>,
  saved: Record<string, RuntimeTune> = {},
): DetectedGroup[] {
  if (!items?.length) return []
  const fresh = items.filter((it) => it.duration > 0 && (saved[it.key] || !known.has(Math.round(it.duration))))
  return fresh
    .sort((a, b) => b.count - a.count || b.duration - a.duration)
    .slice(0, MAX_GROUPS)
    .map((it) => {
      const s = saved[it.key] ?? {}
      const param = (field: Field, p: Omit<DetectedParam, 'name' | 'group' | 'file' | 'line' | 'sites' | 'live' | 'start' | 'end'>): DetectedParam => ({
        ...p,
        name: runtimeName(field, it.key),
        group: it.key,
        file: '',
        line: 0,
        sites: [],
        live: true,
        start: 0,
        end: 0,
      })
      const dur = s.duration ?? it.duration
      const params: DetectedParam[] = [
        param('duration', { label: 'duration', kind: 'number', unit: 'ms', value: Math.round(dur), min: 0, max: Math.max(1000, Math.ceil((dur * 3) / 100) * 100) }),
        param('delay', { label: 'delay', kind: 'number', unit: 'ms', value: Math.round(s.delay ?? it.delay), min: 0, max: 1000 }),
      ]
      const bez = s.ease ?? easingBezier(it.easing)
      if (bez) params.push(param('ease', { label: 'easing', kind: 'ease', unit: '', value: bez }))
      const title = titleFor(it)
      // The animation name is the designer's own word for a CSS animation; otherwise say what changes.
      const context = it.kind === 'animation' ? `“${it.props}”` : `Changes ${changeNames(it.props)}`
      return { id: it.key, title, context, label: `${title} · ${context}`, file: 'From the live preview', line: 0, params }
    })
}

/** What to apply inside the frame: saved tuning, then unsaved overrides on top. */
export function runtimeTune(
  saved: Record<string, RuntimeTune> = {},
  overrides: Record<string, ParamValue> = {},
): Record<string, { duration?: number; delay?: number; ease?: string }> {
  const out: Record<string, { duration?: number; delay?: number; ease?: string }> = {}
  for (const [key, t] of Object.entries(saved)) {
    out[key] = { duration: t.duration, delay: t.delay, ease: t.ease && bezierCss(t.ease) }
  }
  for (const [name, v] of Object.entries(overrides)) {
    const r = parseRuntimeName(name)
    if (!r) continue
    const t = (out[r.key] ??= {})
    if (r.field === 'ease') t.ease = bezierCss(v as Bezier)
    else t[r.field] = v as number
  }
  return out
}

/** Fold unsaved runtime overrides into a frame's saved tuning (⌘S). */
export function saveRuntime(
  saved: Record<string, RuntimeTune> = {},
  overrides: Record<string, ParamValue>,
  items: RuntimeItem[] = [],
): Record<string, RuntimeTune> {
  const out = { ...saved }
  for (const [name, v] of Object.entries(overrides)) {
    const r = parseRuntimeName(name)
    if (!r) continue
    const it = items.find((i) => i.key === r.key)
    const label = out[r.key]?.label ?? (it ? `${titleFor(it)} (${changeNames(it.props)})` : r.key)
    out[r.key] = { ...out[r.key], label, [r.field]: v }
  }
  return out
}
