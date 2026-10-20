// pnpm skill:install — puts Moshboard's skills in ~/.claude/skills so Claude Code has them in any repo:
// /recreate (linked, so `git pull` here keeps it up to date) and moshboard-motions (copied, with
// this install's boards folder filled in, so "use bounce out" finds the saved animations).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BOARDS_DIR } from '../server/boards-dir.ts'

const skills = path.join(os.homedir(), '.claude/skills')
fs.mkdirSync(skills, { recursive: true })

const src = path.resolve('.claude/skills/recreate')
const dest = path.join(skills, 'recreate')
const existing = fs.lstatSync(dest, { throwIfNoEntry: false })
if (existing?.isSymbolicLink()) fs.unlinkSync(dest)
else if (existing) {
  console.error(`${dest} already exists and isn't a link. Move it away, then run this again.`)
  process.exit(1)
}
fs.symlinkSync(src, dest, 'dir')
console.log(`Linked /recreate → ${dest}`)

const motions = path.join(skills, 'moshboard-motions')
fs.mkdirSync(motions, { recursive: true })
const text = fs.readFileSync('.claude/skills/moshboard-motions/SKILL.md', 'utf8').replaceAll('{{BOARDS}}', BOARDS_DIR)
fs.writeFileSync(path.join(motions, 'SKILL.md'), text)
console.log(`Wrote moshboard-motions → ${motions} (saved animations in ${BOARDS_DIR}; run again if that moves)`)
