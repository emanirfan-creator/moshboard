import { useEffect, useLayoutEffect, useRef } from 'react'

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Glides CSS custom properties toward their targets on a spring, so a slider's
 * thumb and fill trail the value smoothly (a jump on click, the steps of a drag)
 * instead of snapping. Values change at once; only the drawing glides. Returns
 * the ref for the element that carries the properties.
 *
 * `useGlide({ '--t': 0.4 })` → the element's `--t` springs to 0.4.
 */
export function useGlide<T extends HTMLElement>(targets: Record<string, number>, stiffness = 620, damping = 46) {
  const ref = useRef<T>(null)
  const goal = useRef(targets)
  goal.current = targets
  const springs = useRef(new Map<string, { x: number; v: number }>())
  const raf = useRef(0)
  const key = Object.entries(targets).join()

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let moving = false
    for (const [name, to] of Object.entries(goal.current)) {
      const s = springs.current.get(name)
      // First paint and reduced motion land in place.
      if (!s || reduced()) {
        springs.current.set(name, { x: to, v: 0 })
        el.style.setProperty(name, String(to))
      } else if (s.x !== to) moving = true
    }
    if (!moving || raf.current) return
    let last = performance.now()
    const frame = (t: number) => {
      const dt = Math.min((t - last) / 1000, 1 / 30)
      last = t
      let busy = false
      for (const [name, s] of springs.current) {
        const to = goal.current[name] ?? s.x
        s.v += ((to - s.x) * stiffness - s.v * damping) * dt
        s.x += s.v * dt
        if (Math.abs(to - s.x) < 1e-4 && Math.abs(s.v) < 1e-3) {
          s.x = to
          s.v = 0
        } else busy = true
        el.style.setProperty(name, s.x.toFixed(5))
      }
      raf.current = busy ? requestAnimationFrame(frame) : 0
    }
    raf.current = requestAnimationFrame(frame)
  }, [key])

  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  return ref
}
