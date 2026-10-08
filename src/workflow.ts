// The motion workflow, made visible: a reference gets measured, recreated as code,
// then tuned. Each frame in it shows how far along it is, and the selected one
// offers the next step as a single button.

import type { Frame } from '../shared/types.ts'
import { refsOf } from '../shared/frame-links.ts'
import { analyzeSelected, copyRecreate, exportBoard, lockParams, replay } from './actions'
import { getState, setState } from './store'
import { askClaude } from './folder/ClaudeTask'
import { FOLDER_ONLY } from './folder/folder'

export type Stage = 'measured' | 'recreated' | 'tuned'
export const STAGES: Stage[] = ['measured', 'recreated', 'tuned']
export const STAGE_LABEL: Record<Stage, string> = { measured: 'Measured', recreated: 'Recreated', tuned: 'Tuned' }

// A post (Instagram, LinkedIn) can't be measured: it's a look reference, not a motion one.
const isRef = (f: Frame) => f.type === 'video' || (f.type === 'url' && !f.post)
/** Coded copies linked to a reference (the scaffold a site capture adds counts too). */
const copiesOf = (f: Frame, frames: Frame[]) => frames.filter((c) => c.type === 'code' && refsOf(c).includes(f.id))

/** How far a frame is through measure → recreate → tune, or null when it isn't part of it. */
export function stageOf(f: Frame, frames: Frame[]): Stage | null {
  return stages(frames).get(f.id) ?? null
}

// Every block reads its stage on each store change (each pointer move of a drag), so the
// whole board's stages are worked out once per frames array instead of per block.
const cache = new WeakMap<Frame[], Map<string, Stage>>()
function stages(frames: Frame[]) {
  let m = cache.get(frames)
  if (m) return m
  m = new Map()
  const byId = new Map(frames.map((f) => [f.id, f]))
  const copies = new Map<string, Frame[]>()
  for (const c of frames) if (c.type === 'code') for (const r of refsOf(c)) copies.set(r, [...(copies.get(r) ?? []), c])
  for (const f of frames) {
    let st: Stage | null = null
    if (isRef(f)) {
      const cs = copies.get(f.id) ?? []
      st = cs.some((c) => c.tuned) ? 'tuned' : cs.some((c) => c.file?.endsWith('.tsx')) ? 'recreated' : f.analysis ? 'measured' : null
    } else if (f.type === 'code' && refsOf(f).length) {
      if (refsOf(f).some((r) => { const ref = byId.get(r); return !!ref && isRef(ref) })) st = f.tuned ? 'tuned' : 'recreated'
    }
    if (st) m.set(f.id, st)
  }
  cache.set(frames, m)
  return m
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
    if (!f.analysis) return { label: 'Analyze motion', hint: f.segment ? 'Measure timing and easing in the marked part' : 'Measure timing and easing (I / O mark a part)', run: analyzeSelected }
    if (!copiesOf(f, frames).length) return { label: 'Copy /recreate', hint: 'Copy the command for Claude Code', run: copyRecreate }
    return { label: 'Replay with copy', hint: 'Play the reference and its copy side by side', kbd: 'R', run: () => replay() }
  }
  if (f.type === 'url' && !f.post) {
    if (!f.analysis)
      return FOLDER_ONLY
        ? { label: 'Capture with Claude', hint: 'Claude records its timing in your Chrome', run: () => askClaude('capture', f.id) }
        : { label: 'Capture motion', hint: 'Pick an element and record its timing', run: () => setState({ picking: f.id }) }
    if (!copiesOf(f, frames).some((c) => c.file?.endsWith('.tsx')))
      return { label: 'Copy /recreate', hint: 'Copy the command for Claude Code', run: copyRecreate }
    return { label: 'Replay with copy', hint: 'Play the reference and its copy side by side', kbd: 'R', run: () => replay() }
  }
  if (f.type === 'code' && refsOf(f).length && stageOf(f, frames)) {
    if (s.overrides[f.id]) return { label: 'Save tuning', hint: 'Write the tuned values into the code', kbd: '⌘S', run: () => lockParams() }
    if (!f.tuned) return { label: 'Replay side by side', hint: 'Compare, then tune in the panel', kbd: 'R', run: () => replay() }
    return { label: 'Export spec', hint: 'motion.md, tokens and snippets for this pair', run: () => exportBoard() }
  }
  return null
}
