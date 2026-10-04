import { useEffect, useRef } from 'react'

// A light on a card's edge that slides around toward the cursor when it comes near (after
// 21st.dev's GlowingEffect, in white). Put it inside a positioned element with a border radius;
// styles are `.glow-edge` in theme.css.

/** how close the cursor has to come, in px outside the card */
const PROXIMITY = 64
/** fraction of the card's half-size around its center where the light switches off */
const INACTIVE = 0.01
/** how far the angle travels toward the cursor each frame (an ease-out) */
const FOLLOW = 0.08

export function GlowEdge() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let angle = 0
    let target = 0
    let frame = 0

    const step = () => {
      angle += (target - angle) * FOLLOW
      el.style.setProperty('--start', angle.toFixed(2))
      frame = Math.abs(target - angle) > 0.1 ? requestAnimationFrame(step) : 0
    }

    const onMove = (e: PointerEvent) => {
      const { left, top, width, height } = el.getBoundingClientRect()
      const cx = left + width / 2
      const cy = top + height / 2
      const near =
        e.clientX > left - PROXIMITY && e.clientX < left + width + PROXIMITY && e.clientY > top - PROXIMITY && e.clientY < top + height + PROXIMITY
      const centered = Math.hypot(e.clientX - cx, e.clientY - cy) < 0.5 * Math.min(width, height) * INACTIVE
      el.style.setProperty('--active', near && !centered ? '1' : '0')
      if (!near || centered) return
      const to = (180 * Math.atan2(e.clientY - cy, e.clientX - cx)) / Math.PI + 90
      // Take the short way round.
      target = angle + ((((to - angle + 180) % 360) + 360) % 360) - 180
      if (!frame) frame = requestAnimationFrame(step)
    }

    document.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
    }
  }, [])

  return <div ref={ref} className="glow-edge" aria-hidden />
}
