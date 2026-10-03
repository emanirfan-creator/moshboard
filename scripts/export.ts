// pnpm export <board> [--out <dir>]
import path from 'node:path'
import { BOARDS_DIR, RUN_DIR } from '../server/boards-dir.ts'
import { exportBoard } from '../server/export.ts'

const args = process.argv.slice(2)
const board = args.find((a) => !a.startsWith('--')) ?? 'default'
const outIdx = args.indexOf('--out')
const out = outIdx >= 0 ? path.resolve(RUN_DIR, args[outIdx + 1]) : undefined

const result = await exportBoard(BOARDS_DIR, board, out)
console.log(`Exported ${board} → ${result.dir}`)
for (const f of result.files) console.log(`  ${f}`)
for (const w of result.warnings) console.warn(`  ! ${w}`)
