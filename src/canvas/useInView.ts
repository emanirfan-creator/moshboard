import { useEffect, useState, type RefObject } from 'react'

/** How long a block can sit off-screen before its heavy content (iframe) is unloaded. */
const UNLOAD_AFTER_MS = 20_000

// One observer for every block (per margin) instead of one each: a big board otherwise
// runs hundreds of observers through every pan and zoom.
const observers = new Map<string, { io: IntersectionObserver; cbs: Map<Element, (v: boolean) => void> }>()
function observe(el: Element, margin: string, cb: (v: boolean) => void) {
  let o = observers.get(margin)
  if (!o) {
    const cbs = new Map<Element, (v: boolean) => void>()
    const io = new IntersectionObserver((entries) => entries.forEach((e) => cbs.get(e.target)?.(e.isIntersecting)), { rootMargin: margin })
    observers.set(margin, (o = { io, cbs }))
  }
  o.cbs.set(el, cb)
  o.io.observe(el)
  const { io, cbs } = o
  return () => {
    io.unobserve(el)
    cbs.delete(el)
  }
}

/**
 * Whether an element is on (or near) screen. Works through the canvas's CSS
 * transform. `seen` turns on the first time it comes near the screen (heavy
 * content mounts lazily) and back off after it has been far away for a while,
 * so a big board doesn't keep every iframe alive. Coming back reloads from cache.
 */
export function useInView(ref: RefObject<Element | null>, margin = '50%') {
  const [inView, setInView] = useState(false)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return observe(el, margin, setInView)
  }, [ref, margin])

  useEffect(() => {
    if (inView) {
      setSeen(true)
      return
    }
    const t = setTimeout(() => setSeen(false), UNLOAD_AFTER_MS)
    return () => clearTimeout(t)
  }, [inView])

  return { inView, seen }
}
