import fs from 'node:fs'
import path from 'node:path'
import { contrast, inkFor, nameColor } from '../shared/color.ts'
import { describeValue, detectMotion } from '../shared/detect-motion.ts'
import { NAMED_EASES } from '../shared/ease.ts'
import { fontStack, styleName, SWATCH_SIZE } from '../shared/fonts.ts'
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
} from '../shared/params.ts'
import type { Board, Frame, MotionCapture, VideoAnalysis } from '../shared/types.ts'
import { displayPath } from './boards-dir.ts'

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
export async function exportBoard(boardsDir: string, boardName: string, outDir?: string, ids?: string[]) {
  const bdir = path.join(boardsDir, boardName)
  const full: Board = JSON.parse(fs.readFileSync(path.join(bdir, 'board.json'), 'utf8'))
  let board = full
  if (ids?.length) {
    const keep = new Set(ids)
    for (const f of full.frames) if (keep.has(f.id) && f.link) keep.add(f.link)
    for (const f of full.frames) if (f.link && keep.has(f.link)) keep.add(f.id)
    board = { ...full, frames: full.frames.filter((f) => keep.has(f.id)) }
  }
  const out = outDir ? path.resolve(outDir) : path.join(bdir, 'export')
  if (!outDir) fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(path.join(out, 'refs'), { recursive: true })
  fs.mkdirSync(path.join(out, 'snippets'), { recursive: true })

  const byId = new Map(board.frames.map((f) => [f.id, f]))
  const name = (f: Frame) => f.label || `${f.type} ${f.id}`
  const written: string[] = []
  const warnings: string[] = []
  const write = (rel: string, content: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true })
    fs.writeFileSync(path.join(out, rel), content)
    written.push(rel)
  }
  const copyRef = (rel: string) => {
    const src = path.join(bdir, rel)
    if (!fs.existsSync(src)) return null
    const dest = `refs/${path.basename(rel)}`
    write(dest, fs.readFileSync(src))
    return dest
  }
  const readJson = <T>(rel?: string): T | null => {
    if (!rel || !fs.existsSync(path.join(bdir, rel))) return null
    return JSON.parse(fs.readFileSync(path.join(bdir, rel), 'utf8'))
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
    const srcPath = path.join(bdir, f.file!)
    if (!fs.existsSync(srcPath)) {
      warnings.push(`${name(f)}: missing ${f.file}`)
      continue
    }
    const source = fs.readFileSync(srcPath, 'utf8')
    const params = parseParams(source)
    const values = defaults(params)
    const css = cssVars(params, values)
    const ext = path.extname(f.file!)
    const snippet = `snippets/${slug(name(f))}${ext}`
    write(snippet, standaloneSnippet(source, ext, params, css))
    // Files it imports (from a registry install), at the paths its imports expect.
    const extra: string[] = []
    let modules: Record<string, string> = {}
    if (f.modules && fs.existsSync(path.join(bdir, f.modules))) {
      modules = JSON.parse(fs.readFileSync(path.join(bdir, f.modules), 'utf8'))
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
    const detection = detectMotion(source, modules, ext === '.html' ? 'html' : 'tsx', path.basename(f.file!))
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

    const ref = f.link ? byId.get(f.link) : undefined
    if (ref) lines.push(...describeReference(ref, name(ref), copyRef, readJson))
    for (const note of board.frames.filter((n) => n.type === 'note' && n.link && (n.link === f.id || n.link === ref?.id))) {
      lines.push(`- **Intent:** ${note.text?.trim().replace(/\n+/g, ' ')}`)
    }
    if (rows.length) lines.push('', '| Param | Value | Kind | Token |', '|---|---|---|---|', ...rows)
    if (Object.keys(css).length) {
      lines.push('', 'CSS variables the snippet reads:', '```css', `:root { ${Object.entries(css).map(([k, v]) => `${k}: ${v};`).join(' ')} }`, '```')
    }
    motion.push(lines.join('\n'))
  }

  // References with no coded copy yet.
  const replicated = new Set(codeFrames.map((f) => f.link).filter(Boolean))
  const pending = board.frames.filter((f) => (f.type === 'video' || f.type === 'url') && !replicated.has(f.id))
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
  const unlinkedNotes = notes.filter((n) => !n.link)
  const noteLines = unlinkedNotes.flatMap((n) => n.text!.trim().split(/\n+/).map((l) => l.trim()).filter(Boolean))
  const rules = noteLines.filter((l) => RULE.test(l.replace(/^[-•*]\s*/, '')))
  const intent = unlinkedNotes.map((n) => n.text!.trim().split(/\n+/).filter((l) => !RULE.test(l.trim().replace(/^[-•*]\s*/, ''))).join('\n')).filter((t) => t.trim())
  // `name:  value   note`, with names and values each in a column.
  const block = (rows: [string, string, string?][], sep = ':') => {
    const kw = Math.max(...rows.map(([k]) => k.length)) + sep.length
    const vw = Math.max(...rows.map(([, v]) => v.length))
    return rows.map(([k, v, note]) => `${(k + sep).padEnd(kw)}  ${note ? `${v.padEnd(vw)}   ${note}` : v}`)
  }
  const colorRow = (n: string, locked?: boolean): [string, string, string] => {
    const hex = colors.get(n)!.value
    const ink = inkFor(hex)
    return [n, hex.toUpperCase(), `text: ${ink === '#ffffff' ? 'white' : 'dark'} ${contrast(hex, ink).toFixed(1)}:1${locked ? '   locked' : ''}`]
  }
  const groupNames = new Map<string, number>()
  const group = (label: string) => {
    const k = (groupNames.get(label) ?? 0) + 1
    groupNames.set(label, k)
    return k > 1 ? `${label} ${k}` : label
  }
  const swatchColors = [...colors.values()].filter((t) => swatches.some((s) => name(s) === t.uses[0]))
  const colorLines = [
    ...palettes.flatMap((p) => [`# ${group(name(p))}`, ...block(p.colors!.map((c, i) => colorRow(paletteTokens.get(p)![i], c.locked)))]),
    ...(swatchColors.length ? ['# Swatches', ...block(swatchColors.map((t) => colorRow(t.name)))] : []),
  ]
  const typeLines = fonts.length ? block([...fontTokens].map(([k, v]) => [k, v])) : []
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
        ...(images.length ? [['Matching a look?', '→ Visual references below · refs/'] as [string, string]] : []),
      ],
      '',
    ),
    '```',
    '',
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
    ...(images.length
      ? [
          '## Visual references',
          '',
          ...images.map((f) => {
            const dest = copyRef(f.src!)
            const about = notes.filter((n) => n.link === f.id).map((n) => ` ${n.text!.trim().replace(/\n+/g, ' ')}`)
            return `- **${name(f)}**: [\`${dest}\`](${dest})${about.join('')}`
          }),
          '',
        ]
      : []),
    ...(codeFrames.length
      ? ['## Interactions', '', 'Recreated as code. Timing and easing are in [`motion.md`](motion.md); how each was measured is in [`interactions.md`](interactions.md).', '', ...codeFrames.map((f) => `- ${name(f)}`), '']
      : []),
  ].join('\n')
  write('design.md', design)

  return {
    dir: displayPath(out),
    files: written,
    warnings,
    scope: { frames: board.frames.length, total: full.frames.length },
  }
}

function describeReference(
  ref: Frame,
  label: string,
  copyRef: (rel: string) => string | null,
  readJson: <T>(rel?: string) => T | null,
): string[] {
  const lines: string[] = []
  if (ref.type === 'video' && ref.src) {
    lines.push(`- **Reference:** video "${label}"${ref.segment ? `, ${ref.segment.in.toFixed(2)}s–${ref.segment.out.toFixed(2)}s` : ''}${ref.origin ? ` (from ${ref.origin})` : ''}`)
    const a = readJson<VideoAnalysis>(ref.analysis)
    if (a?.primary) {
      lines.push(
        `- **Measured from the video (estimate):** motion starts at ${a.primary.startMs}ms and lasts about ${a.primary.durationMs}ms; the curve fits \`cubic-bezier(${a.primary.ease.bezier.join(', ')})\` (closest named: ${a.primary.ease.nearest})`,
      )
      const sheet = copyRef(a.contactSheet)
      if (sheet) lines.push(`- **Keyframes:** [\`${sheet}\`](${sheet})`)
    }
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
    lines.push(`- **Reference:** image [\`${dest}\`](${dest})${ref.origin ? ` (from ${ref.origin})` : ''}`)
  } else {
    lines.push(`- **Reference:** ${ref.type} "${label}"`)
  }
  return lines
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
