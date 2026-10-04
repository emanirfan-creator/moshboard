// Bundles the live-site tools (scripts/tools/moshboard-tools.ts) into one file the website hands
// to the user's folder: public/tools/moshboard-tools.mjs, next to its skill. Playwright resolves to
// scripts/tools/playwright.ts, which installs playwright-core on first use.
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'vite'

const OUT = path.resolve('public/tools')

await build({
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  resolve: { alias: { playwright: path.resolve('scripts/tools/playwright.ts') } },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: path.resolve('scripts/tools/moshboard-tools.ts'),
    outDir: OUT,
    emptyOutDir: true,
    target: 'node20',
    // One file: the website hands it to the folder as is.
    rollupOptions: { output: { entryFileNames: 'moshboard-tools.mjs', format: 'es', codeSplitting: false } },
  },
})
fs.copyFileSync(path.resolve('scripts/tools/SKILL.md'), path.join(OUT, 'SKILL.md'))
console.log(`Tools built in ${path.relative(process.cwd(), OUT)}`)
