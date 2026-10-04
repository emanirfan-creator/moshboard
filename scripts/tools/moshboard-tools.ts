// Live-site tools for Claude Code (or Codex) working in a Moshboard folder: what the local app's
// server does with a browser (capture motion, find elements, snapshot, read fonts), as a command
// line, writing the same files the app reads. Installed into the folder by the website
// (src/folder/folder.ts) next to the skill that explains it (scripts/tools/SKILL.md).
//
//   node moshboard-tools.mjs elements <board> <frameId>
//   node moshboard-tools.mjs capture  <board> <frameId> --selector "<css>" --trigger hover|click|focus|scroll|load
//   node moshboard-tools.mjs snapshot <board> <frameId> [--width 1280]
//   node moshboard-tools.mjs fonts    <board> <frameId>
//
// <board> is the board's folder (`.` when board.json is in the current folder).
import fs from 'node:fs'
import path from 'node:path'
import { captureUrl } from '../../server/capture-url.ts'
import { pickTargets } from '../../server/pick-element.ts'
import { siteFonts, snapshotUrl } from '../../server/snapshot.ts'
import type { Board, Frame } from '../../shared/types.ts'

const [command, boardArg, frameId, ...rest] = process.argv.slice(2)
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : undefined
}
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

if (!command || !boardArg || !frameId) fail('Usage: node moshboard-tools.mjs <elements|capture|snapshot|fonts> <board folder> <frameId> [options]')
const boardDir = path.resolve(boardArg)
const boardFile = path.join(boardDir, 'board.json')
if (!fs.existsSync(boardFile)) fail(`No board.json in ${boardDir}`)

const readBoard = (): Board => JSON.parse(fs.readFileSync(boardFile, 'utf8'))
/** Changes the board the way the app saves it; the app watches the file and shows the change live. */
function editBoard(change: (b: Board) => void) {
  const b = readBoard()
  change(b)
  fs.writeFileSync(boardFile, JSON.stringify(b, null, 2) + '\n')
}
const setFrame = (patch: Partial<Frame>) => editBoard((b) => Object.assign(b.frames.find((f) => f.id === frameId)!, patch))

const frame = readBoard().frames.find((f) => f.id === frameId)
if (!frame) fail(`No frame ${frameId} on that board`)
if (frame!.type !== 'url' || !frame!.src) fail(`Frame ${frameId} isn't a website (it's ${frame!.type})`)
const url = frame!.src!

try {
  if (command === 'elements') {
    const r = await pickTargets(boardDir, frameId, url)
    console.log(JSON.stringify({ screenshot: path.join(boardArg, r.image), targets: r.targets.map(({ selector, label, moves, trigger }) => ({ selector, label, moves, trigger })) }, null, 2))
  } else if (command === 'capture') {
    const selector = flag('selector') ?? fail('capture needs --selector "<css>" (find one with: elements)')
    const trigger = flag('trigger') ?? 'hover'
    const { capture, path: rel, scaffold } = await captureUrl(boardDir, frameId, { url, selector, trigger })
    // Like "Capture motion" in the app: the capture is linked to the site, and a starting frame replays it.
    const id = Math.random().toString(36).slice(2, 8)
    fs.mkdirSync(path.join(boardDir, 'frames'), { recursive: true })
    fs.writeFileSync(path.join(boardDir, 'frames', `${id}.html`), scaffold)
    editBoard((b) => {
      const f = b.frames.find((x) => x.id === frameId)!
      f.analysis = rel
      b.frames.push({ id, type: 'code', file: `frames/${id}.html`, label: `${f.label ?? 'Site'}: ${trigger}`, link: f.id, x: f.x + f.w + 48, y: f.y, w: 420, h: 300, fit: true })
    })
    const n = capture.transitions.length + capture.animations.length
    console.log(
      JSON.stringify({ captured: n, transitions: capture.transitions, animations: capture.animations.map((a) => ({ name: a.name, duration: a.duration, delay: a.delay, easing: a.easing })), file: rel, recording: capture.recording, scaffold: id }, null, 2),
    )
    if (!n) console.error('Nothing moved. Try another element or trigger.')
  } else if (command === 'snapshot') {
    const shot = await snapshotUrl(boardDir, frameId, url, Number(flag('width')) || frame!.viewport || 1280)
    const usedFonts = await siteFonts(url).catch(() => [])
    setFrame({ snapshot: shot.path, embed: 'blocked', ...(usedFonts.length ? { usedFonts } : {}) })
    console.log(JSON.stringify({ snapshot: shot.path, height: shot.height, fonts: usedFonts.slice(0, 5).map((f) => f.stack) }, null, 2))
  } else if (command === 'fonts') {
    const usedFonts = await siteFonts(url)
    setFrame({ usedFonts })
    console.log(JSON.stringify(usedFonts.slice(0, 8), null, 2))
  } else fail(`Unknown command: ${command}`)
} catch (e) {
  const message = (e as Error).message
  fail(/executable doesn't exist|chrome.*not found|distribution 'chrome'/i.test(message) ? 'Google Chrome is needed. Install it from google.com/chrome, then try again.' : message)
}
