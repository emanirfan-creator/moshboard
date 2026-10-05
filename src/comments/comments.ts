// Comments: pins with a thread, left on the board for yourself (while reviewing it, or while
// showing it to someone). They live in board.json's `comments`, go through undo like frames,
// and never touch the frames themselves. C turns comment mode on; the toolbar then flips
// through them. Outside comment mode only open pins show, and ⇧C hides those too.
import type { BoardComment, Frame } from '../../shared/types.ts'
import { isSection } from '../../shared/sections.ts'
import { glideTo } from '../canvas/follow'
import { getState, inspectorOpen, INSPECTOR_W, mutateComments, setState, toast, viewLeft, type State } from '../store'
import { cue, drop, grab } from '../ui/sound'

const newId = () => Math.random().toString(36).slice(2, 8)
const now = () => new Date().toISOString()

/** Where a comment's pin is on the canvas, or null when its block is gone. */
export function pinAt(c: BoardComment, frames: Frame[]) {
  if (!c.on) return { x: c.x, y: c.y }
  const f = frames.find((f) => f.id === c.on)
  return f ? { x: f.x + c.x * f.w, y: f.y + c.y * f.h } : null
}

/**
 * How a pin is drawn: its key stands just off the block's nearest border on a short stem, so it
 * never covers the block; `foot` is where the stem meets the border, `n` the way it points out.
 * A pin on the canvas itself has its key right on the spot.
 */
export function stemOf(c: Pick<BoardComment, 'on' | 'x' | 'y'>, frames: Frame[]) {
  if (!c.on) return { spot: { x: c.x, y: c.y }, foot: { x: c.x, y: c.y }, n: null }
  const f = frames.find((f) => f.id === c.on)
  if (!f) return null
  const spot = { x: f.x + c.x * f.w, y: f.y + c.y * f.h }
  const d = { l: spot.x - f.x, r: f.x + f.w - spot.x, t: spot.y - f.y, b: f.y + f.h - spot.y }
  const side = (Object.keys(d) as (keyof typeof d)[]).reduce((a, k) => (d[k] < d[a] ? k : a))
  const foot = {
    l: { x: f.x, y: spot.y },
    r: { x: f.x + f.w, y: spot.y },
    t: { x: spot.x, y: f.y },
    b: { x: spot.x, y: f.y + f.h },
  }[side]
  const n = { l: { x: -1, y: 0 }, r: { x: 1, y: 0 }, t: { x: 0, y: -1 }, b: { x: 0, y: 1 } }[side]
  return { spot, foot, n }
}

/** The comments that have a pin on the canvas (not on a deleted block), in pin order. */
export const placed = (s: State) => placedOf(s.board?.comments, s.board?.frames)
export const placedOf = (comments: BoardComment[] = [], frames: Frame[] = []) =>
  comments.filter((c) => pinAt(c, frames)).sort((a, b) => a.n - b.n)

/** The comments the toolbar flips through: open ones, or resolved ones on the Done side. */
export const inView = (s: State) => placed(s).filter((c) => !!c.resolved === (s.commentView === 'done'))

/** A pin dropped at a canvas point sticks to the smallest block under it (a section if nothing else). */
function anchor(at: { x: number; y: number }, frames: Frame[]) {
  const under = frames
    .filter((f) => at.x >= f.x && at.x <= f.x + f.w && at.y >= f.y && at.y <= f.y + f.h)
    .sort((a, b) => Number(isSection(a)) - Number(isSection(b)) || a.w * a.h - b.w * b.h)[0]
  return under ? { on: under.id, x: (at.x - under.x) / under.w, y: (at.y - under.y) / under.h } : { x: at.x, y: at.y }
}

export function setCommenting(on = !getState().commenting) {
  const s = getState()
  if (on === s.commenting) return
  cue(on ? 'toggle-on' : 'toggle-off')
  // Clicks drop pins now, so nothing stays in "interact" (a live frame would take the click).
  setState({ commenting: on, thread: null, draft: null, commentTray: false, commentView: 'open', ...(on ? { interact: null, hand: false } : {}) })
  // Comment mode starts on the first open comment, not on an empty counter.
  const first = on && placed(getState()).find((c) => !c.resolved)
  if (first) openThread(first.id)
}

/** Comment mode: a click on the canvas starts a pin there (or closes the open thread first). */
export function pressCanvas(at: { x: number; y: number }) {
  const s = getState()
  if (s.thread || s.draft) return setState({ thread: null, draft: null })
  setState({ draft: anchor(at, s.board?.frames ?? []), commentView: 'open' })
  grab()
}

export function postDraft(text: string) {
  const s = getState()
  if (!s.draft || !text.trim()) return
  const n = Math.max(0, ...(s.board?.comments ?? []).map((c) => c.n)) + 1
  const c: BoardComment = { id: newId(), n, ...s.draft, messages: [{ id: newId(), text: text.trim(), at: now() }] }
  mutateComments((cs) => [...cs, c])
  setState({ draft: null, thread: null })
  drop()
}

const edit = (id: string, fn: (c: BoardComment) => BoardComment | null) =>
  mutateComments((cs) => cs.flatMap((c) => (c.id === id ? (fn(c) ?? []) : [c])))

/** After a delete the pins count 1, 2, 3… again, in the order they were made (⌘Z brings the old numbers back). */
const renumber = (cs: BoardComment[]) =>
  [...cs].sort((a, b) => a.n - b.n).map((c, i) => (c.n === i + 1 ? c : { ...c, n: i + 1 }))

export function reply(id: string, text: string) {
  if (!text.trim()) return
  edit(id, (c) => ({ ...c, messages: [...c.messages, { id: newId(), text: text.trim(), at: now() }] }))
  drop()
}

export function editMessage(id: string, mid: string, text: string) {
  if (!text.trim()) return
  edit(id, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === mid ? { ...m, text: text.trim(), edited: true } : m)) }))
}

/** Deleting the first message deletes the whole comment (its replies answer it). */
export function deleteMessage(id: string, mid: string) {
  const c = getState().board?.comments?.find((c) => c.id === id)
  if (!c) return
  if (c.messages[0]?.id === mid || c.messages.length === 1) return deleteComment(id)
  edit(id, (c) => ({ ...c, messages: c.messages.filter((m) => m.id !== mid) }))
  cue('remove')
}

/** Delete a whole comment (a resolved one from its card, or any from its menu). ⌘Z brings it back. */
export function deleteComment(id: string) {
  mutateComments((cs) => renumber(cs.filter((c) => c.id !== id)))
  setState({ thread: null })
  cue('remove')
  toast('Comment deleted  ·  ⌘Z to undo')
}

/** Done side's Clear: every resolved comment, for good once the canvas is reopened (⌘Z until then). */
export function clearResolved() {
  const n = placed(getState()).filter((c) => c.resolved).length
  if (!n) return
  const gone = new Set(placed(getState()).filter((c) => c.resolved).map((c) => c.id))
  mutateComments((cs) => renumber(cs.filter((c) => !gone.has(c.id))))
  setState({ thread: null, commentView: 'open' })
  cue('remove')
  toast(`Deleted ${n} resolved comment${n > 1 ? 's' : ''}  ·  ⌘Z to undo`)
}

/** Resolve (or reopen) a comment. Resolving moves on to the next open one, if there is one. */
export function resolve(id: string) {
  const s = getState()
  const c = s.board?.comments?.find((c) => c.id === id)
  if (!c) return
  const done = !c.resolved
  edit(id, (c) => ({ ...c, resolved: done || undefined }))
  if (!done) cue('toggle-off')
  else {
    drop()
    setTimeout(() => cue('confirm'), 90)
  }
  if (!done) return setState({ commentView: 'open', thread: id })
  // The key has gone to the tray; the next open comment opens after a beat.
  setState({ thread: null })
  const open = placed(getState()).filter((x) => !x.resolved)
  const next = open.find((x) => x.n > c.n) ?? open[0]
  if (next && s.commentView === 'open') setTimeout(() => getState().commenting && !getState().thread && openThread(next.id), 520)
}

/** Open a comment's thread (entering comment mode) and bring its pin into view. */
export function openThread(id: string, glide = true) {
  const s = getState()
  const c = s.board?.comments?.find((c) => c.id === id)
  const at = c && pinAt(c, s.board!.frames)
  if (!c || !at) return
  setState({ commenting: true, thread: id, commentCursor: id, draft: null, interact: null, commentView: c.resolved ? 'done' : 'open' })
  if (!glide) return
  // Centered at the current zoom, a little left of center so the thread beside it fits.
  const left = viewLeft()
  const right = window.innerWidth - (inspectorOpen(s) ? INSPECTOR_W : 0)
  const z = s.camera.z
  const x = left + (right - left) / 2 - 140
  glideTo({ x: x - at.x * z, y: window.innerHeight / 2 - 40 - at.y * z, z })
}

/** Tab / ⇧Tab and the toolbar arrows: the next or previous comment on the side shown. */
export function stepComment(dir: 1 | -1) {
  const s = getState()
  const list = inView(s)
  if (!list.length) return toast(s.commentView === 'open' ? 'No open comments' : 'Nothing resolved yet')
  const i = list.findIndex((c) => c.id === (s.thread ?? s.commentCursor))
  // Nothing open: the first press opens the one the counter shows; after that it moves.
  const next = !s.thread ? list[Math.max(0, i)] : list[(i + dir + list.length) % list.length]
  grab()
  openThread(next.id)
}

export function setCommentView(view: State['commentView']) {
  if (view === getState().commentView) return
  setState({ commentView: view, thread: null })
  cue('tap')
  // Each side starts on its first comment, not an empty counter.
  const first = inView(getState())[0]
  if (first) openThread(first.id)
}

/** "2m", "3h", "4d", then the date. */
export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export const pad = (n: number) => String(n).padStart(2, '0')

/** Open comments as a numbered list for a Claude prompt: where each is, what it says, and its replies. */
export function openCommentsText(s: State) {
  const frames = s.board?.frames ?? []
  return placed(s)
    .filter((c) => !c.resolved)
    .map((c, i) => {
      const f = c.on ? frames.find((f) => f.id === c.on) : undefined
      const where = f ? `on "${f.label || f.type}" (frame ${f.id})` : 'on the canvas'
      const [first, ...replies] = c.messages.map((m) => m.text.replace(/\s*\n\s*/g, ' '))
      return `${i + 1}. ${where}: ${first}${replies.length ? ` (then: ${replies.join(' / ')})` : ''}`
    })
    .join('\n')
}
