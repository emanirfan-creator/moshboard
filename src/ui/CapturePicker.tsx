import { useEffect, useMemo, useState } from 'react'
import type { PickResult, PickTarget } from '../../server/pick-element.ts'
import { api, mediaUrl } from '../api'
import { captureSelected } from '../actions'
import { BlockLoader } from '../frames/BlockLoader'
import { frameById, getState, setState, useStore } from '../store'
import { CloseIcon } from './icons'
import { Segmented } from './Segmented'

type Trigger = 'hover' | 'click' | 'focus' | 'scroll' | 'load'
const TRIGGERS: { id: Trigger; label: string }[] = [
  { id: 'hover', label: 'Hover' },
  { id: 'click', label: 'Click' },
  { id: 'focus', label: 'Focus' },
  { id: 'scroll', label: 'Scroll into view' },
  { id: 'load', label: 'Page load' },
]

const close = () => setState({ picking: null })

/**
 * "Capture motion" for a site: a screenshot of its first screen with everything that
 * can be captured outlined. Click an element, pick what sets it off, capture.
 * Elements that declare a transition are marked, since those are where motion lives.
 */
export function CapturePicker() {
  const id = useStore((s) => s.picking)
  if (!id) return null
  return <Picker key={id} id={id} />
}

function Picker({ id }: { id: string }) {
  const frame = frameById(id)
  const [result, setResult] = useState<PickResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<PickTarget | null>(null)
  const [hover, setHover] = useState<PickTarget | null>(null)
  const [trigger, setTrigger] = useState<Trigger>('hover')
  const [typed, setTyped] = useState('')
  const [onlyMoving, setOnlyMoving] = useState(true)

  useEffect(() => {
    if (!frame?.src) return
    api.pick(getState().boardName, id, frame.src).then(setResult, (e) => setError((e as Error).message))
  }, [id, frame?.src])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const moving = useMemo(() => result?.targets.filter((t) => t.moves) ?? [], [result])
  // Show only elements that move when there are some; everything clickable otherwise.
  const shown = result ? (onlyMoving && moving.length ? moving : result.targets) : []
  const selector = typed.trim() || picked?.selector
  // Load and scroll don't need an element: the whole page is fine.
  const ready = !!selector || trigger === 'load' || trigger === 'scroll'

  const pick = (t: PickTarget) => {
    setPicked(t)
    setTyped('')
    setTrigger((cur) => (cur === 'load' || cur === 'scroll' ? cur : t.trigger))
  }
  const capture = () => {
    if (!ready) return
    close()
    captureSelected(selector || 'body', trigger)
  }

  if (!frame) return null
  const shownBox = hover ?? picked
  return (
    <>
      <div className="palette-scrim" onPointerDown={close} />
      <div className="dialog picker" role="dialog" aria-label="Capture motion">
        <button className="icon-btn dialog-close" onClick={close} title="Close  Esc" aria-label="Close">
          <CloseIcon />
        </button>
        <div className="picker-body">
          <header className="picker-head">
            <h2>Capture motion</h2>
            <p>Click the part of {frame.label ?? 'the site'} that moves, then choose what sets it off.</p>
          </header>

          <div className="picker-stage">
            {!result && !error && <BlockLoader loading label="Opening the page" />}
            {error && <p className="picker-error">Couldn’t open the page: {error}</p>}
            {result && (
              <div className="picker-shot" style={{ aspectRatio: `${result.width} / ${result.height}` }}>
                <img src={mediaUrl(getState().boardName, result.image)} alt="" draggable={false} />
                {shown.map((t) => (
                  <button
                    key={t.selector}
                    className="picker-box"
                    data-moves={t.moves || undefined}
                    data-picked={picked?.selector === t.selector || undefined}
                    style={{
                      left: `${(t.x / result.width) * 100}%`,
                      top: `${(t.y / result.height) * 100}%`,
                      width: `${(t.w / result.width) * 100}%`,
                      height: `${(t.h / result.height) * 100}%`,
                    }}
                    onPointerEnter={() => setHover(t)}
                    onPointerLeave={() => setHover(null)}
                    onClick={() => pick(t)}
                    aria-label={t.label}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="picker-foot">
            <div className="picker-what">
              {shownBox ? (
                <>
                  <span className="picker-label">{shownBox.label}</span>
                  {shownBox.moves && <span className="picker-tag">Has motion</span>}
                </>
              ) : (
                <span className="picker-hint">
                  {result
                    ? `${shown.length} ${onlyMoving && moving.length ? 'elements with motion' : 'elements'} on the first screen`
                    : 'Loading…'}
                </span>
              )}
              {result && moving.length > 0 && moving.length < result.targets.length && (
                <button className="btn btn-ghost picker-toggle" onClick={() => setOnlyMoving(!onlyMoving)}>
                  {onlyMoving ? 'Show everything' : 'Only what moves'}
                </button>
              )}
            </div>
            <Segmented options={TRIGGERS} value={trigger} onChange={setTrigger} />
            <div className="picker-actions">
              <input
                className="picker-typed mono"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') capture()
                }}
                placeholder={picked?.selector ?? 'Or type a CSS selector'}
                spellCheck={false}
                title="For elements further down, or a more exact target"
              />
              <button className="btn btn-primary" disabled={!ready} onClick={capture}>
                Capture
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
