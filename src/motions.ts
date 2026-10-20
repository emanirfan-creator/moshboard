// Saved animations in the app: save one from the side panel, use it on another animation, copy
// its code, rename or delete it. The list lives in the boards folder (shared/motions.ts), so every
// canvas there sees the same one.
import { api } from './api'
import { motionControls, setParams } from './actions'
import { copyText } from './clipboard'
import { frameById, getState, setState, toast } from './store'
import { freeName, motionCode, motionsMarkdown, type CodeKind, type SavedMotion } from '../shared/motions.ts'
import type { Bezier, Param, ParamValue, Spring } from '../shared/params.ts'

const isMs = (p?: Param) => p?.kind === 'number' && p.unit === 'ms'

let asked = 0
export async function loadMotions() {
  const n = ++asked
  const lib = await api.motions().catch(() => null)
  if (n === asked) setState({ motions: lib?.motions ?? [] })
}

async function persist(motions: SavedMotion[]) {
  setState({ motions })
  try {
    await api.saveMotions(motions, motionsMarkdown(motions))
  } catch (e) {
    toast(`Couldn’t save animations: ${(e as Error).message}`, true)
  }
}

/**
 * The controls one animation in a code block has: `timing` is the block's own @param timing,
 * anything else a detected (or measured) animation's id.
 */
function slotFor(frameId: string, key: string) {
  const c = motionControls(frameId)
  if (!c) return null
  let list: Param[]
  if (key === 'timing') list = c.params.filter((p) => c.own.has(p.name))
  else list = c.groups.find((g) => g.id === key)?.params ?? []
  const named = (re: RegExp) => list.find((p) => isMs(p) && re.test(key === 'timing' ? p.name : (p.label ?? '')))
  const slot = {
    duration: named(/^(duration|dur)$/i),
    delay: named(/^delay$/i),
    ease: list.find((p) => p.kind === 'ease'),
    spring: list.find((p) => p.kind === 'spring'),
  }
  return { slot, values: c.values }
}

/** The side panel's animation the user last touched: "Use" puts a saved one there. */
export function touchMotion(frame: string, key: string, name: string) {
  const t = getState().motionTarget
  if (t?.frame === frame && t.key === key && t.name === name) return
  setState({ motionTarget: { frame, key, name } })
}

/** The target, while its block is still selected (its animations are what the side panel shows). */
export function currentTarget() {
  const s = getState()
  const t = s.motionTarget
  return t && s.selected.length === 1 && s.selected[0] === t.frame && frameById(t.frame) ? t : null
}

export function saveAnimation(frameId: string, key: string, name: string) {
  const found = slotFor(frameId, key)
  const f = frameById(frameId)
  if (!found || !f) return
  const { slot, values } = found
  const v = (p?: Param) => (p ? values[p.name] : undefined)
  const motion: SavedMotion = {
    id: Math.random().toString(36).slice(2, 10),
    name: freeName(getState().motions ?? [], name),
    ...(slot.duration ? { duration: Math.round(v(slot.duration) as number) } : {}),
    ...(slot.delay && v(slot.delay) ? { delay: Math.round(v(slot.delay) as number) } : {}),
    ...(slot.ease ? { ease: v(slot.ease) as Bezier } : {}),
    ...(slot.spring ? { spring: v(slot.spring) as Spring } : {}),
    from: { board: getState().boardName, boardName: getState().board?.name, frame: f.id, block: f.label },
    saved: new Date().toISOString(),
  }
  if (motion.duration === undefined && !motion.spring) return toast('Nothing to save: this animation has no timing', true)
  persist([...(getState().motions ?? []), motion])
  toast(`Saved “${motion.name}” to Animations`)
  return motion.name
}

/** Put a saved animation's timing on the target animation, as unsaved tweaks (the changed dots show). */
export function applyMotion(m: SavedMotion) {
  const t = currentTarget()
  if (!t) return toast('Open an animation in the side panel first', true)
  const found = slotFor(t.frame, t.key)
  if (!found) return
  const { slot } = found
  const changes: Record<string, ParamValue> = {}
  if (slot.duration && m.duration !== undefined) changes[slot.duration.name] = m.duration
  if (slot.delay) changes[slot.delay.name] = m.delay ?? 0
  if (slot.ease && m.ease) changes[slot.ease.name] = m.ease
  if (slot.spring && m.spring) changes[slot.spring.name] = m.spring
  const fits = Object.keys(changes).filter((k) => k !== slot.delay?.name).length
  if (!fits)
    return toast(m.spring ? `“${m.name}” is a spring; ${t.name} isn’t` : slot.spring ? `${t.name} is a spring; “${m.name}” isn’t` : `“${m.name}” doesn’t fit ${t.name}`, true)
  setParams(t.frame, changes)
  setState({ motionsOpen: false })
  const missed = (m.ease && !slot.ease) || (m.spring && !slot.spring)
  toast(`Used “${m.name}” on ${t.name}${missed ? ' (only its length fit)' : ''}`)
}

export async function copyMotion(m: SavedMotion, kind: CodeKind) {
  const label = kind === 'motion' ? 'for Motion' : kind === 'css' ? 'as CSS' : 'for GSAP'
  if (await copyText(motionCode(m, kind))) toast(`Copied “${m.name}” ${label}`)
  else toast('Couldn’t copy to the clipboard', true)
}

export function renameMotion(id: string, name: string) {
  const list = getState().motions ?? []
  const others = list.filter((m) => m.id !== id)
  const clean = name.trim()
  if (!clean) return
  persist(list.map((m) => (m.id === id ? { ...m, name: freeName(others, clean) } : m)))
}

export function deleteMotion(id: string) {
  const list = getState().motions ?? []
  const gone = list.find((m) => m.id === id)
  persist(list.filter((m) => m.id !== id))
  if (gone) toast(`Deleted “${gone.name}”`)
}
