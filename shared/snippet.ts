// Usage snippets from a README: imports, then bare JSX like `<Orb state="listening" size={64} />`.
//
// They become a `Preview` component whose props are the literal attributes in
// the JSX, so each one shows up as a control in the side panel. When the
// package publishes types, the props get its types and doc comments too
// (a union of states becomes a menu, not a text box).

import { propsTypeMembers } from './props.ts'

interface Lifted {
  name: string
  /** the default as source text: `"listening"`, `64`, `true` */
  value: string
}

interface Snippet {
  imports: string[]
  jsx: string
}

const SKIP = new Set(['className', 'style', 'children', 'ref', 'key', 'id'])

export function parseSnippet(source: string): Snippet | null {
  if (/export\s+default\b/.test(source)) return null
  const imports: string[] = []
  const rest = source.replace(/^\s*import\s[\s\S]*?(?:from\s*)?['"][^'"]+['"];?[ \t]*$/gm, (m) => {
    imports.push(m.trim())
    return ''
  })
  const jsx = rest.trim().replace(/;\s*$/, '')
  return jsx.startsWith('<') ? { imports, jsx } : null
}

/** Literal attributes on component tags, rewritten to read from props. Names used twice stay as written. */
function liftProps(jsx: string): { jsx: string; props: Lifted[] } {
  const found: (Lifted & { start: number; end: number })[] = []
  const tag = /<([A-Z][\w.]*)/g
  for (let m; (m = tag.exec(jsx)); ) {
    let i = m.index + m[0].length
    while (i < jsx.length) {
      const a = /^\s*([A-Za-z_$][\w$-]*)(\s*=\s*)?/.exec(jsx.slice(i))
      if (!a || !a[1]) break
      const start = i + a[0].length - a[0].trimStart().length
      i += a[0].length
      if (!a[2]) {
        found.push({ name: a[1], value: 'true', start, end: i })
        continue
      }
      const v = /^("[^"]*"|'[^']*'|\{\s*(-?\d*\.?\d+|true|false|"[^"]*"|'[^']*')\s*\})/.exec(jsx.slice(i))
      if (v) {
        found.push({ name: a[1], value: v[2] ?? v[1], start, end: i + v[0].length })
        i += v[0].length
        continue
      }
      // A computed value: step over it.
      if (jsx[i] !== '{') break
      let depth = 0
      for (; i < jsx.length; i++) {
        if (jsx[i] === '{') depth++
        else if (jsx[i] === '}' && --depth === 0) break
      }
      i++
    }
  }
  const counts = new Map<string, number>()
  for (const f of found) counts.set(f.name, (counts.get(f.name) ?? 0) + 1)
  const keep = found.filter((f) => counts.get(f.name) === 1 && !SKIP.has(f.name) && !/^(on[A-Z]|aria-|data-)/.test(f.name))
  let out = jsx
  for (const f of [...keep].reverse()) out = out.slice(0, f.start) + `${f.name}={${f.name}}` + out.slice(f.end)
  return { jsx: out, props: keep.map(({ name, value }) => ({ name, value: value.replace(/^'(.*)'$/, '"$1"') })) }
}

/** One element renders as is; several go in a fragment. */
function singleRoot(jsx: string) {
  const m = /^<([\w.]+)/.exec(jsx)
  if (!m) return false
  const selfClosing = new RegExp(`^<${m[1]}\\b[^<>]*?/>$`)
  const closing = new RegExp(`</${m[1].replace('.', '\\.')}>$`)
  if (selfClosing.test(jsx)) return true
  if (!closing.test(jsx)) return false
  // `<A>…</A><A>…</A>`: more than one root.
  let depth = 0
  for (const t of jsx.matchAll(/<(\/?)([\w.]*)[^<>]*?(\/?)>/g)) {
    if (t[3]) continue
    depth += t[1] ? -1 : 1
    if (depth === 0 && t.index! + t[0].length < jsx.length) return false
  }
  return true
}

export interface PropType {
  type: string
  doc?: string
  /** declarations the type names, copied in (`type OrbState = …`) */
  aliases: string[]
}

/** The component, wrapped. `types`: per prop, from the package (see `packageTypes`). */
export function buildSnippet(snippet: Snippet, types: Record<string, PropType> = {}) {
  const { jsx, props } = liftProps(snippet.jsx)
  const indent = (s: string, n: number) => s.split('\n').join('\n' + ' '.repeat(n))
  const body = singleRoot(jsx) ? `  return (\n    ${indent(jsx, 4)}\n  )` : `  return (\n    <>\n      ${indent(jsx, 6)}\n    </>\n  )`
  const head = snippet.imports.join('\n')
  if (!props.length) return `${head}\n\nexport default function Preview() {\n${body}\n}\n`

  const fallback = (v: string) => (/^["']/.test(v) ? 'string' : v === 'true' || v === 'false' ? 'boolean' : 'number')
  const aliases = [...new Set(props.flatMap((p) => types[p.name]?.aliases ?? []))]
  const members = props.map((p) => {
    const t = types[p.name]
    const doc = t?.doc ? `  /** ${t.doc} */\n` : ''
    return `${doc}  ${p.name}?: ${t?.type ?? fallback(p.value)}`
  })
  const pattern = props.map((p) => `${p.name} = ${p.value}`).join(', ')
  return [
    head,
    ...aliases,
    `interface PreviewProps {\n${members.join('\n')}\n}`,
    `export default function Preview({ ${pattern} }: PreviewProps) {\n${body}\n}\n`,
  ].join('\n\n')
}

// ── types from the package ──────────────────────────────

/**
 * Types (and doc comments) for the lifted props, read from the package's
 * published `.d.ts` via esm.sh. Empty when the package has none or the
 * network is off; the snippet still works, just with plainer controls.
 */
export async function packageTypes(snippet: Snippet): Promise<Record<string, PropType>> {
  const { props } = liftProps(snippet.jsx)
  if (!props.length) return {}
  const used = new Set([...snippet.jsx.matchAll(/<([A-Z]\w*)/g)].map((m) => m[1]))
  const out: Record<string, PropType> = {}
  for (const line of snippet.imports) {
    const spec = /['"]([^'"]+)['"]/.exec(line)?.[1]
    if (!spec || /^[./]|^https?:/.test(spec)) continue
    const names = (/\{([^}]*)\}/.exec(line)?.[1] ?? '')
      .split(',')
      .map((n) => n.trim().split(/\s+as\s+/))
    const comps = names.map(([orig, local]) => [orig, local ?? orig]).filter(([, local]) => used.has(local))
    if (!comps.length) continue
    const sources = await declarationFiles(spec).catch(() => [])
    if (!sources.length) continue
    for (const [orig] of comps) {
      const members = propsTypeMembers(propsTypeName(orig, sources), sources)
      for (const p of props) {
        const m = members.find((x) => x.name === p.name)
        if (!m || out[p.name]) continue
        const aliases = [...m.type.matchAll(/\b[A-Z]\w*\b/g)].map((n) => aliasDecl(n[0], sources))
        // A type naming something we can't copy in would only confuse: let the value speak.
        if (aliases.some((a) => a === undefined)) continue
        out[p.name] = { type: m.type, doc: m.doc, aliases: aliases as string[] }
      }
    }
  }
  return out
}

function propsTypeName(component: string, sources: string[]) {
  const own = `${component}Props`
  if (sources.some((s) => new RegExp(`(?:interface|type)\\s+${own}\\b`).test(s))) return own
  for (const s of sources) {
    const m = new RegExp(`\\b${component}\\b[^;]*?(?:\\(\\s*\\w+\\??\\s*:\\s*|<)([A-Z]\\w*)`).exec(s)
    if (m) return m[1]
  }
  return own
}

function aliasDecl(name: string, sources: string[]) {
  for (const s of sources) {
    const m = new RegExp(`(?:export\\s+)?(?:declare\\s+)?type\\s+${name}\\s*=\\s*([^;\\n]+(?:\\n\\s*\\|[^;\\n]+)*);?`).exec(s)
    // Literal unions only: anything structural belongs to the library.
    if (m && /^(\s*\|?\s*('[^']*'|"[^"]*"|-?\d*\.?\d+)\s*)+$/.test(m[1])) return `type ${name} = ${m[1].trim()}`
  }
}

/** The package's `.d.ts` files, following relative re-exports from its entry. */
async function declarationFiles(spec: string, limit = 24) {
  const head = await fetch(`https://esm.sh/${spec}`, { method: 'HEAD' })
  const entry = head.headers.get('x-typescript-types')
  if (!entry) return []
  const seen = new Set<string>()
  const queue = [new URL(entry, 'https://esm.sh/').href]
  const texts: string[] = []
  while (queue.length && seen.size < limit) {
    const url = queue.shift()!
    if (seen.has(url)) continue
    seen.add(url)
    const res = await fetch(url)
    if (!res.ok) continue
    const text = await res.text()
    texts.push(text)
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) queue.push(new URL(m[1], url).href)
  }
  return texts
}
