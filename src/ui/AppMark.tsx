import { useEffect, useRef } from 'react'

// The Moshboard mark: an m whose second hump sits a step higher, and reaches
// for the cursor when it comes near (its legs stretch, its feet stay put).
// Drawn on a 24-unit grid.

/** how much higher the hump can stretch, in grid units */
const REACH = 3
/** how close the cursor has to come, in screen px */
const RADIUS = 96
const NUDGE = -0.9

const hump = (lift: number) => `M12 15.5V${(8 - lift).toFixed(3)}a3.75 3.75 0 0 1 7.5 0V16`

export function AppMark({ size = 18 }: { size?: number }) {
  const svg = useRef<SVGSVGElement>(null)
  const path = useRef<SVGPathElement>(null)

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let lift = 0
    let v = 0
    let target = 0
    let raf = 0
    let last = 0

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
      const near = Math.max(0, 1 - Math.hypot(dx, dy) / RADIUS)
      // Only reaches up: a cursor below the mark leaves it be.
      aim(e.clientY < r.bottom ? REACH * near * near * (3 - 2 * near) : 0)
    }
    const leave = (e: PointerEvent) => !e.relatedTarget && aim(0)

    window.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerout', leave)
    return () => {
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerout', leave)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <svg ref={svg} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ overflow: 'visible', flex: 'none' }}>
      <g transform={`translate(0 ${NUDGE})`} stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 19.5V12a3.75 3.75 0 0 1 7.5 0v7.5" />
        <path ref={path} d={hump(0)} />
      </g>
    </svg>
  )
}
