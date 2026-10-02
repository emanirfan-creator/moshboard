// Resolve shadcn-style registry installs (the "npx shadcn@latest add …" line UI
// libraries like 21st.dev and Aceternity hand out) into component source.

const INDEX_URL = 'https://ui.shadcn.com/r/registries.json'
const SHADCN_ITEM = 'https://ui.shadcn.com/r/styles/new-york-v4/{name}.json'
// We already provide these inside frames.
const PROVIDED = new Set(['utils', 'https://ui.shadcn.com/r/styles/new-york-v4/utils.json'])

interface RegistryFile {
  path: string
  content?: string
  type?: string
  target?: string
}
interface RegistryItem {
  name: string
  title?: string
  description?: string
  dependencies?: string[]
  registryDependencies?: string[]
  files?: RegistryFile[]
}

export interface ResolvedComponent {
  name: string
  title: string
  /** source of the item that was asked for (rendered as the frame) */
  entry: string
  entryPath: string
  /** import path of the entry file itself (e.g. "@/components/ui/avatar-group") */
  entrySpec: string
  /** import specifier (e.g. "@/components/ui/3d-globe") → source, for everything it pulls in */
  modules: Record<string, string>
  dependencies: string[]
}

let index: Promise<Record<string, string>> | null = null
function registryIndex() {
  index ??= fetch(INDEX_URL)
    .then((r) => (r.ok ? r.json() : []))
    .then((list: { name: string; url: string }[]) => Object.fromEntries(list.map((r) => [r.name, r.url])))
    .catch(() => {
      index = null
      return {}
    })
  return index
}

/** Pull the item references out of an install command, a registry URL, or a bare "@ns/name". */
export function parseInstall(input: string): string[] {
  const text = input.trim()
  const cmd = /(?:npx|pnpm\s+dlx|bunx|yarn\s+dlx)\s+(?:shadcn(?:-ui)?(?:@[\w.-]+)?)\s+add\s+(.+)/i.exec(text)
  const args = cmd ? cmd[1] : text
  return args
    .split(/\s+/)
    .map((a) => a.replace(/^["']|["']$/g, ''))
    .filter((a) => a && !a.startsWith('-'))
}

async function itemUrl(ref: string): Promise<string> {
  if (/^https?:\/\//.test(ref)) return ref
  const ns = /^(@[\w-]+)\/(.+)$/.exec(ref)
  if (ns) {
    const template = (await registryIndex())[ns[1]]
    if (!template) throw new Error(`Unknown registry ${ns[1]}. Paste the component’s code or its registry URL instead.`)
    return template.replace('{name}', ns[2])
  }
  return SHADCN_ITEM.replace('{name}', ref)
}

async function fetchItem(ref: string): Promise<RegistryItem> {
  const url = await itemUrl(ref)
  const r = await fetch(url, { headers: { accept: 'application/json' } })
  if (!r.ok) {
    // Registries explain refusals in the body (21st.dev: premium components need sign-in).
    const body = (await r.json().catch(() => null)) as { reason?: string; error?: string; component?: { title?: string } } | null
    const name = body?.component?.title ?? ref
    if (body?.reason === 'authentication_required' || r.status === 401)
      throw new Error(`${name} is premium and needs a sign-in on ${new URL(url).hostname}`)
    throw new Error(body?.error ? `${name}: ${body.error}` : `Registry returned ${r.status} for ${ref}`)
  }
  const json = (await r.json()) as RegistryItem
  if (!json.files?.length) throw new Error(`${ref} has no files to render`)
  return json
}

/**
 * Import path a project would use for a registry file, e.g.
 *   target "components/ui/3d-globe.tsx"                    → "@/components/ui/3d-globe"
 *   path "registry/new-york-v4/ui/avatar.tsx", registry:ui → "@/components/ui/avatar"
 *   registry:hook → "@/hooks/…", registry:lib → "@/lib/…"
 */
function specifierFor(file: RegistryFile) {
  const strip = (p: string) => p.replace(/^(src\/|\.\/)/, '').replace(/\.(tsx|ts|jsx|js)$/, '')
  if (file.target) return `@/${strip(file.target).replace(/^~\//, '')}`
  const rel = strip(file.path).replace(/^registry\/[^/]+\//, '')
  const base = rel.split('/').pop()!
  switch (file.type) {
    case 'registry:ui':
      return `@/components/ui/${base}`
    case 'registry:hook':
      return `@/hooks/${base}`
    case 'registry:lib':
      return `@/lib/${base}`
    default:
      return rel.startsWith('components/') || rel.startsWith('lib/') || rel.startsWith('hooks/') ? `@/${rel}` : `@/components/${rel}`
  }
}

/** `context`: code already in the block (e.g. a pasted demo) whose imports should also be satisfied. */
export async function resolveInstall(input: string, context = ''): Promise<ResolvedComponent> {
  const refs = parseInstall(input)
  if (!refs.length) throw new Error('No component name found in that command')
  const [first, ...extra] = refs

  const seen = new Set<string>()
  const modules: Record<string, string> = {}
  const deps = new Set<string>()

  const visit = async (ref: string, depth: number): Promise<RegistryItem | null> => {
    if (seen.has(ref) || PROVIDED.has(ref) || depth > 6) return null
    seen.add(ref)
    const item = await fetchItem(ref)
    item.dependencies?.forEach((d) => deps.add(d))
    for (const f of item.files ?? []) if (f.content && /\.(tsx|ts|jsx|js)$/.test(f.path)) modules[specifierFor(f)] = f.content
    await Promise.all((item.registryDependencies ?? []).map((d) => visit(d, depth + 1)))
    return item
  }

  const top = await visit(first, 0)
  await Promise.all(extra.map((r) => visit(r, 0)))
  if (!top) throw new Error('Nothing to add')

  // Libraries assume shadcn's base components are installed and don't list them.
  // Fetch any `@/components/ui/<name>` that's imported but still missing.
  const entrySource = [context, ...(top.files ?? []).map((f) => f.content ?? '')].join('\n')
  for (let round = 0; round < 4; round++) {
    const sources = [entrySource, ...Object.values(modules)].join('\n')
    const missing = [...new Set([...sources.matchAll(/from\s+['"]@\/components\/ui\/([\w-]+)['"]/g)].map((m) => m[1]))].filter(
      (name) => !modules[`@/components/ui/${name}`],
    )
    if (!missing.length) break
    await Promise.all(missing.map((name) => visit(name, 1).catch(() => null)))
  }

  const entryFile = top.files!.find((f) => f.content && /\.(tsx|jsx)$/.test(f.path)) ?? top.files![0]
  const entrySpec = specifierFor(entryFile)
  delete modules[entrySpec]
  return {
    name: top.name,
    title: top.title || top.name.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    entry: entryFile.content ?? '',
    entryPath: entryFile.path,
    entrySpec,
    modules,
    dependencies: [...deps],
  }
}
