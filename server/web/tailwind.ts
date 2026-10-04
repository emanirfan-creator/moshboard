// Tailwind for a code frame (POST { sources }), compiled here like the local server does, so a frame
// on the website gets a few KB of static CSS instead of running Tailwind's in-browser compiler.
// Pure JS: the local server's class scanner is a native module that doesn't bundle into a function.
import { compile } from 'tailwindcss'
import TAILWIND_CSS from 'tailwindcss/index.css?raw'
import { TW_THEME } from '../../shared/twTheme.ts'
import { body, handle } from './http.ts'

let compiler: ReturnType<typeof compile> | null = null

/** Every word that could be a class. Tailwind skips the ones that aren't, so over-collecting is fine. */
function candidates(sources: string[]) {
  const out = new Set<string>()
  for (const src of sources)
    // Classes never hold spaces or quotes, but arbitrary values like shadow-[0_0_4px_rgba(0,0,0,.5)]
    // hold brackets and commas and content-['x'] holds `'`; the loosest split also finds words
    // in style values (`blur(4px)`, `transition:`, `transition=`), as the local scanner does.
    for (const split of [/[\s"'`;{}]+/, /[\s"`;{}]+/, /[\s"'`;{}(),:=]+/])
      for (const word of src.split(split)) if (word && word.length < 200) out.add(word)
  return [...out]
}

export default handle(async (req, res) => {
  const { sources } = await body(req)
  compiler ??= compile(`@import "tailwindcss";\n${TW_THEME}`, {
    loadStylesheet: async (id, base) => {
      if (id !== 'tailwindcss') throw new Error(`Can't load ${id}`)
      return { path: 'tailwindcss/index.css', base, content: TAILWIND_CSS }
    },
  })
  const css = (await compiler).build(candidates(Array.isArray(sources) ? sources.map(String) : []))
  res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' })
  res.end(css)
})
