import type { PointerEvent as RPE } from 'react'
import type { Frame } from '../../shared/types.ts'
import { sectionAt, withContents } from '../../shared/sections.ts'
import { growSections } from '../actions'
import { drag } from '../drag'
import { frameById, getState, mutateFrames, saveSoon, setState, updateFrame } from '../store'

const MIN = 24
/** A frame's draw offset outside Compare, and the marker for one Compare hides (compared by identity). */
export const NONE = { dx: 0, dy: 0 }
export const HIDDEN = { dx: 0, dy: 0 }
export const DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type Dir = (typeof DIRS)[number]
export const HANDLE_POS: Record<Dir, [number, number]> = {
  nw: [0, 0],
  n: [50, 0],
  ne: [100, 0],
  e: [100, 50],
  se: [100, 100],
  s: [50, 100],
  sw: [0, 100],
  w: [0, 50],
}

/**
 * Press on a frame: select it (Shift toggles) and drag the selection, sections with
 * everything in them. The section a block is dropped into lights up while it moves, and
 * grows to hold it if it sticks out.
 */
export function pressFrame(e: RPE, id: string) {
  const s = getState()
  if (e.button !== 0 || s.space || s.hand) return
  e.stopPropagation()
  let sel = s.selected
  if (e.shiftKey) sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]
  else if (!sel.includes(id)) sel = [id]
  setState({ selected: sel, interact: s.interact === id ? id : null, renaming: null })
  // Comparing is for looking: select, but don't move things around.
  if (s.compare) return
  const frames = s.board?.frames ?? []
  const moving = withContents(sel, frames)
  const starts = new Map(moving.map((m) => [m, frameById(m)!]).filter(([, f]) => f) as [string, Frame][])
  const skip = new Set(moving)
  // Where the dragged group's center lands decides its section.
  const all = [...starts.values()]
  const cx = all.length ? (Math.min(...all.map((f) => f.x)) + Math.max(...all.map((f) => f.x + f.w))) / 2 : 0
  const cy = all.length ? (Math.min(...all.map((f) => f.y)) + Math.max(...all.map((f) => f.y + f.h))) / 2 : 0
  const z = s.camera.z
  drag(
    e,
    (dx, dy) => {
      mutateFrames(
        (fs) =>
          fs.map((f) => {
            const st = starts.get(f.id)
            return st ? { ...f, x: Math.round(st.x + dx / z), y: Math.round(st.y + dy / z) } : f
          }),
        false,
      )
      const drop = sectionAt(cx + dx / z, cy + dy / z, getState().board?.frames ?? [], skip)?.id ?? null
      if (drop !== getState().dropSection) setState({ dropSection: drop })
    },
    (moved) => {
      if (!moved) return
      setState({ dropSection: null })
      growSections(moving)
      saveSoon()
    },
  )
}

export function resizeFrame(e: RPE, f0: Frame, dir: Dir) {
  e.stopPropagation()
  const z = getState().camera.z
  const ratio = f0.w / f0.h
  drag(
    e,
    (sdx, sdy, ev) => {
      const dx = sdx / z
      const dy = sdy / z
      let l = f0.x
      let t = f0.y
      let r = f0.x + f0.w
      let b = f0.y + f0.h
      if (dir.includes('w')) l += dx
      if (dir.includes('e')) r += dx
      if (dir.includes('n')) t += dy
      if (dir.includes('s')) b += dy
      if (ev.altKey) {
        if (dir.includes('w')) r -= dx
        if (dir.includes('e')) l -= dx
        if (dir.includes('n')) b -= dy
        if (dir.includes('s')) t -= dy
      }
      let w = Math.max(MIN, r - l)
      let h = Math.max(MIN, b - t)
      if (ev.shiftKey) {
        if (dir.length === 2) {
          if (w / h > ratio) w = h * ratio
          else h = w / ratio
        } else if (dir === 'e' || dir === 'w') h = w / ratio
        else w = h * ratio
      }
      let x = dir.includes('w') ? r - w : l
      let y = dir.includes('n') ? b - h : t
      if (ev.altKey) {
        x = f0.x + f0.w / 2 - w / 2
        y = f0.y + f0.h / 2 - h / 2
      } else if (ev.shiftKey && dir.length === 1) {
        if (dir === 'e' || dir === 'w') y = f0.y + (f0.h - h) / 2
        else x = f0.x + (f0.w - w) / 2
      }
      // A hand resize becomes the frame's own size again.
      updateFrame(f0.id, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), natural: undefined }, false)
    },
    (moved) => moved && saveSoon(),
  )
}
