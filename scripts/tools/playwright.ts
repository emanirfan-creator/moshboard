// What `import('playwright')` resolves to in moshboard-tools.mjs (see scripts/build-tools.ts).
// The tools run in the user's own folder, where Playwright isn't installed: the first run installs
// playwright-core next to the script (no browser download: it drives the installed Chrome).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const deps = path.join(path.dirname(fileURLToPath(import.meta.url)), '.deps')
const require = createRequire(path.join(deps, 'index.js'))

function load(): typeof import('playwright') {
  try {
    return require('playwright-core')
  } catch {
    console.error('Setting up the browser driver (playwright-core), once. This takes a minute…')
    fs.mkdirSync(deps, { recursive: true })
    execFileSync('npm', ['install', '--prefix', deps, '--no-audit', '--no-fund', '--loglevel=error', 'playwright-core@1'], { stdio: 'inherit' })
    return require('playwright-core')
  }
}

export const { chromium } = load()
