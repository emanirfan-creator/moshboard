import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { stopRecording } from './audio'

/** While a tab's sounds are recording: how long, and Stop. */
export function RecordingBar() {
  const since = useStore((s) => s.recording)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!since) return
    const t = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [since])
  if (!since) return null
  const s = Math.floor((Date.now() - since) / 1000)
  return (
    <div className="rec-bar" role="status">
      <span className="rec-dot" aria-hidden />
      Recording sounds {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
      <button className="btn" onClick={stopRecording}>
        Stop
      </button>
    </div>
  )
}
