import { useLayoutEffect, useRef, useState, type KeyboardEvent as RKE } from 'react'
import type { BoardComment, Frame } from '../../shared/types.ts'
import { frameById, getState, screenToWorld, setState, useCamera, useStore, viewLeft } from '../store'
import { drag } from '../drag'
import { CheckIcon, MoreIcon, ReopenIcon, SendIcon, TrashIcon } from '../ui/icons'
import { drop, grab } from '../ui/sound'
import { ago, deleteComment, deleteMessage, editMessage, movePin, openThread, pad, pinTarget, postDraft, reply, resolve, stemOf, stepComment } from './comments'

// Drawn in the canvas's world, at each pin's spot, scaled by --inv so pins and threads stay the
// same size on screen at any zoom. Everything here carries .comment-ui, so comment mode's
// click-to-pin leaves it alone.

/** How far a key's center stands off the border, in screen pixels; the stem stops at the key's edge. */
const STEM = 26
const KEY_HALF = 12

export function CommentLayer() {
  const comments = useStore((s) => s.board?.comments)
  const frames = useStore((s) => s.board?.frames)
  const commenting = useStore((s) => s.commenting)
  const pins = useStore((s) => s.pins)
  const thread = useStore((s) => s.thread)
  const draft = useStore((s) => s.draft)
  const view = useStore((s) => s.commentView)
  const comparing = useStore((s) => !!s.compare)
  // How far a key reaches past the border, in canvas units: it depends on the zoom, so the
  // layer redraws when the zoom changes enough to matter.
  const zoom = useCamera((c) => 2 ** (Math.round(Math.log2(c.z) * 4) / 4))
  if (!frames || comparing) return null
  const reach = (STEM + KEY_HALF + 4) / zoom

  const draftStem = draft && stemOf(draft, frames, reach)
  const nextN = Math.max(0, ...(comments ?? []).map((c) => c.n)) + 1

  return (
    <>
      {(comments ?? []).map((c) => {
        const stem = stemOf(c, frames, reach)
        if (!stem) return null
        // In comment mode the toolbar's side shows (Open or Done); outside it only open pins,
        // and none with ⇧C off.
        if (commenting ? !!c.resolved !== (view === 'done') : c.resolved || !pins) return null
        return (
          <Stemmed key={c.id} stem={stem} open={thread === c.id}>
            <Pin c={c} on={thread === c.id} />
            {thread === c.id && <Thread c={c} />}
          </Stemmed>
        )
      })}
      <PinDragPreview />
      {draftStem && (
        <Stemmed stem={draftStem} open>
          <span className="pin" data-on data-new>
            <span className="pin-key">{pad(nextN)}</span>
          </span>
          <Draft />
        </Stemmed>
      )}
    </>
  )
}

/**
 * A pin on its stem: the stem and its foot on the border, the key (and its thread) at the end.
 * The exact spot shows as a dot, with a faint trace from the foot, while the pin is hovered or open.
 */
function Stemmed({ stem, open, children }: { stem: NonNullable<ReturnType<typeof stemOf>>; open?: boolean; children: React.ReactNode }) {
  const { spot, foot, n } = stem
  const dx = spot.x - foot.x
  const dy = spot.y - foot.y
  return (
    <div className="cmt-group" data-open={open || undefined}>
      {/* Right by the border the foot already marks the spot. */}
      {n && Math.hypot(dx, dy) > 12 && (
        <>
          <span
            className="pin-trace"
            style={{ left: foot.x, top: foot.y, width: Math.hypot(dx, dy), transform: `rotate(${Math.atan2(dy, dx)}rad)` }}
          />
          <span className="pin-spot" style={{ left: spot.x, top: spot.y }} />
        </>
      )}
      <div
        className="comment-ui comment-anchor"
        data-raised={open || undefined}
        style={{ left: foot.x, top: foot.y }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.ctrlKey || e.metaKey || e.stopPropagation()}
      >
        {n && (
          <>
            <span className="pin-stem" style={{ width: STEM - KEY_HALF, transform: `rotate(${Math.atan2(n.y, n.x)}rad)` }} />
            <span className="pin-foot" />
          </>
        )}
        <div className="pin-head" data-side={n && n.x < 0 ? 'left' : undefined} style={n ? { left: n.x * STEM, top: n.y * STEM } : undefined}>
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * Drag a pin to move it: into a block to point there (tagging or re-tagging it), just past its
 * own block's border to put the key on that side, or onto empty canvas to untag it. A short
 * press is a click (opens the thread); Esc while dragging puts it back.
 */
function pressPin(e: React.PointerEvent, c: BoardComment, skipClick: { current: boolean }) {
  if (e.button !== 0) return
  grab()
  const s0 = getState()
  const wasOpen = s0.thread === c.id
  let cancelled = false
  const esc = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    ev.stopPropagation()
    cancelled = true
    setState({ pinDrag: null })
  }
  drag(
    e,
    (_dx, _dy, ev) => {
      if (cancelled) return
      const s = getState()
      const at = screenToWorld(ev.clientX, ev.clientY)
      const near = (STEM + KEY_HALF) / s.camera.z
      if (!s.pinDrag) {
        window.addEventListener('keydown', esc, true)
        setState({ commenting: true, thread: null, draft: null })
      }
      setState({ pinDrag: { id: c.id, at, target: pinTarget(c, at, s.board?.frames ?? [], near) } })
    },
    (moved) => {
      window.removeEventListener('keydown', esc, true)
      if (!moved) return drop()
      // The click a drag ends with (if any) comes right after this; don't let it open the thread.
      skipClick.current = true
      setTimeout(() => (skipClick.current = false), 0)
      const d = getState().pinDrag
      setState({ pinDrag: null })
      if (cancelled || !d) return drop()
      movePin(c.id, d.target)
      if (wasOpen) setState({ thread: c.id })
    },
    4,
  )
}

function Pin({ c, on }: { c: BoardComment; on: boolean }) {
  const first = c.messages[0]?.text ?? ''
  const skipClick = useRef(false)
  const dragging = useStore((s) => s.pinDrag?.id === c.id)
  return (
    <button
      className="pin"
      data-on={on || undefined}
      data-resolved={c.resolved || undefined}
      data-dragging={dragging || undefined}
      data-comment={c.id}
      aria-label={`Comment ${c.n}: ${first}`}
      title={on || dragging ? undefined : first}
      onPointerDown={(e) => pressPin(e, c, skipClick)}
      onClick={() => {
        if (skipClick.current) return void (skipClick.current = false)
        if (getState().thread === c.id) setState({ thread: null })
        else openThread(c.id, false)
      }}
    >
      <span className="pin-key">
        {pad(c.n)}
      </span>
    </button>
  )
}

/** Opens on the side its stem points to (right unless it's on a left border), flipping when the screen edge is too close. */
function useSide() {
  const ref = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const panel = document.querySelector('.inspector[data-open]')?.getBoundingClientRect().left ?? window.innerWidth
    const wantsLeft = (el.parentElement as HTMLElement | null)?.dataset.side === 'left'
    // Already drawn on its side; flip when that side runs under the sidebar or the side panel.
    if (wantsLeft ? r.left < viewLeft() + 12 : r.right > Math.min(window.innerWidth, panel) - 12) setLeft(true)
  }, [])
  return { ref, left }
}

/** Grows with what's typed (up to a few lines, then scrolls). */
function grow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = '0px'
  el.style.height = `${Math.min(el.scrollHeight, 132)}px`
}

function Composer({
  placeholder,
  initial = '',
  onSubmit,
  onCancel,
  onResolve,
  empty,
  focus = true,
}: {
  placeholder: string
  initial?: string
  onSubmit: (text: string) => void
  onCancel: () => void
  onResolve?: () => void
  empty: string
  /** start with the cursor in it (a new pin, an edit); a thread's reply box waits for a click */
  focus?: boolean
}) {
  const [text, setText] = useState(initial)
  const [error, setError] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    grow(el)
    if (!focus) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  const submit = () => {
    if (!text.trim()) return setError(empty)
    onSubmit(text)
    setText('')
    requestAnimationFrame(() => grow(ref.current))
  }
  const onKey = (e: RKE) => {
    e.stopPropagation()
    if (e.key === 'Escape') onCancel()
    else if (e.key === 'Tab' && !text) {
      // Nothing typed: Tab still flips through the comments.
      e.preventDefault()
      stepComment(e.shiftKey ? -1 : 1)
    }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onResolve) {
      e.preventDefault()
      onResolve()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }
  return (
    <>
      <div className="cmt-compose">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value)
            setError('')
            grow(e.target)
          }}
          onKeyDown={onKey}
        />
        <button className="cmt-send" data-ready={!!text.trim() || undefined} onClick={submit} aria-label="Post" title="Post  ↵">
          <SendIcon />
        </button>
      </div>
      {error && <div className="cmt-error">{error}</div>}
    </>
  )
}

function Draft() {
  const { ref, left } = useSide()
  return (
    <div ref={ref} className="cmt-card" data-left={left || undefined} role="dialog" aria-label="New comment">
      <Composer placeholder="Add a comment" empty="Type a comment first" onSubmit={postDraft} onCancel={() => setState({ draft: null })} />
    </div>
  )
}

function Thread({ c }: { c: BoardComment }) {
  const { ref, left } = useSide()
  const [menu, setMenu] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [folding, setFolding] = useState(false)
  // After a reply the box keeps the cursor, for the next one.
  const [replied, setReplied] = useState(false)
  const block = c.on ? frameById(c.on) : undefined
  const where = block ? block.label || block.type[0].toUpperCase() + block.type.slice(1) : 'Canvas'

  // Resolving: the ✓ goes down, the card folds into its key, then the key flies off the board
  // into the toolbar's Done count, which rolls up; the next open comment opens after that.
  const done = () => {
    if (c.resolved) return resolve(c.id)
    if (folding) return
    setFolding(true)
    setTimeout(() => flyToTray(c.id).then(() => resolve(c.id)), 260)
  }

  return (
    <div
      ref={ref}
      className="cmt-card"
      data-left={left || undefined}
      data-resolved={c.resolved || undefined}
      data-folding={folding || undefined}
      role="dialog"
      aria-label={`Comment ${c.n}`}
      onPointerDown={() => menu && setMenu(null)}
    >
      <header className="cmt-head">
        <span className="pin-key pin-key-sm">{pad(c.n)}</span>
        <span className="cmt-where">{where}</span>
        <button
          className="cmt-resolve"
          data-down={c.resolved || folding || undefined}
          onClick={done}
          aria-label={c.resolved ? 'Reopen' : 'Resolve'}
          title={c.resolved ? 'Reopen' : 'Resolve  ⌘↵'}
        >
          {c.resolved ? <ReopenIcon /> : <CheckIcon />}
        </button>
        {c.resolved && (
          <button className="cmt-resolve" onClick={() => deleteComment(c.id)} aria-label="Delete" title="Delete  ⌫">
            <TrashIcon />
          </button>
        )}
      </header>
      <ol className="cmt-msgs" data-long={c.messages.length > 5 || undefined}>
        {c.messages.map((m, i) => (
          <li key={m.id} className="cmt-msg" data-first={i === 0 || undefined} data-editing={editing === m.id || undefined}>
            {editing === m.id ? (
              <Composer
                placeholder="Edit"
                initial={m.text}
                empty="Type something, or delete it"
                onSubmit={(t) => (editMessage(c.id, m.id, t), setEditing(null))}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <>
                <div className="cmt-text">{m.text}</div>
                <div className="cmt-meta">
                  {ago(m.at)}
                  {m.edited && ' · edited'}
                </div>
                <div className="cmt-more" data-open={menu === m.id || undefined}>
                  <button
                    className="cmt-icon"
                    aria-label="More"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setMenu(menu === m.id ? null : m.id)}
                  >
                    <MoreIcon />
                  </button>
                  {menu === m.id && (
                    <div className="cmt-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
                      <button role="menuitem" onClick={() => (setEditing(m.id), setMenu(null))}>
                        Edit
                      </button>
                      <button role="menuitem" onClick={() => (setMenu(null), deleteMessage(c.id, m.id))}>
                        {i === 0 ? 'Delete comment' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ol>
      {c.resolved ? (
        <div className="cmt-done">Resolved</div>
      ) : (
        !editing && (
          <Composer
            key={c.messages.length}
            placeholder="Reply"
            focus={replied}
            empty="Type a reply first"
            onSubmit={(t) => (reply(c.id, t), setReplied(true))}
            onCancel={() => setState({ thread: null })}
            onResolve={done}
          />
        )
      )}
    </div>
  )
}

/** The pin's key arcs from the board into the toolbar's Done count (resolves once it lands). */
async function flyToTray(id: string) {
  const pin = document.querySelector<HTMLElement>(`.pin[data-comment="${id}"]`)
  const key = pin?.querySelector<HTMLElement>('.pin-key')
  const tray = document.querySelector<HTMLElement>('.cmt-seg [data-done]')
  if (!pin || !key || !tray || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const from = key.getBoundingClientRect()
  const to = tray.getBoundingClientRect()
  const clone = key.cloneNode(true) as HTMLElement
  Object.assign(clone.style, { position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, margin: '0', zIndex: '100', pointerEvents: 'none' })
  clone.classList.add('pin-flying')
  document.body.appendChild(clone)
  pin.style.visibility = 'hidden'
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  // Up first, then down into the bar: a short arc, not a straight slide.
  const lift = Math.min(90, 40 + Math.abs(dy) * 0.15)
  grab()
  await clone.animate(
    [
      { transform: 'translate(0, 0) scale(1) rotate(0)' },
      // It pops off the board first, then arcs over.
      { transform: 'translate(0, -16px) scale(1.18) rotate(-4deg)', offset: 0.16 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(1.08) rotate(-10deg)`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.45) rotate(0)`, opacity: 0.4 },
    ],
    { duration: 700, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' },
  ).finished
  clone.remove()
  pin.style.visibility = ''
  tray.closest('.cmt-seg')?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], {
    duration: 260,
    easing: 'cubic-bezier(0.3, 1.6, 0.5, 1)',
  })
}

/** While a pin is dragged: its key under the cursor, the block it would land on, and what the drop does. */
function PinDragPreview() {
  const d = useStore((s) => s.pinDrag)
  const c = useStore((s) => (s.pinDrag ? s.board?.comments?.find((x) => x.id === s.pinDrag!.id) : undefined))
  const target = useStore((s) => {
    const t = s.pinDrag?.target
    const id = t?.kind === 'block' ? t.on : t?.kind === 'side' ? c?.on : undefined
    return id ? frameById(id) : undefined
  })
  if (!d || !c) return null
  const t = d.target
  const name = (f?: Frame) => (f ? f.label || f.type[0].toUpperCase() + f.type.slice(1) : '')
  const label =
    t.kind === 'canvas'
      ? 'On canvas'
      : t.kind === 'side'
        ? `${{ l: 'Left', r: 'Right', t: 'Top', b: 'Bottom' }[t.side]} side`
        : t.on === c.on
          ? 'Move here'
          : `Pin to ${name(target)}`
  return (
    <>
      {target && (
        <div
          className="pin-drop-target"
          data-side={t.kind === 'side' ? t.side : undefined}
          style={{ left: target.x, top: target.y, width: target.w, height: target.h }}
        />
      )}
      <div className="comment-ui comment-anchor pin-ghost" style={{ left: d.at.x, top: d.at.y }}>
        <span className="pin" data-on>
          <span className="pin-key">{pad(c.n)}</span>
        </span>
        <span className="pin-drop-label">{label}</span>
      </div>
    </>
  )
}
