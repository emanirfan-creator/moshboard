// Builds the website (pnpm build:web) in Vercel's Build Output format (.vercel/output): the app as
// static files in folder mode, plus the few server routes that work without a disk or a browser
// (server/web/*) as functions. Everything the website needs from a server is in this list.
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'vite'

const OUT = path.resolve('.vercel/output')
/** Function name → the local route(s) it answers, so the client calls the same paths as locally. */
const FUNCTIONS: Record<string, string> = {
  'media-find': '/api/media-find',
  'media-proxy': '/api/media-proxy',
  registry: '/api/registry(/.*)?',
  fonts: '/api/fonts',
  embeddable: '/api/embeddable(/.*)?',
}

process.env.VITE_FOLDER_ONLY = '1'
fs.rmSync(OUT, { recursive: true, force: true })

await build({ build: { outDir: path.join(OUT, 'static'), emptyOutDir: true } })

for (const name of Object.keys(FUNCTIONS)) {
  const dir = path.join(OUT, 'functions/api', `${name}.func`)
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: path.resolve('server/web', `${name}.ts`),
      outDir: dir,
      emptyOutDir: true,
      target: 'node22',
      rollupOptions: { output: { entryFileNames: 'index.mjs', format: 'es' } },
    },
  })
  fs.writeFileSync(
    path.join(dir, '.vc-config.json'),
    JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, supportsResponseStreaming: true, maxDuration: 60 }),
  )
}

fs.writeFileSync(
  path.join(OUT, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        // The folder worker must update as soon as a new version ships.
        { src: '^/folder-sw\\.js$', headers: { 'Cache-Control': 'no-cache' }, continue: true },
        ...Object.entries(FUNCTIONS).map(([name, route]) => ({ src: `^${route}$`, dest: `/api/${name}` })),
        { handle: 'filesystem' },
      ],
    },
    null,
    2,
  ),
)
console.log(`Website built in ${path.relative(process.cwd(), OUT)}`)
