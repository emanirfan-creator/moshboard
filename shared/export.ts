// The spec export (design.md, motion.md, interactions.md, tokens, snippets, presets) as pure
// logic: it reads the board's files through `ExportFiles` and returns what to write. The local
// server writes it to disk (server/export.ts); the website writes it into the user's folder
// (src/folder/export.ts).
import { contrast, inkFor, nameColor, paletteShares } from './color.ts'
import { describeValue, detectMotion } from './detect-motion.ts'
import { NAMED_EASES } from './ease.ts'
import { fontStack, styleName, SWATCH_SIZE } from './fonts.ts'
import {
  annotation,
  cssVars,
  defaults,
  formatParam,
  parseParams,
  runtimeValues,
  type Bezier,
  type Param,
  type Spring,
} from './params.ts'
import type { Board, Frame, MotionCapture, MotionKind, Move, SoundReading, VideoAnalysis } from './types.ts'
import { soundFacts } from './sound.ts'
import { isSection, sectionOf, withContents } from './sections.ts'
import { normalizeLinks, refsOf } from './frame-links.ts'
import { POST_SITE } from './posts.ts'

/** The board's files, as the export reads them (paths relative to the board folder). */
export interface ExportFiles {
  exists(rel: string): boolean
  /** Text content, or null when the file isn't there. */
  text(rel: string): string | null
}

/** One file of the spec: written as text, or copied from a board file (a reference image). */
export type ExportOutput = { text: string } | { from: string }

export interface BuiltExport {
  /** Paths inside the export folder → what goes there. */
  outputs: Map<string, ExportOutput>
  files: string[]
  warnings: string[]
  scope: { frames: number; total: number }
}

const basename = (rel: string) => rel.split('/').pop() ?? rel
const extname = (rel: string) => /\.[^./]+$/.exec(rel)?.[0] ?? ''

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'frame'

const sameBezier = (a: Bezier, b: Bezier) => a.every((n, i) => Math.abs(n - b[i]) < 0.015)

interface Token {
  name: string
  value: string
  uses: string[]
}

type TimingKind = 'duration' | 'delay' | 'stagger'
const timingKind = (param: string): TimingKind => (/stagger/i.test(param) ? 'stagger' : /delay/i.test(param) ? 'delay' : 'duration')
/** One animation's token names, for motion.md's enter/exit patterns. */
type Step = Partial<Record<TimingKind | 'ease' | 'spring', string>>

/**
 * Export the whole canvas, or only `ids` plus what they're linked to (a copy's
 * reference, notes attached to them), so a partial spec still has its context.
 */
export function buildExport(full: Board, files: ExportFiles, ids?: string[]): BuiltExport {
  // Older boards (and tools) write one `link` per block: read it as numbered links.
  full = { ...full, frames: normalizeLinks(full.frames) }
  let board = full
  if (ids?.length) {
    // A selected section brings everything in it.
    const keep = new Set(withContents(ids, full.frames))
    for (const f of full.frames) if (keep.has(f.id)) for (const r of refsOf(f)) keep.add(r)
    for (const f of full.frames) if (refsOf(f).some((r) => keep.has(r))) keep.add(f.id)
    board = { ...full, frames: full.frames.filter((f) => keep.has(f.id)) }
  }
  const outputs = new Map<string, ExportOutput>()

  const byId = new Map(board.frames.map((f) => [f.id, f]))
  const name = (f: Frame) => f.label || `${f.type} ${f.id}`
  const written: string[] = []
  const warnings: string[] = []
  const write = (rel: string, text: string) => {
    if (!outputs.has(rel)) written.push(rel)
    outputs.set(rel, { text })
  }
  const copyRef = (rel: string) => {
    if (!files.exists(rel)) return null
    const dest = `references/${basename(rel)}`
    if (!outputs.has(dest)) written.push(dest)
    outputs.set(dest, { from: rel })
    return dest
  }
  const readJson = <T>(rel?: string): T | null => {
    const text = rel ? files.text(rel) : null
    return text === null ? null : JSON.parse(text)
  }

  // ── tokens ──────────────────────────────────────────────
  // Motion tokens follow the Design Harness motion format: duration, delay, easing, spring, stagger.
  const easings = new Map<string, Token>()
  const timings: Record<TimingKind, Map<string, Token>> = { duration: new Map(), delay: new Map(), stagger: new Map() }
  const springs = new Map<string, Token & { spring: Spring }>()
  const colors = new Map<string, Token>()

  // Token names stay unique: a second curve from the same frame becomes `ease-<frame>-2`.
  const names = new Set<string>()
  const unique = (base: string) => {
    let n = base
    for (let k = 2; names.has(n); k++) n = `${base}-${k}`
    names.add(n)
    return n
  }
  const addEase = (b: Bezier, use: string) => {
    const value = `cubic-bezier(${b.join(', ')})`
    const named = Object.entries(NAMED_EASES).find(([, nb]) => sameBezier(b, nb))?.[0]
    const t = easings.get(value) ?? { name: unique(named ? (named.startsWith('ease') ? named : `ease-${named}`) : `ease-${slug(use.split(' · ')[0])}`), value, uses: [] }
    t.uses.push(use)
    easings.set(value, t)
    return t.name
  }
  const addMs = (kind: TimingKind, ms: number, use: string) => {
    const n = Math.round(ms)
    const t = timings[kind].get(`${n}ms`) ?? { name: `${kind}-${n}`, value: `${n}ms`, uses: [] }
    t.uses.push(use)
    timings[kind].set(t.value, t)
    return t.name
  }
  const addSpring = (sp: Spring, value: string, use: string) => {
    const key = `${sp.stiffness}/${sp.damping}/${sp.mass ?? 1}`
    const t = springs.get(key) ?? { name: unique(`spring-${Math.round(sp.stiffness)}-${Math.round(sp.damping)}`), value, uses: [], spring: sp }
    t.uses.push(use)
    springs.set(key, t)
    return t.name
  }

  // ── motion sections ─────────────────────────────────────
  const motion: string[] = []
  // Enter/exit patterns for motion.md: per animation, its trigger and token names.
  const patterns: { key: string; lines: string[] }[] = []
  // One transition per animation, for presets/motion.ts and presets/gsap.ts.
  const presets: Preset[] = []
  const codeFrames = board.frames.filter((f) => f.type === 'code' && f.file)
  for (const f of codeFrames) {
    const source = files.text(f.file!)
    if (source === null) {
      warnings.push(`${name(f)}: missing ${f.file}`)
      continue
    }
    const params = parseParams(source)
    const values = defaults(params)
    const css = cssVars(params, values)
    const ext = extname(f.file!)
    const snippet = `snippets/${slug(name(f))}${ext}`
    write(snippet, standaloneSnippet(source, ext, params, css))
    // Files it imports (from a registry install), at the paths its imports expect.
    const extra: string[] = []
    let modules: Record<string, string> = {}
    const moduleText = f.modules ? files.text(f.modules) : null
    if (moduleText !== null) {
      modules = JSON.parse(moduleText)
      for (const [spec, src] of Object.entries(modules)) {
        const rel = `snippets/${slug(name(f))}/${spec.replace(/^@\//, '')}.tsx`
        write(rel, src)
        extra.push(rel)
      }
    }

    const rows: string[] = []
    const trigger = annotation(source, 'trigger')
    const animates = annotation(source, 'animates')
    const step: Step = {}
    const steps: [string, Step][] = [[trigger || 'animate', step]]
    for (const p of params) {
      const shown = formatParam(p, p.value).replace(/ -?[\d.]+\.\.-?[\d.]+$/, '')
      const label = f.labels?.[p.name]
      const use = `${name(f)} · ${label ?? p.name}`
      let token = ''
      if (p.kind === 'ease') token = `--${(step.ease ??= addEase(p.value as Bezier, name(f)))}`
      if (p.kind === 'number' && p.unit === 'ms' && p.value !== 0) {
        const kind = timingKind(p.name)
        const t = addMs(kind, p.value as number, use)
        step[kind] ??= t
        token = `--${t}`
      }
      if (p.kind === 'spring') token = step.spring ??= addSpring(p.value as Spring, shown, use)
      rows.push(`| ${label ? `${label} (\`${p.name}\`)` : `\`${p.name}\``} | \`${shown}\` | ${p.kind} | ${token ? `\`${token}\`` : ''} |`)
    }
    const timing = (re: RegExp) => params.find((p) => re.test(p.name) && p.kind === 'number' && p.unit === 'ms')?.value as number | undefined
    presets.push({
      label: name(f),
      duration: timing(/^(duration|dur)$/i),
      delay: timing(/^delay$/i),
      ease: params.find((p) => p.kind === 'ease')?.value as Bezier | undefined,
      spring: params.find((p) => p.kind === 'spring')?.value as Spring | undefined,
    })

    // Motion values found in the code itself (as currently saved), one block per animation.
    const explicit = new Set(params.map((p) => p.name))
    const detection = detectMotion(source, modules, ext === '.html' ? 'html' : 'tsx', basename(f.file!))
    for (const g of detection.groups) {
      const gStep: Step = {}
      steps.push([g.label, gStep])
      const by = (label: string) => g.params.find((p) => p.label === label && !explicit.has(p.name))?.value
      presets.push({
        label: `${name(f)} ${g.label}`,
        duration: by('duration') as number | undefined,
        delay: by('delay') as number | undefined,
        ease: g.params.find((p) => p.kind === 'ease' && !explicit.has(p.name))?.value as Bezier | undefined,
        spring: g.params.find((p) => p.kind === 'spring' && !explicit.has(p.name))?.value as Spring | undefined,
      })
      for (const p of g.params) {
        if (explicit.has(p.name)) continue
        let token = ''
        const use = `${name(f)} · ${g.label} ${p.label}`
        if (p.kind === 'ease') token = `--${(gStep.ease ??= addEase(p.value as Bezier, `${name(f)} · ${g.label}`))}`
        if (p.kind === 'number' && p.unit === 'ms' && p.value !== 0) {
          const kind = timingKind(p.label)
          const t = addMs(kind, p.value as number, use)
          gStep[kind] ??= t
          token = `--${t}`
        }
        if (p.kind === 'spring') token = gStep.spring ??= addSpring(p.value as Spring, describeValue(p), use)
        rows.push(
          `| ${g.label} · ${p.label} | \`${describeValue(p)}\` | ${p.kind}, detected in ${g.file}:${p.line} | ${token ? `\`${token}\`` : ''} |`,
        )
      }
    }

    // Motion measured in the running frame and tuned on the board (library or theme values, not in the code).
    for (const saved of Object.values(f.runtime ?? {})) {
      presets.push({ label: `${name(f)} ${saved.label}`, duration: saved.duration, delay: saved.delay, ease: saved.ease })
      const t = { ...saved, label: saved.label.replace(/</g, '&lt;').replace(/>/g, '&gt;') }
      const how = 'measured while running, tuned on the board (not in the snippet)'
      const rStep: Step = {}
      steps.push([saved.label, rStep])
      if (t.duration) {
        rStep.duration = addMs('duration', t.duration, `${name(f)} · ${saved.label}`)
        rows.push(`| ${t.label} · duration | \`${Math.round(t.duration)}ms\` | number, ${how} | \`--${rStep.duration}\` |`)
      }
      if (t.delay) {
        rStep.delay = addMs('delay', t.delay, `${name(f)} · ${saved.label}`)
        rows.push(`| ${t.label} · delay | \`${Math.round(t.delay)}ms\` | number, ${how} | \`--${rStep.delay}\` |`)
      }
      if (t.ease) {
        rStep.ease = addEase(t.ease, `${name(f)} · ${t.label}`)
        rows.push(`| ${t.label} · easing | \`cubic-bezier(${t.ease.join(', ')})\` | ease, ${how} | \`--${rStep.ease}\` |`)
      }
    }
    const used = steps.filter(([, st]) => Object.keys(st).length)
    if (used.length) {
      // Keyed by what sets it off (or the animation's kind), with the element it's on as a comment.
      const keys = new Set<string>()
      const rows = used.map(([label, st], i) => {
        const [kind, ...where] = label.split(' · ')
        let key = slug(kind)
        for (let k = 2; keys.has(key); k++) key = `${slug(kind)}-${k}`
        keys.add(key)
        const recipe = [i === 0 ? animates?.split(/\s*,\s*/).join(' + ') : '', st.ease ?? st.spring, st.duration, st.delay, st.stagger].filter(Boolean).join(', ')
        return { line: `  ${key}: ${recipe}`, where: where.join(' · ') }
      })
      const width = Math.max(...rows.map((r) => r.line.length))
      const lines = rows.map((r) => (r.where ? `${r.line.padEnd(width)}   # ${r.where}` : r.line))
      patterns.push({ key: slug(name(f).replace(/\s*\(copy\)$/i, '')), lines })
    }

    const lines = [`## ${name(f)}`, '']
    if (trigger) lines.push(`- **Trigger:** ${trigger}`)
    if (animates) lines.push(`- **Animates:** ${animates}`)
    if (f.wrapper) lines.push(`- **Renders inside:** \`${f.wrapper}\` (providers/context it needs)`)
    lines.push(`- **Snippet:** [\`${snippet}\`](${snippet}) (exact, locked values)`)
    // Props set on the board: the snippet is the component as published, so say how it's configured.
    if (f.props && Object.keys(f.props).length) {
      const attrs = Object.entries(f.props).map(([k, v]) => (typeof v === 'string' ? `${k}=${JSON.stringify(v)}` : v === true ? k : `${k}={${JSON.stringify(v)}}`))
      lines.push(`- **Props:** \`<${componentTag(source)} ${attrs.join(' ')} />\` (set on the board; the snippet keeps the component's defaults)`)
    }
    if (extra.length) lines.push(`- **Imports:** ${extra.map((e) => `[\`${e}\`](${e})`).join(', ')} (\`@/…\` paths from the component library)`)

    const refs = refsOf(f).flatMap((r) => byId.get(r) ?? [])
    for (const ref of refs) lines.push(...describeReference(ref, name(ref), copyRef, readJson))
    const about = new Set([f.id, ...refs.map((r) => r.id)])
    for (const note of board.frames.filter((n) => n.type === 'note' && refsOf(n).some((r) => about.has(r)))) {
      lines.push(`- **Intent:** ${note.text?.trim().replace(/\n+/g, ' ')}`)
    }
    if (rows.length) lines.push('', '| Param | Value | Kind | Token |', '|---|---|---|---|', ...rows)
    if (Object.keys(css).length) {
      lines.push('', 'CSS variables the snippet reads:', '```css', `:root { ${Object.entries(css).map(([k, v]) => `${k}: ${v};`).join(' ')} }`, '```')
    }
    motion.push(lines.join('\n'))
  }

  // References with no coded copy yet.
  const replicated = new Set(codeFrames.flatMap(refsOf))
  const pending = board.frames.filter((f) => (f.type === 'video' || (f.type === 'url' && !f.post)) && !replicated.has(f.id))
  if (pending.length) {
    motion.push(
      [
        '## Not yet recreated',
        '',
        'These references have no tuned code copy. Treat any timing below as an estimate; none of it is in the tokens.',
        '',
        ...pending.flatMap((f) => [`### ${name(f)}`, '', ...describeReference(f, name(f), copyRef, readJson), '']),
      ].join('\n'),
    )
  }

  // ── swatches, notes, images ─────────────────────────────
  const swatches = board.frames.filter((f) => f.type === 'swatch')
  swatches
    .filter((s) => s.color)
    .forEach((s, i) => {
      const t: Token = { name: `color-${s.label ? slug(s.label) : i + 1}`, value: s.color!, uses: [name(s)] }
      colors.set(t.name, t)
    })
  const palettes = board.frames.filter((f) => f.type === 'palette' && f.colors?.length)
  const taken = new Set([...colors.keys()])
  const paletteTokens = new Map<Frame, string[]>()
  for (const p of palettes) {
    const own: string[] = []
    for (const c of p.colors!) {
      let n = `color-${slug(nameColor(c.hex))}`
      for (let k = 2; taken.has(n); k++) n = `color-${slug(nameColor(c.hex))}-${k}`
      taken.add(n)
      colors.set(n, { name: n, value: c.hex, uses: [name(p)] })
      own.push(n)
    }
    paletteTokens.set(p, own)
  }
  const fonts = swatches.filter((s) => s.font)
  const fontTokens = new Map<string, string>()
  for (const f of fonts) {
    // Named by role ("Headings" → --font-headings), or by family when there's no role.
    const base = `font-${slug(f.label && f.label !== 'Font' ? f.label : f.font!)}`
    let n = base
    for (let k = 2; fontTokens.has(n); k++) n = `${base}-${k}`
    fontTokens.set(n, fontStack(f.font!, f.fontCategory))
    fontTokens.set(`${n}-size`, `${f.size ?? SWATCH_SIZE}px`)
    fontTokens.set(`${n}-weight`, String(f.weight ?? 400))
    if (f.italic) fontTokens.set(`${n}-style`, 'italic')
  }
  const fontImports = [...new Set(fonts.map((f) => f.fontHref).filter(Boolean))]
  const notes = board.frames.filter((f) => (f.type === 'note' || f.type === 'text') && f.text?.trim())
  const images = board.frames.filter((f) => f.type === 'image' && f.src)
  const posts = board.frames.filter((f) => f.type === 'url' && f.post && f.src)
  const sounds = board.frames.filter((f) => f.type === 'audio' && !f.music && (f.src || f.clips?.length))
  const music = board.frames.filter((f) => f.type === 'audio' && f.music && f.src)
  const notesOn = (f: Frame) => notes.filter((n) => refsOf(n).includes(f.id)).map((n) => ` ${n.text!.trim().replace(/\n+/g, ' ')}`).join('')
  // One sound: its file in references/ and what it measures as, in the side panel's words.
  const soundLine = (label: string, src: string, r?: SoundReading) => {
    const dest = copyRef(src)
    const file = dest ? `: [\`${dest}\`](${dest})` : ''
    const read = r ? `. ${soundFacts(r).map(([k, v]) => (k === 'Feel' ? v.toLowerCase() : `${k.toLowerCase()} ${v}`)).join(', ')}` : ''
    return `- **${label}**${file}${read}`
  }

  // ── references/: everything the board was made from, with index.md saying what each one is ──
  // Files are copied in (pictures, videos and their keyframes, site pictures, sounds); what only
  // lives online (sites, posts, Spotify) is listed by link.
  const refLines: Record<string, string[]> = { Pictures: [], Videos: [], Websites: [], Posts: [], Sounds: [], Music: [] }
  const inRefs = (dest: string | null) => (dest ? `[\`${basename(dest)}\`](${basename(dest)})` : null)
  // One line per reference: titles copied from posts can hold line breaks.
  const one = (f: Frame) => name(f).replace(/\s+/g, ' ').trim()
  const from = (f: Frame) => (f.origin ? ` (from ${f.origin})` : '')
  for (const f of board.frames) {
    const about = notesOn(f)
    if (f.type === 'image' && f.src) {
      const file = inRefs(copyRef(f.src))
      if (file) refLines.Pictures.push(`- **${one(f)}**: ${file}${from(f)}${cropNote(f)}${about}`)
    } else if (f.type === 'video' && f.src) {
      const file = inRefs(copyRef(f.src))
      const a = readJson<VideoAnalysis>(f.analysis)
      const sheet = a ? inRefs(copyRef(a.contactSheet)) : null
      const seg = f.segment ? `. The motion is at ${f.segment.in.toFixed(2)}–${f.segment.out.toFixed(2)}s` : ''
      if (file)
        refLines.Videos.push(`- **${one(f)}**: ${file}${sheet ? `, keyframes ${sheet}` : ''}${from(f)}${seg}${cropNote(f)}${a ? '. Measured: the numbers are in interactions.md' : ''}${about}`)
    } else if (f.type === 'url' && f.src && f.post) {
      refLines.Posts.push(`- **${one(f)}** (${POST_SITE[f.post.provider]}): ${f.src}. Open it there; only the link is kept.${about}`)
    } else if (f.type === 'url' && f.src) {
      const shot = f.snapshot ? inRefs(copyRef(f.snapshot)) : null
      refLines.Websites.push(`- **${one(f)}**: ${f.src}${shot ? `, full-page picture ${shot}` : ''}${f.analysis ? '. Its motion was captured: interactions.md' : ''}${about}`)
    } else if (f.type === 'audio' && f.music && f.src) {
      refLines.Music.push(`- **${(f.music.title ?? one(f)).replace(/\s+/g, ' ')}** (Spotify): ${f.src}${about}`)
    } else if (f.type === 'audio') {
      const files = (f.clips ?? (f.src ? [{ src: f.src }] : [])).map((c) => inRefs(copyRef(c.src))).filter(Boolean)
      if (files.length) refLines.Sounds.push(`- **${one(f)}**: ${files.join(', ')}${about}`)
    }
  }
  const refCount = Object.values(refLines).reduce((n, l) => n + l.length, 0)
  if (refCount)
    write(
      'references/index.md',
      [
        `# ${board.name} · References`,
        '',
        "What the board was made from. Look at these before building and match them; the notes beside each are the designer's. Colors, type and rules are in [`design.md`](../design.md), measured timing in [`interactions.md`](../interactions.md).",
        '',
        ...Object.entries(refLines).flatMap(([title, lines]) => (lines.length ? [`## ${title}`, '', ...lines, ''] : [])),
      ].join('\n'),
    )

  // ── tokens.css / tokens.json ────────────────────────────
  const tokenCss = [
    '/* Generated by Moshboard. Values were tuned live against references. */',
    ...fontImports.map((h) => `@import url('${h}');`),
    ':root {',
    ...[...fontTokens].map(([n, v]) => `  --${n}: ${v};`),
    ...[...colors.values()].map((t) => `  --${t.name}: ${t.value};`),
    ...[...easings.values()].map((t) => `  --${t.name}: ${t.value}; /* ${t.uses.join(', ')} */`),
    ...Object.values(timings).flatMap((m) => [...m.values()].map((t) => `  --${t.name}: ${t.value}; /* ${t.uses.join(', ')} */`)),
    '}',
    ...(springs.size
      ? ['', '/* Springs (no CSS equivalent; use with motion/framer-motion `transition={{ type: "spring", … }}`):', ...[...springs.values()].map((t) => ` * ${t.name}: ${t.value}  (${t.uses.join(', ')})`), ' */']
      : []),
    '',
  ].join('\n')
  write('tokens.css', tokenCss)
  const tokenJson = (m: Map<string, Token>) => Object.fromEntries([...m.values()].map((t) => [t.name, t.value]))
  write(
    'tokens.json',
    JSON.stringify(
      { colors: tokenJson(colors), fonts: Object.fromEntries(fontTokens), easings: tokenJson(easings), durations: tokenJson(timings.duration), delays: tokenJson(timings.delay), staggers: tokenJson(timings.stagger), springs: tokenJson(springs) },
      null,
      2,
    ) + '\n',
  )

  // ── presets: the same timings for motion (framer-motion) and GSAP ──
  const usable = presets.filter((p) => p.duration !== undefined || p.spring)
  if (usable.length) {
    write('presets/motion.ts', motionPresets(usable))
    write('presets/gsap.ts', gsapPresets(usable))
  }

  // ── motion.md: the Design Harness motion format (references/motion.md) ──
  const byMs = (m: Map<string, Token>) => [...m.values()].sort((a, b) => parseFloat(a.value) - parseFloat(b.value))
  const tokenBlock = (title: string, about: string, list: { name: string; value: string; uses: string[] }[]) => {
    if (!list.length) return []
    const width = Math.max(...list.map((t) => `${t.name}: ${t.value}`.length))
    return [`## ${title}`, '', about, '', '```', ...list.map((t) => `${`${t.name}: ${t.value}`.padEnd(width)}   use: ${[...new Set(t.uses)].join(', ')}`), '```', '']
  }
  write(
    'motion.md',
    [
      `# ${board.name} · Motion`,
      '',
      'The motion system: values, the patterns built from them, and the stance on how much motion is right. Generated by Moshboard from references tuned side by side on the board, so the values are exact. How each one was measured: [`interactions.md`](interactions.md).',
      '',
      '**Rules:**',
      '- Patterns reference tokens by name, never raw values.',
      '- Each value\'s `use` is where it\'s used on the board.',
      '- The same names are CSS variables in [`tokens.css`](tokens.css) and keys in [`tokens.json`](tokens.json). Durations are in ms; divide by 1000 for motion / framer-motion.',
      ...(usable.length ? ['- Ready-made transitions: [`presets/motion.ts`](presets/motion.ts) (motion / framer-motion) and [`presets/gsap.ts`](presets/gsap.ts) (GSAP).'] : []),
      ...(pending.length ? [`- ${pending.length} reference${pending.length === 1 ? ' isn\'t' : 's aren\'t'} recreated yet. Their timings are estimates in [\`interactions.md\`](interactions.md), not tokens.`] : []),
      '',
      '---',
      '',
      ...(patterns.length ? [] : ['_No coded interactions on this board yet._', '']),
      ...tokenBlock('Duration', 'Named times in ms, each with where it\'s used.', byMs(timings.duration)),
      ...tokenBlock('Delay', 'Named times in ms.', byMs(timings.delay)),
      ...tokenBlock('Easing', 'Named curves, each with where it\'s used.', [...easings.values()]),
      ...tokenBlock('Spring', 'Named physics presets: stiffness, damping, mass.', [...springs.values()].map((t) => ({ ...t, value: `{ stiffness: ${t.spring.stiffness}, damping: ${t.spring.damping}, mass: ${t.spring.mass ?? 1} }` }))),
      ...tokenBlock('Stagger', 'Named intervals in ms between items animating in sequence.', byMs(timings.stagger)),
      ...(patterns.length
        ? [
            '## Enter/exit patterns',
            '',
            'Per interaction, what sets it off and its recipe: what animates, easing, duration, delay. Every value is a token name from above.',
            '',
            '```',
            ...patterns.flatMap((pt) => [`${pt.key}:`, ...pt.lines]),
            '```',
            '',
          ]
        : []),
      '## Philosophy',
      '',
      'One to three sentences. Sets stance, not values: how much motion is appropriate, whether it should be felt or barely noticed.',
      '',
      '```',
      '[Yours to write.]',
      '```',
      '',
    ].join('\n'),
  )

  // ── interactions.md: each recreated reference, how it was measured, and its exact values ──
  write(
    'interactions.md',
    [
      `# ${board.name} · Interactions`,
      '',
      'Each interaction below was recreated as code and tuned side by side with its reference. The values in the snippets are exact: build from them instead of re-estimating from the references. Tokens are named in [`motion.md`](motion.md).',
      '',
      ...(motion.length ? motion.join('\n\n---\n\n').split('\n') : ['_No coded interactions on this board yet._']),
      '',
    ].join('\n'),
  )

  // ── design.md: the visual system, in the Design Harness token style ──
  // Notes are the designer's words: lines that read as rules go under Rules, the rest is intent.
  const RULE = /^(do|don['’]?t|do not|never|always|avoid|must|only)\b/i
  const unlinkedNotes = notes.filter((n) => !refsOf(n).length)
  const noteLines = unlinkedNotes.flatMap((n) => n.text!.trim().split(/\n+/).map((l) => l.trim()).filter(Boolean))
  const rules = noteLines.filter((l) => RULE.test(l.replace(/^[-•*]\s*/, '')))
  const intent = unlinkedNotes.map((n) => n.text!.trim().split(/\n+/).filter((l) => !RULE.test(l.trim().replace(/^[-•*]\s*/, ''))).join('\n')).filter((t) => t.trim())
  // `name:  value   note`, with names and values each in a column.
  const block = (rows: [string, string, string?][], sep = ':') => {
    const kw = Math.max(...rows.map(([k]) => k.length)) + sep.length
    const vw = Math.max(...rows.map(([, v]) => v.length))
    return rows.map(([k, v, note]) => `${(k + sep).padEnd(kw)}  ${note ? `${v.padEnd(vw)}   ${note}` : v}`)
  }
  const colorRow = (n: string, locked?: boolean, share?: number): [string, string, string] => {
    const hex = colors.get(n)!.value
    const ink = inkFor(hex)
    const amount = share !== undefined ? `${`${Math.round(share * 100)}%`.padStart(4)} of the palette   ` : ''
    return [n, hex.toUpperCase(), `${amount}text: ${ink === '#ffffff' ? 'white' : 'dark'} ${contrast(hex, ink).toFixed(1)}:1${locked ? '   locked' : ''}`]
  }
  const groupNames = new Map<string, number>()
  const group = (label: string) => {
    const k = (groupNames.get(label) ?? 0) + 1
    groupNames.set(label, k)
    return k > 1 ? `${label} ${k}` : label
  }
  const swatchColors = [...colors.values()].filter((t) => swatches.some((s) => name(s) === t.uses[0]))
  const colorLines = [
    ...palettes.flatMap((p) => {
      // Shares set in the palette's panel: how much of the design each color takes.
      const shares = paletteShares(p.colors!)
      return [`# ${group(name(p))}`, ...block(p.colors!.map((c, i) => colorRow(paletteTokens.get(p)![i], c.locked, shares?.[i])))]
    }),
    ...(swatchColors.length ? ['# Swatches', ...block(swatchColors.map((t) => colorRow(t.name)))] : []),
  ]
  const typeLines = fonts.length ? block([...fontTokens].map(([k, v]) => [k, v])) : []
  // Sections: how the designer grouped the board. Each one's title and description say what
  // its blocks share; a nested section is listed under its parent.
  const sections = board.frames.filter(isSection)
  const sectionTree = (parent: Frame | undefined, depth: number): string[] =>
    sections
      .filter((sec) => sectionOf(sec, board.frames)?.id === parent?.id)
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .flatMap((sec) => {
        const items = board.frames
          .filter((f) => !isSection(f) && f.type !== 'text' && sectionOf(f, board.frames)?.id === sec.id)
          .sort((a, b) => a.y - b.y || a.x - b.x)
          .map((f) => (f.type === 'note' ? `"${(f.text ?? '').trim().replace(/\n+/g, ' ')}"` : name(f)))
        const indent = '  '.repeat(depth)
        return [
          `${indent}- **${sec.label || 'Section'}**${sec.text ? `: ${sec.text}` : ''}${items.length ? ` (${items.join(', ')})` : ''}`,
          ...sectionTree(sec, depth + 1),
        ]
      })
  // An approved section: say so, and name the ones set aside, so they aren't built from.
  const picked = sections.find((sec) => sec.chosen)
  const setAside = picked ? full.frames.filter((f) => isSection(f) && !f.chosen && !sectionOf(f, full.frames)) : []
  const directionLines = picked
    ? [
        '## Direction',
        '',
        `**${picked.label || 'Section'}** was approved${setAside.length ? ` over ${setAside.map((f) => `"${f.label || 'Section'}"`).join(', ')}` : ''}. Build from it.${!setAside.length ? '' : setAside.some((f) => byId.has(f.id)) ? ' The others are listed for contrast, not as a source.' : ' The others were set aside and left out of this spec.'}`,
        '',
      ]
    : []
  const sectionLines = sections.length ? ['## Sections', '', 'How the board is grouped. Treat each group as one idea; the blocks in it are examples of it.', '', ...sectionTree(undefined, 0), ''] : []
  const design = [
    `# ${board.name} · Design`,
    '',
    'The visual system from this board: colors, type, references and the intent behind them. Generated by Moshboard. Motion lives in [`motion.md`](motion.md).',
    '',
    '**Rules:**',
    '- Build from these values. Every color and font below is a token; don\'t add new ones.',
    '- If something you need isn\'t here, say what\'s missing and ask. Don\'t invent it.',
    '- The same names are CSS variables in [`tokens.css`](tokens.css) and keys in [`tokens.json`](tokens.json).',
    '',
    '## Where to look',
    '',
    '```',
    ...block(
      [
        ['Need a color or font?', '→ Color, Type below · tokens.css'],
        ['Animating something?', '→ motion.md'],
        ...(codeFrames.length ? [['Rebuilding an interaction?', '→ interactions.md + snippets/'] as [string, string]] : []),
        ...(refCount ? [['Matching a look?', '→ references/index.md (every reference, with notes)'] as [string, string]] : []),
        ...(sounds.length ? [['Adding a sound?', '→ Sound below · references/'] as [string, string]] : []),
      ],
      '',
    ),
    '```',
    '',
    ...directionLines,
    ...sectionLines,
    ...(intent.length ? ['## Intent', '', intent.join('\n\n'), ''] : []),
    ...(rules.length ? ['## Rules', '', 'From notes on the board.', '', ...rules.map((r) => `- ${r.replace(/^[-•*]\s*/, '')}`), ''] : []),
    ...(colorLines.length ? ['## Color', '', 'Named colors, each with the text color that reads on it and its contrast.', '', '```', ...colorLines, '```', ''] : []),
    ...(typeLines.length
      ? [
          '## Type',
          '',
          '```',
          ...typeLines,
          '```',
          '',
          ...fonts.map((f) => `- **${f.font}** ${styleName(f.weight, f.italic)}${f.label && f.label !== 'Font' ? `: ${f.label}` : ''}. ${f.fontHref ? 'Google Fonts, loaded by `tokens.css`.' : 'Installed locally; make sure it ships with the product.'}`),
          '',
        ]
      : []),
    ...(images.length || posts.length
      ? [
          '## Visual references',
          '',
          ...images.map((f) => {
            const dest = copyRef(f.src!)
            const about = notes.filter((n) => refsOf(n).includes(f.id)).map((n) => ` ${n.text!.trim().replace(/\n+/g, ' ')}`)
            return `- **${name(f)}**: [\`${dest}\`](${dest})${cropNote(f)}${about.join('')}`
          }),
          // Posts stay on their site (only the link is kept): open them there.
          ...posts.map((f) => {
            const site = POST_SITE[f.post!.provider]
            return `- **${name(f)}**${name(f).includes(site) ? '' : ` (${site})`}: ${f.src}${notesOn(f)}`
          }),
          '',
        ]
      : []),
    ...(sounds.length
      ? [
          '## Sound',
          '',
          'Interface sounds, measured from the files in `references/`. Match their length, how fast they get loud and how they fade before matching anything else.',
          '',
          ...sounds.flatMap((f) =>
            f.clips
              ? [`- **${name(f)}**${notesOn(f)}`, ...f.clips.map((c) => `  ${soundLine(c.name, c.src, c.sound)}`)]
              : [soundLine(name(f), f.src!, f.sound) + notesOn(f)],
          ),
          '',
        ]
      : []),
    ...(music.length
      ? ['## Music', '', 'Mood references, played in Spotify. Their feel is in the notes beside them.', '', ...music.map((f) => `- **${f.music?.title ?? name(f)}**: ${f.src}${notesOn(f)}`), '']
      : []),
    ...pacingSection(board.frames, readJson, name),
    ...(codeFrames.length
      ? ['## Interactions', '', 'Recreated as code. Timing and easing are in [`motion.md`](motion.md); how each was measured is in [`interactions.md`](interactions.md).', '', ...codeFrames.map((f) => `- ${name(f)}`), '']
      : []),
  ].join('\n')
  write('design.md', design)

  return {
    outputs,
    files: written,
    warnings,
    scope: { frames: board.frames.length, total: full.frames.length },
  }
}

/** What a video's analysis says, for its kind: values for an interface, rhythm for a motion graphic, pacing for footage. */
function measuredLines(a: VideoAnalysis, set?: MotionKind): string[] {
  const r = a.read
  const kind = set ?? r?.kind
  const area = a.region ? ' (in the picked area)' : ''
  const curve = (m: Move) =>
    m.spring ? `a spring (stiffness ${m.spring.stiffness}, damping ${m.spring.damping})` : `\`cubic-bezier(${m.ease.bezier.join(', ')})\` (closest named: ${m.ease.nearest})`
  const move = (m: Move) =>
    m.dir ? `${m.type === 'slide' ? 'slides' : 'moves'} ${m.dir} ${Math.abs((m.distance ?? 0) - 1) < 0.08 ? 'a full frame' : `${Math.round((m.distance ?? 0) * 100)}% of the frame`}` : m.type === 'fade' ? 'fades' : m.type === 'move' ? 'something moves' : 'changes'
  if (!r || !kind) {
    return a.primary
      ? [`- **Measured from the video (estimate):** motion starts at ${a.primary.startMs}ms and lasts about ${a.primary.durationMs}ms; the curve fits \`cubic-bezier(${a.primary.ease.bezier.join(', ')})\` (closest named: ${a.primary.ease.nearest})`]
      : []
  }
  const main = r.moves.reduce<Move | null>((x, m) => (!x || m.durationMs * m.area > x.durationMs * x.area ? m : x), null)
  if (kind === 'footage' && r.pacing) {
    const p = r.pacing
    return [
      `- **Read as footage${area}:** pacing, not UI timing. ${p.shots} shot${p.shots > 1 ? 's' : ''}, a cut every ${(p.shotMs / 1000).toFixed(1)}s on average; feels ${p.feel}.`,
      ...(p.camera.length ? [`- **Camera:** ${p.camera.map((c) => `${c.kind} (${(c.startMs / 1000).toFixed(1)}–${(c.endMs / 1000).toFixed(1)}s)`).join(', ')}`] : []),
    ]
  }
  if (kind === 'graphic' && r.rhythm) {
    const h = r.rhythm
    return [
      `- **Read as a motion graphic${area}:** ${h.beats} changes; each move takes ${h.moveMs}ms${h.spreadMs > 20 ? ` (± ${h.spreadMs})` : ''}, holds ${(h.holdMs / 1000).toFixed(1)}s, and repeats every ${(h.everyMs / 1000).toFixed(1)}s.`,
      ...(main ? [`- **The move:** ${move(main)}, on ${curve(main)}`] : []),
    ]
  }
  if (!main) return []
  return [
    `- **Measured from the video (estimate)${area}:** the main move starts at ${main.startMs}ms and lasts about ${main.durationMs}ms; it ${move(main)}, on ${curve(main)}`,
    ...(r.moves.length > 1 ? [`- **Other moves:** ${r.moves.filter((m) => m !== main).map((m) => `${m.durationMs}ms at ${m.startMs}ms`).join(', ')}`] : []),
  ]
}

function describeReference(
  ref: Frame,
  label: string,
  copyRef: (rel: string) => string | null,
  readJson: <T>(rel?: string) => T | null,
): string[] {
  const lines: string[] = []
  if (ref.type === 'video' && ref.src) {
    lines.push(`- **Reference:** video "${label}"${ref.segment ? `, ${ref.segment.in.toFixed(2)}s–${ref.segment.out.toFixed(2)}s` : ''}${ref.origin ? ` (from ${ref.origin})` : ''}${cropNote(ref)}`)
    const a = readJson<VideoAnalysis>(ref.analysis)
    const measured = a ? measuredLines(a, ref.motionKind) : []
    if (measured.length) {
      lines.push(...measured)
      const sheet = copyRef(a!.contactSheet)
      if (sheet) lines.push(`- **Keyframes:** [\`${sheet}\`](${sheet})`)
    }
  } else if (ref.type === 'url' && ref.post && ref.src) {
    const site = POST_SITE[ref.post.provider]
    lines.push(`- **Reference:** ${label.includes(site) ? `"${label}"` : `${site} post "${label}"`}: ${ref.src}`)
  } else if (ref.type === 'url' && ref.src) {
    lines.push(`- **Reference:** live site ${ref.src}`)
    const c = readJson<MotionCapture>(ref.analysis)
    if (c) {
      lines.push(`- **Captured from the site (exact):** trigger \`${c.trigger}\` on \`${c.selector}\``)
      for (const t of c.transitions) lines.push(`  - transition \`${t.property}\` ${t.duration} ${t.timingFunction} delay ${t.delay}`)
      for (const an of c.animations) lines.push(`  - animation \`${an.name}\` ${an.duration}ms ${an.easing} delay ${an.delay}ms`)
      for (const [prop, ch] of Object.entries(c.changed)) lines.push(`  - \`${prop}\`: \`${ch.before}\` → \`${ch.after}\``)
    }
  } else if (ref.type === 'image' && ref.src) {
    const dest = copyRef(ref.src)
    lines.push(`- **Reference:** image [\`${dest}\`](${dest})${ref.origin ? ` (from ${ref.origin})` : ''}${cropNote(ref)}`)
  } else {
    lines.push(`- **Reference:** ${ref.type} "${label}"`)
  }
  return lines
}

/** A cropped picture or video: the part of the file the board shows (the file itself is whole). */
function cropNote(f: Frame) {
  const v = f.view
  if (!v) return ''
  const p = (n: number) => `${Math.round(n * 100)}%`
  return `. Only the part from ${p(v.x)}–${p(v.x + v.w)} across and ${p(v.y)}–${p(v.y + v.h)} down is the reference; the rest is the app it was captured in`
}

/** Inline locked params so the snippet doesn't depend on the Moshboard runtime. */
function standaloneSnippet(source: string, ext: string, params: Param[], css: Record<string, string>) {
  const values = runtimeValues(params, defaults(params))
  const cssDecl = Object.entries(css)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')
  if (ext === '.html') {
    const style = `<style>:root { ${cssDecl} }</style>`
    return /<head[^>]*>/i.test(source) ? source.replace(/<head[^>]*>/i, (m) => `${m}\n${style}`) : `${style}\n${source}`
  }
  let out = source.replace(
    /import\s*\{[^}]*\}\s*from\s*['"]moodboard['"];?\n?/,
    `const __params = ${JSON.stringify(values)} as const;\nconst useParams = () => __params;\nconst getParams = useParams;\n`,
  )
  if (cssDecl) out = `/* CSS variables used below. Define them on :root or a wrapper: ${cssDecl} */\n${out}`
  return out
}

/** The name to write a component as in JSX: its default export's, else "Component". */
function componentTag(source: string) {
  return (
    /export\s+default\s+(?:async\s+)?function\s+([A-Z]\w*)/.exec(source)?.[1] ??
    /export\s+default\s+([A-Z]\w*)/.exec(source)?.[1] ??
    /export\s+(?:function|const)\s+([A-Z]\w*)/.exec(source)?.[1] ??
    'Component'
  )
}

interface Preset {
  label: string
  /** ms */
  duration?: number
  delay?: number
  ease?: Bezier
  spring?: Spring
}

/** Unique camelCase export names: "Card slide (copy)" → `cardSlideCopy`. */
function presetNames(presets: Preset[]) {
  const used = new Set<string>()
  return presets.map((p) => {
    const words = p.label.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
    let base = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') || 'transition'
    if (/^\d/.test(base)) base = `t${base}`
    let n = base
    for (let i = 2; used.has(n); i++) n = `${base}${i}`
    used.add(n)
    return n
  })
}

const sec = (ms: number) => +(ms / 1000).toFixed(3)

function motionPresets(presets: Preset[]) {
  const names = presetNames(presets)
  const body = presets.map((p, i) => {
    const fields = p.spring
      ? [`type: 'spring'`, `stiffness: ${p.spring.stiffness}`, `damping: ${p.spring.damping}`, ...(p.spring.mass !== undefined ? [`mass: ${p.spring.mass}`] : [])]
      : [`duration: ${sec(p.duration!)}`, ...(p.ease ? [`ease: [${p.ease.join(', ')}]`] : [])]
    if (p.delay) fields.push(`delay: ${sec(p.delay)}`)
    return `/** ${p.label} */\nexport const ${names[i]} = { ${fields.join(', ')} } as const`
  })
  return [
    '// Generated by Moshboard: transitions tuned against references, for motion (framer-motion).',
    `// <motion.div animate={{ x: 0 }} transition={${names[0]}} />`,
    '',
    ...body,
    '',
  ].join('\n')
}

function gsapPresets(presets: Preset[]) {
  const names = presetNames(presets)
  const body = presets.map((p, i) => {
    if (p.spring && p.duration === undefined)
      return `/** ${p.label}: a spring (stiffness ${p.spring.stiffness}, damping ${p.spring.damping}). GSAP has no springs; use presets/motion.ts, or approximate with ease: 'elastic.out(1, 0.5)'. */`
    const fields = [`duration: ${sec(p.duration!)}`]
    if (p.delay) fields.push(`delay: ${sec(p.delay)}`)
    if (p.ease) fields.push(`ease: CustomEase.create('${names[i]}', 'M0,0 C${p.ease[0]},${p.ease[1]} ${p.ease[2]},${p.ease[3]} 1,1')`)
    return `/** ${p.label} */\nexport const ${names[i]} = { ${fields.join(', ')} }`
  })
  return [
    '// Generated by Moshboard: tween timings tuned against references, for GSAP.',
    `// gsap.to('.card', { x: 240, ...${names.find((_, i) => presets[i].duration !== undefined) ?? names[0]} })`,
    "import gsap from 'gsap'",
    "import { CustomEase } from 'gsap/CustomEase'",
    '',
    'gsap.registerPlugin(CustomEase)',
    '',
    ...body,
    '',
  ].join('\n')
}

/** design.md: videos read as footage or motion graphics give the board's pacing and rhythm (no UI tokens). */
function pacingSection(frames: Frame[], readJson: <T>(rel?: string) => T | null, name: (f: Frame) => string): string[] {
  const lines = frames.flatMap((f) => {
    if (f.type !== 'video') return []
    const a = readJson<VideoAnalysis>(f.analysis)
    const kind = f.motionKind ?? a?.read?.kind
    const r = a?.read
    if (kind === 'footage' && r?.pacing)
      return [`- **${name(f)}** (footage): a cut every ${(r.pacing.shotMs / 1000).toFixed(1)}s, ${r.pacing.feel}${r.pacing.camera.length ? `; ${r.pacing.camera.map((c) => c.kind).join(', ')}` : ''}`]
    if (kind === 'graphic' && r?.rhythm)
      return [`- **${name(f)}** (motion graphic): moves of ${r.rhythm.moveMs}ms, holds of ${(r.rhythm.holdMs / 1000).toFixed(1)}s, a beat every ${(r.rhythm.everyMs / 1000).toFixed(1)}s`]
    return []
  })
  return lines.length ? ['## Pacing', '', 'From the videos: how fast things cut and change. Mood, not exact timing.', '', ...lines, ''] : []
}
