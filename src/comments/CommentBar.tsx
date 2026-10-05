import { useEffect, useMemo, useRef } from 'react'
import { setState, useStore } from '../store'
import { cue, drop, grab } from '../ui/sound'
import { openThread, pad, placedOf, setCommentView, stepComment } from './comments'

/**
 * In the toolbar while commenting: ‹ 02 / 05 › flips through the comments (Tab / ⇧Tab), the
 * counter unfolds into every comment as a key, and Open / Done picks which ones.
 */
export function CommentBar() {
  const comments = useStore((s) => s.board?.comments)
  const frames = useStore((s) => s.board?.frames)
  const view = useStore((s) => s.commentView)
  const all = useMemo(() => placedOf(comments, frames), [comments, frames])
  const list = all.filter((c) => !!c.resolved === (view === 'done'))
  const thread = useStore((s) => s.thread)
  const cursor = useStore((s) => s.commentCursor)
  const tray = useStore((s) => s.commentTray)
  const open = all.filter((c) => !c.resolved).length
  const done = all.length - open
  // Done rolls up like an odometer when something is resolved (not when the bar first shows).
  const lastDone = useRef(done)
  const rolled = done > lastDone.current
  useEffect(() => void (lastDone.current = done), [done])
  // The open thread, else the last one opened, else the first: never an empty counter when there are comments.
  const at = Math.max(0, list.findIndex((c) => c.id === (thread ?? cursor)))
  const fold = () => {
    setState({ commentTray: !tray })
    cue('tap')
  }

  return (
    <div className="cmt-bar" data-tray={tray || undefined}>
      {tray ? (
        <div className="cmt-keys">
          {list.length ? (
            list.map((c) => (
              <button
                key={c.id}
                className="pin-key"
                data-on={c.id === thread || undefined}
                data-resolved={c.resolved || undefined}
                title={c.messages[0]?.text}
                onPointerDown={() => grab()}
                onPointerUp={() => drop()}
                onClick={() => openThread(c.id)}
              >
                {pad(c.n)}
              </button>
            ))
          ) : (
            <span className="cmt-none">{view === 'open' ? 'Nothing open' : 'Nothing resolved'}</span>
          )}
        </div>
      ) : (
        <>
          <button className="cmt-step" onClick={() => stepComment(-1)} aria-label="Previous comment" title="Previous  ⇧Tab">
            ‹
          </button>
          <button className="cmt-count" onClick={fold} title="Show every comment">
            {list.length ? pad(at + 1) : '--'} / {pad(list.length)}
          </button>
          <button className="cmt-step" onClick={() => stepComment(1)} aria-label="Next comment" title="Next  Tab">
            ›
          </button>
        </>
      )}
      {tray && (
        <button className="cmt-count cmt-word" onClick={fold} title="Fold">
          Fold
        </button>
      )}
      <div className="cmt-seg" role="tablist">
        <button role="tab" aria-selected={view === 'open'} onClick={() => setCommentView('open')}>
          Open <span className="cmt-roll">{open}</span>
        </button>
        <button role="tab" aria-selected={view === 'done'} onClick={() => setCommentView('done')} data-done>
          Done{' '}
          <span className="cmt-roll" key={done} data-roll={rolled || undefined}>
            {done}
          </span>
        </button>
      </div>
    </div>
  )
}
