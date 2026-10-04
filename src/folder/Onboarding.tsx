import { useEffect } from 'react'
import { setState, useStore } from '../store'
import { CheckIcon, CloseIcon, FolderIcon } from '../ui/icons'
import { chooseFolder, disconnectFolder, FOLDER_ONLY, folderSupported, reconnectFolder } from './folder'

const close = () => setState({ onboarding: null })

/** Setup screens for folder mode: pick a folder, reconnect it, and how to use Claude with it. */
export function Onboarding() {
  const step = useStore((s) => s.onboarding)
  const folder = useStore((s) => s.folder)
  // Picking and reconnecting block the app (there's nothing to show without a folder); the rest can be closed.
  const blocking = step === 'reconnect' || (step === 'welcome' && FOLDER_ONLY)

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
      <div className="dialog dialog-small onboarding" role="dialog" aria-label="Set up Moshboard">
        {!blocking && (
          <button className="icon-btn dialog-close" onClick={close} title="Close  Esc" aria-label="Close">
            <CloseIcon />
          </button>
        )}
        <div className="dialog-body">
          {step === 'welcome' && (
            <>
              <h2>Pick a home for your boards</h2>
              <p>Boards are saved in a folder on your computer. Nothing is uploaded.</p>
              {folderSupported() ? (
                <>
                  <button className="btn btn-primary onboarding-cta" onClick={chooseFolder}>
                    <FolderIcon /> Choose folder
                  </button>
                  <p className="onboarding-tip">Chrome then asks to let Moshboard edit the folder. Allow it.</p>
                </>
              ) : (
                <p className="onboarding-tip">Open Moshboard in Chrome, Edge or Arc to use a folder.</p>
              )}
            </>
          )}

          {step === 'reconnect' && (
            <>
              <h2>Reconnect your folder</h2>
              <p>Chrome asks again after a while. Your boards are still in “{name}”.</p>
              <button className="btn btn-primary onboarding-cta" onClick={reconnectFolder}>
                Reconnect
              </button>
              <p className="onboarding-tip">
                <button className="link" onClick={chooseFolder}>
                  Choose another folder
                </button>
                {!FOLDER_ONLY && (
                  <>
                    {' · '}
                    <button className="link" onClick={disconnectFolder}>
                      Use the boards next to Moshboard
                    </button>
                  </>
                )}
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
