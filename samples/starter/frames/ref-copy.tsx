/* @param duration 680ms 80..1600 */
/* @param delay 0ms 0..800 */
/* @param distance 240px 0..400 */
/* @param ease cubic-bezier(0.25, 1, 0.5, 1) */
/* @trigger loop */
/* @animates transform */
import { useEffect, useState } from 'react'

export default function CardSlide() {
  const [on, setOn] = useState(false)
  // demo loop: rest, slide over, hold, jump back, like the reference clip (2.4s)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const cycle = () => {
      setOn(false)
      t = setTimeout(() => {
        setOn(true)
        t = setTimeout(cycle, 2000)
      }, 400)
    }
    cycle()
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="flex h-full w-full items-center bg-[#16171a] pl-[120px]">
      <div
        className="h-[140px] w-[160px] bg-[#f2f2f2] p-5"
        style={{
          transform: on ? 'translateX(var(--p-distance))' : 'none',
          transition: on ? 'transform var(--p-duration) var(--p-ease) var(--p-delay)' : 'none',
        }}
      >
        <div className="h-2.5 w-[60px] bg-[#16171a]" />
        <div className="mt-2.5 h-1.5 w-[100px] bg-[#9a9a9a]" />
      </div>
    </div>
  )
}
