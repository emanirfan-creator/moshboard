import { useEffect, useState } from 'react'
import { PixelCanvas } from '../components/ui/pixel-canvas'
import { setState, useStore } from '../store'
import { AppMark } from '../ui/AppMark'
import { CheckIcon, FolderIcon } from '../ui/icons'
import { chooseFolder, FOLDER_ONLY, folderSupported, pendingRepoName, reconnectFolder, answerRepo, switchFolder } from './folder'

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

/** Setup screens for the website: pick a folder, reconnect it, and how to use Claude with it. All one card layout. */
export function Onboarding() {
  const step = useStore((s) => s.onboarding)
  const folder = useStore((s) => s.folder)
  const folderOpen = useStore((s) => !!s.folderId && !!s.board)
  const folders = useStore((s) => s.folders)
  const others = folders.filter((f) => !f.missing)
  // Picking and reconnecting block the app (there's nothing to show without a folder); the rest can be closed.
  const blocking =
    step === 'reconnect' || step === 'gone' || (step === 'welcome' && FOLDER_ONLY) || (step === 'repo' && !folderOpen)
  // While a folder is being chosen and opened, the card shimmers like a loading block.
  const [connecting, setConnecting] = useState(false)
  // Hover follows the cursor over the card, not just it coming in: the next step replaces the card
  // under a cursor that's already there.
  const [hover, setHover] = useState(false)
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
        data-intro={(firstVisit && step === 'welcome') || undefined}
        role="dialog"
        aria-label="Set up Moshboard"
        onPointerMove={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        {/* Every step is the same card: the mark, one message, one button. Pixels ripple in on hover and play while a folder opens. */}
        <PixelCanvas className="onboarding-pixels" active={connecting || hover} gap={8} speed={30} colors={PIXELS} variant="icon" noFocus />
        <div className="dialog-body">
          <span className="onboarding-mark">
            <AppMark size={48} idle />
          </span>
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

          {step === 'repo' && (
            <>
              <h2>Keep boards in a design folder?</h2>
              <p>“{pendingRepoName()}” holds code. A design folder inside it keeps your boards apart.</p>
              <button className="btn btn-primary onboarding-cta" onClick={connect(() => answerRepo(true))}>
                <FolderIcon /> Use design folder
              </button>
              <p className="onboarding-tip">
                <button className="link" onClick={connect(() => answerRepo(false))}>
                  Use “{pendingRepoName()}” itself
                </button>
              </p>
            </>
          )}

          {step === 'gone' && (
            <>
              <h2>Your folder is gone</h2>
              <p>“{name}” was moved or deleted. Choose it again in its new place, or pick a new folder.</p>
              <button className="btn btn-primary onboarding-cta" onClick={connect(chooseFolder)}>
                <FolderIcon /> Choose folder
              </button>
              {others.map((f) => (
                <p key={f.id} className="onboarding-tip">
                  <button className="link" onClick={connect(() => switchFolder(f.id))}>
                    Open “{f.name}”
                  </button>
                </p>
              ))}
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
              <h2>Use Claude with your boards</h2>
              <p>Claude recreates references as code, captures a site’s motion, and snapshots sites that block previews.</p>
              <ol className="onboarding-steps">
                <li>
                  <span>Open Claude and go to Code</span>
                </li>
                <li>
                  <span>Choose the folder “{name}”</span>
                </li>
                <li>
                  <span>Copy a task from Moshboard and paste it in</span>
                </li>
              </ol>
              <button className="btn btn-primary onboarding-cta" onClick={close}>
                Done
              </button>
              <p className="onboarding-tip">Using Codex? Open the same folder.</p>
            </>
          )}
        </div>
      </div>
    </>
  )
}
