import { useEffect, useState } from 'react'
import { PixelCanvas } from '../components/ui/pixel-canvas'
import { setState, useStore } from '../store'
import { AppMark } from '../ui/AppMark'
import { GlowEdge } from '../ui/GlowEdge'
import { CheckIcon, CloseIcon, FolderIcon } from '../ui/icons'
import { chooseFolder, FOLDER_ONLY, folderSupported, reconnectFolder } from './folder'

const close = () => setState({ onboarding: null })
/** The same greys as a block's loading shimmer (src/frames/BlockLoader.tsx). */
const PIXELS = ['#3a3b41', '#55575e', '#8a8f98']

// The first visit gets an entrance (the card rises in and the logo hops as it lands); later ones don't.
let firstVisit = false
try {
  firstVisit = !localStorage.getItem('mb:seen')
  localStorage.setItem('mb:seen', '1')
} catch {
  // storage blocked: no entrance
}

/** Setup screens for folder mode: pick a folder, reconnect it, and how to use Claude with it. */
export function Onboarding() {
  const step = useStore((s) => s.onboarding)
  const folder = useStore((s) => s.folder)
  // Picking and reconnecting block the app (there's nothing to show without a folder); the rest can be closed.
  const blocking = step === 'reconnect' || step === 'gone' || (step === 'welcome' && FOLDER_ONLY)
  const centered = step === 'welcome' || step === 'reconnect' || step === 'gone'
  // While a folder is being chosen and opened, the card shimmers like a loading block.
  const [connecting, setConnecting] = useState(false)
  const connect = (run: () => Promise<unknown>) => () => {
    setConnecting(true)
    run().finally(() => setConnecting(false))
  }

  useEffect(() => {
    if (!step || blocking) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, blocking])

  if (!step) return null
  const name = folder?.name ?? 'your folder'

  return (
    <>
      <div className="palette-scrim onboarding-scrim" onPointerDown={blocking ? undefined : close} />
      <div
        className="dialog dialog-small onboarding"
        data-center={centered || undefined}
        data-intro={(firstVisit && step === 'welcome') || undefined}
        role="dialog"
        aria-label="Set up Moshboard"
      >
        {!blocking && (
          <button className="icon-btn dialog-close" onClick={close} title="Close  Esc" aria-label="Close">
            <CloseIcon />
          </button>
        )}
        {centered && <GlowEdge />}
        {/* Ripples in on hover, and plays while a folder opens. */}
        {centered && <PixelCanvas className="onboarding-pixels" active={connecting} gap={8} speed={30} colors={PIXELS} variant="icon" noFocus />}
        <div className="dialog-body">
          {centered && (
            <span className="onboarding-mark">
              <AppMark size={48} idle />
            </span>
          )}
          {step === 'welcome' && (
            <>
              <h2>Pick a home for your boards</h2>
              <p>Boards are saved in a folder on your computer. Nothing is uploaded.</p>
              {folderSupported() ? (
                <>
                  <button className="btn btn-primary onboarding-cta" onClick={connect(chooseFolder)}>
                    <FolderIcon /> Choose folder
                  </button>
                  <p className="onboarding-tip">Chrome then asks to let Moshboard edit the folder. Allow it.</p>
                </>
              ) : (
                <p className="onboarding-tip">Open Moshboard in Chrome, Edge or Arc to use a folder.</p>
              )}
            </>
          )}

          {step === 'gone' && (
            <>
              <h2>Your folder is gone</h2>
              <p>“{name}” was moved or deleted. Choose it again in its new place, or pick a new folder.</p>
              <button className="btn btn-primary onboarding-cta" onClick={connect(chooseFolder)}>
                <FolderIcon /> Choose folder
              </button>
            </>
          )}

          {step === 'reconnect' && (
            <>
              <h2>Reconnect your folder</h2>
              <p>Chrome asks again after a while. Your boards are still in “{name}”.</p>
              <button className="btn btn-primary onboarding-cta" onClick={connect(reconnectFolder)}>
                Reconnect
              </button>
              <p className="onboarding-tip">
                <button className="link" onClick={connect(chooseFolder)}>
                  Choose another folder
                </button>
              </p>
            </>
          )}

          {step === 'ready' && (
            <>
              <h2>Your folder is ready</h2>
              <ul className="onboarding-list">
                <li>
                  <CheckIcon /> Boards are saved in “{name}”
                </li>
                <li>
                  <CheckIcon /> {folder?.assistant ? 'Instructions for Claude and Codex added' : 'Your own Claude instructions were kept'}
                </li>
                <li>
                  <CheckIcon /> Edits made in the folder show up live
                </li>
              </ul>
              <button className="btn btn-primary onboarding-cta" onClick={() => setState({ onboarding: 'claude' })}>
                Continue
              </button>
            </>
          )}

          {step === 'claude' && (
            <>
              <h2>Let Claude recreate references</h2>
              <ol className="onboarding-steps">
                <li>
                  <span>Open Claude and go to Code</span>
                </li>
                <li>
                  <span>Choose the folder “{name}”</span>
                </li>
                <li>
                  <span>
                    Select a reference here, press <kbd>⌘K</kbd>, choose Copy /recreate command, and paste it into Claude
                  </span>
                </li>
              </ol>
              <p className="onboarding-tip">Using Codex? Open the same folder.</p>
              <button className="btn btn-primary onboarding-cta" onClick={close}>
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
