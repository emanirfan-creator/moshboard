// Writes the spec export (shared/export.ts) to disk: `boards/<board>/export/` by default.
import fs from 'node:fs'
import path from 'node:path'
import { buildExport } from '../shared/export.ts'
import type { Board } from '../shared/types.ts'
import { displayPath } from './boards-dir.ts'

/**
 * Export the whole canvas, or only `ids` plus what they're linked to (a copy's
 * reference, notes attached to them), so a partial spec still has its context.
 */
export async function exportBoard(boardsDir: string, boardName: string, outDir?: string, ids?: string[]) {
  const bdir = path.join(boardsDir, boardName)
  const full: Board = JSON.parse(fs.readFileSync(path.join(bdir, 'board.json'), 'utf8'))
  const built = buildExport(
    full,
    {
      exists: (rel) => fs.existsSync(path.join(bdir, rel)),
      text: (rel) => {
        try {
          return fs.readFileSync(path.join(bdir, rel), 'utf8')
        } catch {
          return null
        }
      },
    },
    ids,
  )
  const out = outDir ? path.resolve(outDir) : path.join(bdir, 'export')
  if (!outDir) fs.rmSync(out, { recursive: true, force: true })
  for (const [rel, o] of built.outputs) {
    const dest = path.join(out, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    if ('text' in o) fs.writeFileSync(dest, o.text)
    else fs.copyFileSync(path.join(bdir, o.from), dest)
  }
  return { dir: displayPath(out), files: built.files, warnings: built.warnings, scope: built.scope }
}
