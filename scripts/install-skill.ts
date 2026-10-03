// pnpm skill:install — links /recreate into ~/.claude/skills so Claude Code has it in any repo.
// It's a link, not a copy, so `git pull` here keeps it up to date.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const src = path.resolve('.claude/skills/recreate')
const dest = path.join(os.homedir(), '.claude/skills/recreate')

fs.mkdirSync(path.dirname(dest), { recursive: true })
const existing = fs.lstatSync(dest, { throwIfNoEntry: false })
if (existing?.isSymbolicLink()) fs.unlinkSync(dest)
else if (existing) {
  console.error(`${dest} already exists and isn't a link. Move it away, then run this again.`)
  process.exit(1)
}
fs.symlinkSync(src, dest, 'dir')
console.log(`Linked /recreate → ${dest}`)
