// Compare: two or more sections (directions) side by side, everything else hidden. The live
// blocks are only drawn somewhere else for a while (an offset per frame), so nothing moves on
// the board, components and videos keep running, and pan/zoom covers all of them at once.
import { isSection, sectionContents, sectionOf } from '../../shared/sections.ts'
import { fitView } from '../actions'
import { cue } from '../ui/sound'
import { frameById, getState, setCamera, setState, toast } from '../store'

const GAP = 200
/** Room under each section for its summary (colors, fonts). */
const SUMMARY_H = 200

/** The selected sections, or every top-level section when fewer than two are selected. */
function chosen() {
  const frames = getState().board?.frames ?? []
  const picked = getState()
    .selected.map(frameById)
    .filter((f) => !!f && isSection(f))
  const pool = picked.length >= 2 ? picked : frames.filter((f) => isSection(f) && !sectionOf(f, frames))
  // A section inside another chosen one comes along with its parent.
  return pool.filter((s) => !pool.some((p) => p !== s && sectionContents(p!, frames).includes(s!)))
}

export const canCompare = () => chosen().length >= 2

export function startCompare() {
  const frames = getState().board?.frames ?? []
  const secs = chosen().sort((a, b) => a!.x - b!.x || a!.y - b!.y)
  if (secs.length < 2) return toast('Add two sections to compare them', true)
  // One row, tops aligned, starting where the leftmost section is.
  let x = Math.min(...secs.map((s) => s!.x))
  const y = Math.min(...secs.map((s) => s!.y))
  const offsets: Record<string, { dx: number; dy: number }> = {}
  for (const s of secs) {
    const off = { dx: x - s!.x, dy: y - s!.y }
    offsets[s!.id] = off
    for (const c of sectionContents(s!, frames)) offsets[c.id] = off
    x += s!.w + GAP
  }
  const h = Math.max(...secs.map((s) => s!.h))
  setState({ compare: { ids: secs.map((s) => s!.id), offsets, camera: getState().camera }, selected: [], interact: null, renaming: null })
  // The titles sit above the sections and the summaries below them.
  fitView([{ x: Math.min(...secs.map((s) => s!.x + offsets[s!.id].dx)), y: y - 48, w: x - GAP - Math.min(...secs.map((s) => s!.x + offsets[s!.id].dx)), h: h + 48 + SUMMARY_H }])
  cue('slide-in')
}

export function exitCompare() {
  const c = getState().compare
  if (!c) return
  setState({ compare: null, selected: c.ids.filter((id) => frameById(id)) })
  setCamera(c.camera)
  cue('slide-out')
}

export const COMPARE_SUMMARY_GAP = 40
