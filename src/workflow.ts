// The motion workflow, made visible: a reference gets measured, recreated as code,
// then tuned. Each frame in it shows how far along it is, and the selected one
// offers the next step as a single button.

import type { Frame } from '../shared/types.ts'
import { analyzeSelected, copyRecreate, exportBoard, lockParams, replay } from './actions'
import { getState, setState } from './store'

export type Stage = 'measured' | 'recreated' | 'tuned'
export const STAGES: Stage[] = ['measured', 'recreated', 'tuned']
export const STAGE_LABEL: Record<Stage, string> = { measured: 'Measured', recreated: 'Recreated', tuned: 'Tuned' }

const isRef = (f: Frame) => f.type === 'video' || f.type === 'url'
/** Coded copies linked to a reference (the scaffold a site capture adds counts too). */
const copiesOf = (f: Frame, frames: Frame[]) => frames.filter((c) => c.type === 'code' && c.link === f.id)

/** How far a frame is through measure → recreate → tune, or null when it isn't part of it. */
export function stageOf(f: Frame, frames: Frame[]): Stage | null {
  if (isRef(f)) {
    const copies = copiesOf(f, frames)
    if (copies.some((c) => c.tuned)) return 'tuned'
    if (copies.some((c) => c.file?.endsWith('.tsx'))) return 'recreated'
    return f.analysis ? 'measured' : null
  }
  if (f.type === 'code' && f.link) {
    const ref = frames.find((r) => r.id === f.link)
    if (!ref || !isRef(ref)) return null
    return f.tuned ? 'tuned' : 'recreated'
  }
  return null
}

export interface Step {
  label: string
  /** what it does, for the tooltip */
  hint: string
  kbd?: string
  run: () => unknown
}

/** The one thing to do next with this frame. Reads the current state, so call it while rendering the selected frame. */
export function nextStep(f: Frame): Step | null {
  const s = getState()
  const frames = s.board?.frames ?? []
  if (f.type === 'video') {
    if (!f.analysis) return { label: 'Analyze motion', hint: f.segment ? 'Measure timing and easing in the marked part' : 'Measure timing and easing (mark a part first with I and O to narrow it down)', run: analyzeSelected }
    if (!copiesOf(f, frames).length) return { label: 'Copy /recreate', hint: 'Copies the command; paste it in Claude Code to get a tunable copy', run: copyRecreate }
    return { label: 'Replay with copy', hint: 'Play the reference and its copy side by side', kbd: 'R', run: () => replay() }
  }
  if (f.type === 'url') {
    if (!f.analysis) return { label: 'Capture motion', hint: 'Pick an element on the site and record its exact timing', run: () => setState({ picking: f.id }) }
    if (!copiesOf(f, frames).some((c) => c.file?.endsWith('.tsx')))
      return { label: 'Copy /recreate', hint: 'Copies the command; paste it in Claude Code to turn the capture into a tunable copy', run: copyRecreate }
    return { label: 'Replay with copy', hint: 'Play the reference and its copy side by side', kbd: 'R', run: () => replay() }
  }
  if (f.type === 'code' && f.link && stageOf(f, frames)) {
    if (s.overrides[f.id]) return { label: 'Save tuning', hint: 'Write the tuned values into the code', kbd: '⌘S', run: () => lockParams() }
    if (!f.tuned) return { label: 'Replay side by side', hint: 'Compare with the reference, then tune in the panel', kbd: 'R', run: () => replay() }
    return { label: 'Export spec', hint: 'Write motion.md, tokens and snippets for this reference and its copy', run: () => exportBoard() }
  }
  return null
}
