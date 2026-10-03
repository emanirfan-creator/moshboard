import os from 'node:os'
import path from 'node:path'

// Where boards live. MOSHBOARD_BOARDS points Moshboard at a folder in another repo (say
// `my-app/design`), so the app is installed once and each repo keeps only its boards. Relative
// paths are taken from where the command was run: pnpm runs scripts from Moshboard's own folder
// and leaves the original one in INIT_CWD.
export const RUN_DIR = process.env.INIT_CWD || process.cwd()
export const BOARDS_DIR = process.env.MOSHBOARD_BOARDS
  ? path.resolve(RUN_DIR, process.env.MOSHBOARD_BOARDS)
  : path.resolve('boards')

/** A path as people read it in toasts and copied prompts: relative inside Moshboard, `~/…` elsewhere. */
export function displayPath(abs: string) {
  const rel = path.relative(process.cwd(), abs)
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel
  const home = os.homedir()
  return abs.startsWith(home + path.sep) ? '~' + abs.slice(home.length) : abs
}
