import { useEffect, useState } from 'react'
import { PixelCanvas } from '../components/ui/pixel-canvas'

const PIXELS = ['#3a3b41', '#55575e', '#8a8f98']

/** Pixel shimmer from the center while a block's content loads; fades out once it's ready. */
export function BlockLoader({ loading, label = 'Loading' }: { loading: boolean; label?: string }) {
  const [mounted, setMounted] = useState(loading)
  useEffect(() => {
    if (loading) return setMounted(true)
    const t = setTimeout(() => setMounted(false), 700)
    return () => clearTimeout(t)
  }, [loading])
  if (!mounted) return null
  return (
    <div className="frame-loading" data-done={!loading || undefined}>
      <PixelCanvas active={loading} gap={8} speed={30} colors={PIXELS} variant="icon" noFocus />
      <span className="frame-loading-label">{label}</span>
    </div>
  )
}
