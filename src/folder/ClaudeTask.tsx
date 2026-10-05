import { useEffect, useState } from 'react'
import { PixelCanvas } from '../components/ui/pixel-canvas'
import { copyText } from '../clipboard'
import { frameById, getState, setState, useStore } from '../store'
import { AppMark } from '../ui/AppMark'
import { Segmented } from '../ui/Segmented'

// Website: the jobs that need a browser the app controls (capture motion, snapshot a site that
// blocks previews, read a site's fonts) go to the user's own Claude Code or Codex. This sheet
// writes the request in plain words to copy; the skill installed in the folder
// (.claude/skills/moshboard-site) does the work, and the board updates live when it's done.

export type ClaudeTaskKind = 'capture' | 'snapshot' | 'fonts'

/** Opens the sheet for a site frame. */
export const askClaude = (kind: ClaudeTaskKind, frameId: string) => setState({ palette: false, claudeTask: { kind, frameId } })

const close = () => setState({ claudeTask: null })
/** The same greys as the setup cards and a block's loading shimmer. */
const PIXELS = ['#3a3b41', '#55575e', '#8a8f98']
const TRIGGERS = ['hover', 'click', 'load', 'scroll'] as const

/** The request, as Claude (or Codex) opened in the folder reads it. */
function instruction(kind: ClaudeTaskKind, frameId: string, part: string, trigger: string) {
  const s = getState()
  const f = frameById(frameId)
  const board = s.folder?.single ? 'the Moshboard board in this folder' : `my Moshboard board “${s.boardName}”`
  const site = `the website frame ${frameId} (${f?.src ?? 'site'})`
  if (kind === 'capture') return `On ${board}, capture the ${trigger} motion of ${part.trim() || 'the main button'} on ${site}.`
  if (kind === 'snapshot') return `On ${board}, take a snapshot of ${site}.`
  return `On ${board}, read the fonts of ${site}.`
}

export function ClaudeTask() {
  const task = useStore((s) => s.claudeTask)
  const folder = useStore((s) => s.folder?.name)
  const [part, setPart] = useState('')
  const [trigger, setTrigger] = useState<(typeof TRIGGERS)[number]>('hover')
  const [copied, setCopied] = useState(false)
  const [hover, setHover] = useState(false)

  useEffect(() => {
    setCopied(false)
    if (!task) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [task])

  if (!task) return null
  const f = frameById(task.frameId)
  const host = f?.src ? new URL(f.src).host.replace(/^www\./, '') : 'the site'
  const copy = () =>
    copyText(instruction(task.kind, task.frameId, part, trigger)).then((ok) => {
      if (ok) setCopied(true)
    })

  return (
    <>
      <div className="palette-scrim onboarding-scrim" onPointerDown={close} />
      <div
        className="dialog dialog-small onboarding claude-task"
        role="dialog"
        aria-label="Ask Claude"
        onPointerMove={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        <PixelCanvas className="onboarding-pixels" active={hover} gap={8} speed={30} colors={PIXELS} variant="icon" noFocus />
        <div className="dialog-body">
          <span className="onboarding-mark">
            <AppMark size={48} idle />
          </span>
          {task.kind === 'capture' && (
            <>
              <h2>Capture motion with Claude</h2>
              <p>Claude opens {host} in your Chrome, triggers the motion and measures it.</p>
              <label className="claude-task-field">
                <span>Which part?</span>
                <input autoFocus value={part} placeholder="the Get started button" onChange={(e) => setPart(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && copy()} />
              </label>
              <Segmented
                options={TRIGGERS.map((t) => ({ id: t, label: t[0].toUpperCase() + t.slice(1) }))}
                value={trigger}
                onChange={setTrigger}
                style={{ alignSelf: 'stretch', marginBottom: 24 }}
              />
            </>
          )}
          {task.kind === 'snapshot' && (
            <>
              <h2>Snapshot with Claude</h2>
              <p>{host} doesn’t allow previews. Claude can open it in your Chrome and save a full-page picture.</p>
            </>
          )}
          {task.kind === 'fonts' && (
            <>
              <h2>Read fonts with Claude</h2>
              <p>Claude reads the fonts {host} uses, for the board’s font suggestions.</p>
            </>
          )}
          <button className="btn btn-primary onboarding-cta" onClick={copy}>
            {copied ? 'Copied' : 'Copy for Claude'}
          </button>
          <p className="onboarding-tip">
            {copied ? `Paste it into Claude Code in “${folder ?? 'your folder'}”. The board updates when it’s done.` : 'Works with Codex too.'}
          </p>
        </div>
      </div>
    </>
  )
}
