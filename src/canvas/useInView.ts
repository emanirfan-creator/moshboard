import { useEffect, useState, type RefObject } from 'react'

/** How long a block can sit off-screen before its heavy content (iframe) is unloaded. */
const UNLOAD_AFTER_MS = 20_000

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
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
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
