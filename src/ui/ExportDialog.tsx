import { useEffect, useState } from 'react'
import { api } from '../api'
import { exportBoard } from '../actions'
import { Segmented } from './Segmented'
import { shareBoard } from '../share'
import { getState, setState, toast, useStore } from '../store'
import { CloseIcon } from './icons'
import { FOLDER_ONLY } from '../folder/folder'
import { openCommentsText } from '../comments/comments'
import { tick } from './sound'

const DESCRIBE: Record<string, string> = {
  'design.md': 'Colors, type, notes and references',
  'motion.md': 'Motion tokens and patterns',
  'interactions.md': 'How each animation was measured, with exact values',
  'tokens.css': 'Tokens as CSS variables',
  'tokens.json': 'Tokens as JSON',
}

const close = () => setState({ exported: null })

export function ExportDialog() {
  const result = useStore((s) => s.exported)
  const [copied, setCopied] = useState<string | null>(null)
  // Off by default: comments are notes to yourself until you choose to hand them over.
  const [withComments, setWithComments] = useState(false)
  const [shareComments, setShareComments] = useState(false)
  const notes = useStore((s) => (s.exported ? openCommentsText(s) : ''))
  const openCount = notes ? notes.split('\n').length : 0

  useEffect(() => {
    if (!result) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [result])

  const scope = useStore((s) => s.exportScope)
  const pick = useStore((s) => s.board?.frames.find((f) => f.type === 'section' && f.chosen)?.label || (s.board?.frames.some((f) => f.chosen) ? 'Section' : null))
  if (!result) return null

  const ORDER = Object.keys(DESCRIBE)
  const partial = result.scope.frames < result.scope.total
  const top = result.files.filter((f) => !f.includes('/')).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
  const snippets = result.files.filter((f) => f.startsWith('snippets/'))
  const refs = result.files.filter((f) => f.startsWith('refs/'))
  const base = `Build this UI from the spec in ${result.absDir}. Read design.md and motion.md first. Use tokens.css for timing, easing and color. Treat snippets/ as exact references: their values were tuned by hand.`
  const prompt = withComments && notes ? `${base}\n\nAlso address these open comments from the board:\n${notes}` : base

  const copy = (what: string, text: string) =>
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(what)
        setTimeout(() => setCopied(null), 1600)
      },
      () => toast('Couldn’t copy to the clipboard', true),
    )

  return (
    <>
      <div className="palette-scrim" onPointerDown={close} />
      <div className="dialog dialog-small dialog-export" role="dialog" aria-label="Export">
        <button className="icon-btn dialog-close" onClick={close} title="Close  Esc" aria-label="Close">
          <CloseIcon />
        </button>
        <div className="dialog-body">
          <h2>{scope === 'chosen' ? `Exported ${pick}` : partial ? `Exported ${result.scope.frames} of ${result.scope.total} frames` : 'Spec exported'}</h2>
          {/* An approved section: export just it (plus what isn't in any section), or everything. */}
          {pick && scope !== 'selection' && (
            <Segmented
              options={[
                { id: 'chosen', label: `${pick} only` },
                { id: 'all', label: 'Whole canvas' },
              ]}
              value={scope}
              onChange={(v) => v !== scope && exportBoard(v as 'chosen' | 'all')}
            />
          )}
          <p>
            {scope === 'chosen' && 'The approved section plus anything not in a section. '}
            {scope === 'selection' && 'Your selection plus linked frames. '}
            Saved to <span className="mono path">{result.dir}</span>. Re-exporting overwrites it.
          </p>

          <ul className="export-files">
            {top.map((f) => (
              <li key={f}>
                <span className="mono">{f}</span>
                <span>{DESCRIBE[f] ?? ''}</span>
              </li>
            ))}
            {snippets.length > 0 && (
              <li>
                <span className="mono">snippets/</span>
                <span>
                  {snippets.length} component{snippets.length > 1 ? 's' : ''} with tuned values
                </span>
              </li>
            )}
            {refs.length > 0 && (
              <li>
                <span className="mono">refs/</span>
                <span>
                  {refs.length} reference image{refs.length > 1 ? 's' : ''} and keyframes
                </span>
              </li>
            )}
          </ul>

          {result.warnings.length > 0 && (
            <div className="export-warn">
              {result.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}

          <div className="export-prompt">
            <div className="label-row">
              <span>Hand it to Claude Code</span>
              <button className="link" onClick={() => copy('prompt', prompt)}>
                {copied === 'prompt' ? 'Copied' : 'Copy prompt'}
              </button>
            </div>
            <p className="export-prompt-text">{prompt}</p>
            {openCount > 0 && (
              <Switch label={`Include open comments (${openCount})`} on={withComments} onChange={setWithComments} />
            )}
          </div>

          <div className="export-prompt">
            <div className="label-row">
              <span>Share with someone without Moshboard</span>
              <button className="link" onClick={() => (close(), shareBoard({ comments: shareComments }))}>
                Share as a page
              </button>
            </div>
            <p>One HTML file with the whole canvas: clips play, components run, live sites stay live. Opens in any browser.</p>
            {openCount > 0 && <Switch label="Show comments on the page" on={shareComments} onChange={setShareComments} />}
          </div>

          <div className="dialog-foot">
            <span className="dialog-tip">
              {/* A website can't open Finder. */}
              {!FOLDER_ONLY && (
                <>
                  <button
                    className="link"
                    onClick={() => api.reveal(getState().boardName).catch((e) => toast(e.message, true))}
                  >
                    Show in Finder
                  </button>
                  {'  ·  '}
                </>
              )}
              <button className="link" onClick={() => copy('path', result.absDir)}>
                {copied === 'path' ? 'Copied' : 'Copy path'}
              </button>
              {'  ·  '}
              {scope === 'selection' ? (
                <button className="link" onClick={() => exportBoard('all')}>
                  Export whole canvas
                </button>
              ) : (
                <button className="link" onClick={() => exportBoard(scope === 'chosen' ? 'chosen' : 'all')}>
                  Export again
                </button>
              )}
            </span>
            <button className="btn btn-primary" onClick={close}>
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      className="tgl export-switch"
      role="switch"
      aria-checked={on}
      onClick={() => {
        tick(on ? 0.2 : 0.8, true)
        onChange(!on)
      }}
    >
      <span className="num-name">{label}</span>
      <span className="tgl-track" data-on={on || undefined}>
        <span className="tgl-knob" />
      </span>
    </button>
  )
}
