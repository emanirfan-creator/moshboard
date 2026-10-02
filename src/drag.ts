import { setState } from './store'

/**
 * Pointer drag that keeps tracking over iframes (the canvas disables iframe
 * pointer events while `gesture` is set). `onMove` gets screen-space deltas.
 */
export function drag(
  e: { clientX: number; clientY: number; preventDefault?: () => void },
  onMove: (dx: number, dy: number, ev: PointerEvent) => void,
  onEnd?: (moved: boolean, ev: PointerEvent) => void,
  threshold = 3,
  kind: 'canvas' | 'tune' = 'canvas',
) {
  e.preventDefault?.()
  const sx = e.clientX
  const sy = e.clientY
  let moved = false
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx
    const dy = ev.clientY - sy
    if (!moved) {
      if (Math.hypot(dx, dy) < threshold) return
      moved = true
      setState({ gesture: kind })
    }
    onMove(dx, dy, ev)
  }
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    if (moved) setState({ gesture: null })
    onEnd?.(moved, ev)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
