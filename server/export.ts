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
  const easings = new Map<string, Token>()
  const durations = new Map<string, Token>()
  const springs = new Map<string, Token>()
  const colors = new Map<string, Token>()

  const addEase = (b: Bezier, use: string) => {
    const value = `cubic-bezier(${b.join(', ')})`
    const named = Object.entries(NAMED_EASES).find(([, nb]) => sameBezier(b, nb))?.[0]
    const t = easings.get(value) ?? { name: named ?? `ease-${slug(use)}`, value, uses: [] }
    t.uses.push(use)
    easings.set(value, t)
    return t.name
  }

  // ── motion sections ─────────────────────────────────────
  const motion: string[] = []
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
    for (const p of params) {
      const shown = formatParam(p, p.value).replace(/ -?[\d.]+\.\.-?[\d.]+$/, '')
      let token = ''
      if (p.kind === 'ease') token = `--${addEase(p.value as Bezier, name(f))}`
      if (p.kind === 'number' && p.unit === 'ms' && p.value !== 0) {
        const v = `${p.value}ms`
        const t = durations.get(v) ?? { name: `dur-${p.value}`, value: v, uses: [] }
        t.uses.push(`${name(f)}.${p.name}`)
        durations.set(v, t)
        token = `--${t.name}`
      }
      if (p.kind === 'spring') {
        const s = p.value as Spring
        const key = `${s.stiffness}/${s.damping}/${s.mass ?? 1}`
        const t = springs.get(key) ?? { name: `spring-${s.stiffness}-${s.damping}`, value: shown, uses: [] }
        t.uses.push(name(f))
        springs.set(key, t)
        token = t.name
      }
      const label = f.labels?.[p.name]
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
        if (p.kind === 'ease') token = `--${addEase(p.value as Bezier, `${name(f)} · ${g.label}`)}`
        if (p.kind === 'number' && p.unit === 'ms' && p.value !== 0) {
          const ms = Math.round(p.value as number)
          const v = `${ms}ms`
          const t = durations.get(v) ?? { name: `dur-${ms}`, value: v, uses: [] }
          t.uses.push(`${name(f)} · ${g.label} ${p.label}`)
          durations.set(v, t)
          token = `--${t.name}`
        }
        if (p.kind === 'spring') {
          const s = p.value as Spring
          const key = `${s.stiffness}/${s.damping}/${s.mass ?? 1}`
          const t = springs.get(key) ?? { name: `spring-${s.stiffness}-${s.damping}`, value: describeValue(p), uses: [] }
          t.uses.push(`${name(f)} · ${g.label}`)
          springs.set(key, t)
          token = t.name
        }
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
      if (t.duration !== undefined) rows.push(`| ${t.label} · duration | \`${Math.round(t.duration)}ms\` | number, ${how} | |`)
      if (t.delay !== undefined) rows.push(`| ${t.label} · delay | \`${Math.round(t.delay)}ms\` | number, ${how} | |`)
      if (t.ease) rows.push(`| ${t.label} · easing | \`cubic-bezier(${t.ease.join(', ')})\` | ease, ${how} | \`--${addEase(t.ease, `${name(f)} · ${t.label}`)}\` |`)
    }

    const lines = [`### ${name(f)}`, '']
    const trigger = annotation(source, 'trigger')
    const animates = annotation(source, 'animates')
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
        '### Not yet recreated',
        '',
        'These references have no tuned code copy. Treat any timing below as an estimate.',
        '',
        ...pending.flatMap((f) => [`**${name(f)}**`, ...describeReference(f, name(f), copyRef, readJson), '']),
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
  for (const p of palettes) {
    for (const c of p.colors!) {
      let n = `color-${slug(nameColor(c.hex))}`
      for (let k = 2; taken.has(n); k++) n = `color-${slug(nameColor(c.hex))}-${k}`
      taken.add(n)
      colors.set(n, { name: n, value: c.hex, uses: [name(p)] })
    }
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
    ...[...durations.values()].map((t) => `  --${t.name}: ${t.value}; /* ${t.uses.join(', ')} */`),
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
      { colors: tokenJson(colors), fonts: Object.fromEntries(fontTokens), easings: tokenJson(easings), durations: tokenJson(durations), springs: tokenJson(springs) },
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

  // ── motion.md ───────────────────────────────────────────
  write(
    'motion.md',
    [
      `# ${board.name}: motion spec`,
      '',
      'Each interaction below was recreated as code and tuned side by side with its reference. The values in the snippets are exact: build from them instead of re-estimating from the references.',
      '',
      '- Durations are in ms. When using motion/framer-motion, divide by 1000.',
      '- Easings are CSS `cubic-bezier`. In motion, pass the four numbers as an array.',
      '- Shared values live in [`tokens.css`](tokens.css) / [`tokens.json`](tokens.json).',
      ...(usable.length ? ['- Ready-made transitions: [`presets/motion.ts`](presets/motion.ts) (motion / framer-motion) and [`presets/gsap.ts`](presets/gsap.ts) (GSAP).'] : []),
      '',
      ...(motion.length ? motion.join('\n\n---\n\n').split('\n') : ['_No coded interactions on this board yet._']),
      '',
    ].join('\n'),
  )

  // ── design.md ───────────────────────────────────────────
  const unlinkedNotes = notes.filter((n) => !n.link)
  const design = [
    `# ${board.name}: design reference`,
    '',
    'Exported from Moshboard. Motion lives in [`motion.md`](motion.md); tokens are in [`tokens.css`](tokens.css).',
    '',
    ...(unlinkedNotes.length ? ['## Intent', '', ...unlinkedNotes.map((n) => n.text!.trim()), ''] : []),
    ...palettes.flatMap((p) => [
      `## ${name(p)}`,
      '',
      '| Color | Hex | Token | Text on it |',
      '|---|---|---|---|',
      ...p.colors!.map((c) => {
        const t = [...colors.values()].find((x) => x.value === c.hex && x.uses.includes(name(p)))
        const ink = inkFor(c.hex)
        return `| ${nameColor(c.hex)}${c.locked ? ' (locked)' : ''} | \`${c.hex.toUpperCase()}\` | \`--${t?.name}\` | ${ink === '#ffffff' ? 'white' : 'dark'} (${contrast(c.hex, ink).toFixed(1)}:1) |`
      }),
      '',
    ]),
    ...(swatches.some((s) => s.color) ? ['## Swatches', '', '| Token | Value |', '|---|---|', ...[...colors.values()].filter((t) => swatches.some((s) => name(s) === t.uses[0])).map((t) => `| \`--${t.name}\` | \`${t.value}\` |`), ''] : []),
    ...(fonts.length ? ['## Type', '', ...fonts.map((f) => `- **${f.font}** ${styleName(f.weight, f.italic)}, ${f.size ?? SWATCH_SIZE}px${f.label ? `: ${f.label}` : ''} (${f.fontHref ? `Google Fonts, loaded by \`tokens.css\`` : 'installed locally; make sure it ships with the product'})`), ''] : []),
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
    `## Interactions`,
    '',
    ...(codeFrames.length ? codeFrames.map((f) => `- ${name(f)} (see motion.md)`) : ['_None yet._']),
    '',
  ].join('\n')
  write('design.md', design)

  return {
    dir: path.relative(process.cwd(), out),
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
