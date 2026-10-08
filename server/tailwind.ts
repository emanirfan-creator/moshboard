// Compile Tailwind for a frame on the server, so frames get a few KB of static
// CSS instead of each running Tailwind's in-browser compiler.
import { createHash } from 'node:crypto'
import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import { TW_THEME } from '../shared/twTheme.ts'
import { remember } from '../shared/memo.ts'

const cache = remember<string>(200)

export async function buildFrameCss(sources: string[]): Promise<string> {
  // Keyed on the classes, not the source: editing text or numbers in a frame reuses its CSS.
  const candidates = [...new Set(new Scanner({}).scanFiles(sources.map((content) => ({ content, extension: 'tsx' }))))].sort()
  const key = createHash('sha1').update(candidates.join('\0')).digest('hex')
  return cache(key, async () => {
    // A fresh compiler each time: build() adds to every class a compiler has seen before.
    const c = await compile(`@import "tailwindcss";\n${TW_THEME}`, { base: process.cwd(), onDependency() {} })
    return c.build(candidates)
  })
}
