import type { Frame } from '../../shared/types.ts'
import { linksOf } from '../../shared/frame-links.ts'
import { frameById, getState, inspectorOpen, INSPECTOR_W, setCamera, setState, toast, viewLeft, type Camera } from '../store'

// Following links: click a link line to go to its other end, L to step through a block's
// linked blocks, ⌥← to go back to where you were.

/** Where you were before each jump, newest last. */
const trail: { selected: string[]; camera: Camera }[] = []

let glide = 0
/** Ease the view to a camera instead of cutting to it. */
function glideTo(to: Camera) {
  cancelAnimationFrame(glide)
  const from = getState().camera
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setCamera(to)
  const start = performance.now()
  const step = (t: number) => {
    const k = Math.min(1, (t - start) / 320)
    const e = 1 - (1 - k) ** 3
    setCamera({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z + (to.z - from.z) * e })
    if (k < 1) glide = requestAnimationFrame(step)
  }
  glide = requestAnimationFrame(step)
}

/** A view centered on a block, at the current zoom unless it needs zooming out to fit. */
function viewOf(f: Frame): Camera {
  const s = getState()
  const left = viewLeft()
  // The side panel opens for the block, so center it in what's left.
  const right = window.innerWidth - (inspectorOpen({ ...s, selected: [f.id] }) ? INSPECTOR_W : 0)
  const width = right - left
  const pad = Math.min(96, width / 4, window.innerHeight / 4)
  const z = Math.min(s.camera.z, (width - pad * 2) / f.w, (window.innerHeight - pad * 2) / f.h)
  return { x: left + width / 2 - (f.x + f.w / 2) * z, y: window.innerHeight / 2 - (f.y + f.h / 2) * z, z }
}

/** Go to a block and select it; `remember` keeps where you were for ⌥←. */
export function jumpTo(id: string, remember = true) {
  const f = frameById(id)
  if (!f) return
  const s = getState()
  if (remember) {
    trail.push({ selected: s.selected, camera: s.camera })
    if (trail.length > 50) trail.shift()
  }
  setState({ selected: [id], interact: null })
  glideTo(viewOf(f))
}

/** ⌥←: back to the view and selection before the last jump. */
export function jumpBack() {
  const t = trail.pop()
  if (!t) return toast('Nothing to go back to')
  cycle = null
  setState({ selected: t.selected.filter((id) => frameById(id)), interact: null })
  glideTo(t.camera)
}

/** Clicking a link line: go to the end farther from where you clicked. */
export function followLine(ref: string, follower: string, ends: { from: { x: number; y: number }; to: { x: number; y: number } }, at: { x: number; y: number }) {
  const d = (p: { x: number; y: number }) => Math.hypot(p.x - at.x, p.y - at.y)
  jumpTo(d(ends.from) > d(ends.to) ? ref : follower)
}

/** The blocks a line joins to one: the references it follows, then the blocks following it, by link number. */
export function linkedTo(id: string): string[] {
  const frames = getState().board?.frames ?? []
  const f = frameById(id)
  if (!f) return []
  const out: { id: string; n: number }[] = linksOf(f).map((l) => ({ id: l.ref, n: l.n }))
  for (const o of frames) for (const l of linksOf(o)) if (l.ref === id) out.push({ id: o.id, n: l.n })
  const seen = new Set<string>()
  return out
    .sort((a, b) => a.n - b.n)
    .map((x) => x.id)
    .filter((x) => frameById(x) && !seen.has(x) && seen.add(x))
}

/** L pressed again on where the last L landed steps on to the next one. */
let cycle: { from: string; list: string[]; i: number; at: string } | null = null

/** L: go to the selected block's linked block; again for the next one when it has several. */
export function jumpAlongLinks() {
  const sel = getState().selected
  if (sel.length !== 1) return toast('Select one block to follow its links')
  const going = cycle && cycle.at === sel[0] ? cycle : null
  const from = going ? going.from : sel[0]
  const list = going ? going.list : linkedTo(from)
  if (!list.length) return toast('This block has no links')
  const i = going ? (going.i + 1) % list.length : 0
  // Only the first jump of a run is remembered, so ⌥← goes back to where it started.
  jumpTo(list[i], !going)
  cycle = { from, list, i, at: list[i] }
  const f = frameById(list[i])
  if (list.length > 1) toast(`Linked · ${i + 1} of ${list.length}${f?.label ? ` · ${f.label}` : ''}`)
}
