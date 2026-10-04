// Compile Tailwind for a frame on the server, so frames get a few KB of static
// CSS instead of each running Tailwind's in-browser compiler.
import { createHash } from 'node:crypto'
import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import { TW_THEME } from '../shared/twTheme.ts'

const cache = new Map<string, string>()

export async function buildFrameCss(sources: string[]): Promise<string> {
  const key = createHash('sha1').update(sources.join('\0')).digest('hex')
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  // A fresh compiler each time: build() adds to every class a compiler has seen before.
  const c = await compile(`@import "tailwindcss";\n${TW_THEME}`, { base: process.cwd(), onDependency() {} })
  const candidates = new Scanner({}).scanFiles(sources.map((content) => ({ content, extension: 'tsx' })))
  const css = c.build(candidates)
  if (cache.size > 200) cache.clear()
  cache.set(key, css)
  return css
}
