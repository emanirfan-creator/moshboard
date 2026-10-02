import { useEffect, useState } from 'react'
import { api } from '../api'
import { exportBoard } from '../actions'
import { getState, setState, toast, useStore } from '../store'
import { CloseIcon } from './icons'

const DESCRIBE: Record<string, string> = {
  'design.md': 'Colors, type, notes and references',
  'motion.md': 'Each animation’s timing, easing and source',
  'tokens.css': 'Tokens as CSS variables',
  'tokens.json': 'Tokens as JSON',
}

const close = () => setState({ exported: null })

export function ExportDialog() {
  const result = useStore((s) => s.exported)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (!result) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [result])

  if (!result) return null

  const ORDER = Object.keys(DESCRIBE)
  const partial = result.scope.frames < result.scope.total
  const top = result.files.filter((f) => !f.includes('/')).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
  const snippets = result.files.filter((f) => f.startsWith('snippets/'))
  const refs = result.files.filter((f) => f.startsWith('refs/'))
  const prompt = `Build this UI from the spec in ${result.absDir}. Read motion.md and design.md first. Use tokens.css for timing, easing and color. Treat snippets/ as exact references: their values were tuned by hand.`

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
          <h2>{partial ? `Exported ${result.scope.frames} of ${result.scope.total} frames` : 'Spec exported'}</h2>
          <p>
            {partial && 'Your selection plus linked frames. '}
            Saved to <span className="mono path">{result.dir}</span>. Exporting again overwrites it.
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
                  {refs.length} reference image{refs.length > 1 ? 's' : ''} and keyframe sheets
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
            <p>{prompt}</p>
          </div>

          <div className="dialog-foot">
            <span className="dialog-tip">
              <button
                className="link"
                onClick={() => api.reveal(getState().boardName).catch((e) => toast(e.message, true))}
              >
                Show in Finder
              </button>
              {'  ·  '}
              <button className="link" onClick={() => copy('path', result.absDir)}>
                {copied === 'path' ? 'Copied' : 'Copy path'}
              </button>
              {'  ·  '}
              {partial ? (
                <button className="link" onClick={() => exportBoard('all')}>
                  Export whole canvas
                </button>
              ) : (
                <button className="link" onClick={() => exportBoard()}>
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
