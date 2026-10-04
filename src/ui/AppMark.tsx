import { useEffect, useRef } from 'react'

// The Moshboard mark: an m whose second hump sits a step higher, and reaches
// for the cursor when it comes near (its legs stretch, its feet stay put).
// With `idle` it also stretches on its own now and then while the cursor is elsewhere.
// Drawn on a 24-unit grid.

/** how much higher the hump can stretch, in grid units */
const REACH = 3
/** how close the cursor has to come, in screen px */
const RADIUS = 96
const NUDGE = -0.9
/** idle: how often it stretches on its own, and how long it holds the stretch, in ms */
const IDLE_EVERY = 3200
const IDLE_HOLD = 180

const hump = (lift: number) => `M12 15.5V${(8 - lift).toFixed(3)}a3.75 3.75 0 0 1 7.5 0V16`

export function AppMark({ size = 18, idle = false }: { size?: number; idle?: boolean }) {
  const svg = useRef<SVGSVGElement>(null)
  const path = useRef<SVGPathElement>(null)

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let lift = 0
    let v = 0
    let target = 0
    let raf = 0
    let last = 0
    let near = false
    // A bigger mark notices the cursor from further away.
    const radius = RADIUS * Math.max(1, size / 18)

    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000)
      last = now
      // A spring that overshoots a little on the way back down.
      v += ((target - lift) * 170 - v * 13) * dt
      lift += v * dt
      const settled = Math.abs(target - lift) < 0.002 && Math.abs(v) < 0.002
      if (settled) lift = target
      path.current?.setAttribute('d', hump(lift))
      raf = settled ? 0 : requestAnimationFrame(tick)
    }
    const aim = (t: number) => {
      if (t === target) return
      target = t
      if (!raf) {
        last = performance.now()
        raf = requestAnimationFrame(tick)
      }
    }
    const move = (e: PointerEvent) => {
      const r = svg.current?.getBoundingClientRect()
      if (!r?.width) return aim(0)
      const unit = r.width / 24
      // The top of the hump.
      const dx = e.clientX - (r.left + 15.75 * unit)
      const dy = e.clientY - (r.top + (2.25 + NUDGE) * unit)
      const t = e.clientY < r.bottom ? Math.max(0, 1 - Math.hypot(dx, dy) / radius) : 0
      near = t > 0
      // Only reaches up: a cursor below the mark leaves it be.
      aim(REACH * t * t * (3 - 2 * t))
    }
    const leave = (e: PointerEvent) => {
      if (e.relatedTarget) return
      near = false
      aim(0)
    }

    // A stretch and a springy drop: once when it appears, then every few seconds.
    let hold = 0
    const hop = () => {
      if (near) return
      aim(REACH)
      hold = window.setTimeout(() => !near && aim(0), IDLE_HOLD)
    }
    const first = idle ? window.setTimeout(hop, 420) : 0
    const every = idle ? window.setInterval(hop, IDLE_EVERY) : 0

    window.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerout', leave)
    return () => {
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerout', leave)
      cancelAnimationFrame(raf)
      clearTimeout(first)
      clearTimeout(hold)
      clearInterval(every)
    }
  }, [idle, size])

  return (
    <svg ref={svg} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ overflow: 'visible', flex: 'none' }}>
      <g transform={`translate(0 ${NUDGE})`} stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 19.5V12a3.75 3.75 0 0 1 7.5 0v7.5" />
        <path ref={path} d={hump(0)} />
      </g>
    </svg>
  )
}
