import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { seconds, soundFeel } from '../../shared/sound.ts'
import type { Clip, Frame } from '../../shared/types.ts'
import { assetUrl } from '../actions'
import { fitFrame, updateFrame, useStore } from '../store'
import { BLOCK_HEAD, BLOCK_PAD } from '../canvas/blocks'
import { cue, drop, grab, shift, tick } from '../ui/sound'
import {
  loadSpotify,
  measure,
  PAD,
  PAD_GAP,
  padsSize,
  PADS_PER_ROW,
  playSound,
  setLoop,
  spotifyLink,
  spotifyPlayers,
  spotifyPlaying,
  stopSound,
  useLooping,
  usePlaying,
  type SpotifyController,
} from './audio'

// Sound blocks, drawn as small pieces of hardware: a reel you push to play, a little screen,
// keys and a knob. A file you own gets the whole device; a tab recording becomes a row of pads;
// a Spotify link keeps Spotify's own player in the window, driven by the keys around it.

const SPEEDS = [0.75, 1, 1.33]
const stop = (e: React.PointerEvent) => e.stopPropagation()

export function AudioFrame({ frame, seen }: { frame: Frame; seen: boolean }) {
  if (frame.music) return seen ? <SpotifyDeck frame={frame} /> : <div className="deck" />
  if (frame.clips) return <Pads frame={frame} clips={frame.clips} />
  return <SoundDeck frame={frame} />
}

// Files measured this session, so a block isn't read twice while its reading saves.
const measuring = new Set<string>()

function SoundDeck({ frame }: { frame: Frame }) {
  const now = usePlaying()
  const looping = useLooping() === frame.id
  const on = now?.key === frame.id
  const [speed, setSpeed] = useState(1)
  // Turning the knob shows its value on the screen for a moment.
  const [showSpeed, setShowSpeed] = useState(false)
  const r = frame.sound

  useEffect(() => {
    if (r || !frame.src || measuring.has(frame.src)) return
    measuring.add(frame.src)
    measure(assetUrl(frame.src))
      .then((sound) => updateFrame(frame.id, { sound }))
      .catch(() => {})
  }, [frame.id, frame.src, !!r])

  const play = () => {
    if (!frame.src) return
    if (on) return stopSound()
    playSound(frame.id, assetUrl(frame.src), SPEEDS[speed])
  }
  const turn = () => {
    const next = (speed + 1) % SPEEDS.length
    setSpeed(next)
    tick(next / (SPEEDS.length - 1))
    setShowSpeed(true)
  }
  useEffect(() => {
    if (!showSpeed) return
    const t = setTimeout(() => setShowSpeed(false), 1200)
    return () => clearTimeout(t)
  }, [showSpeed, speed])

  return (
    <div className="deck deck-sound">
      <Screws />
      <button className="reel" data-on={on || undefined} onPointerDown={stop} onClick={play} title="Play" aria-label="Play">
        <Reel speed={SPEEDS[speed]} />
      </button>
      <div className="deck-side">
        <div className="deck-screen">
          <Wave peaks={r?.peaks} playing={on ? now : null} />
          <div className="deck-read">
            {showSpeed ? (
              <span>Speed {SPEEDS[speed]}×</span>
            ) : (
              <>
                <span>{r ? seconds(r.length) : '…'}</span>
                <span className="dim">{r ? soundFeel(r) : ''}</span>
              </>
            )}
          </div>
        </div>
        <div className="deck-keys">
          <button className="deck-key deck-key-main" onPointerDown={stop} onClick={play} title={on ? 'Stop' : 'Play'} aria-label={on ? 'Stop' : 'Play'}>
            {on ? <StopGlyph /> : <PlayGlyph />}
          </button>
          <button
            className="deck-key"
            data-on={looping || undefined}
            onPointerDown={stop}
            onClick={() => {
              setLoop(frame.id, !looping)
              cue(looping ? 'toggle-off' : 'toggle-on')
              if (!looping && !on) play()
            }}
            title="Loop"
            aria-label="Loop"
          >
            <LoopGlyph />
          </button>
          <span className="deck-gap" />
          <button className="knob" onPointerDown={stop} onClick={turn} title="Speed" aria-label={`Speed ${SPEEDS[speed]}×`}>
            <Knob turn={(speed - 1) * 60} />
          </button>
        </div>
      </div>
    </div>
  )
}

function Pads({ frame, clips }: { frame: Frame; clips: Clip[] }) {
  const now = usePlaying()
  // Pads recorded here come measured; ones added by hand (or by Claude) are read once.
  const unread = clips.some((c) => !c.sound)
  useEffect(() => {
    if (!unread || measuring.has(frame.id)) return
    measuring.add(frame.id)
    Promise.all(clips.map(async (c) => (c.sound ? c : { ...c, sound: await measure(assetUrl(c.src)).catch(() => undefined) })))
      .then((next) => updateFrame(frame.id, { clips: next }))
      .catch(() => {})
  }, [frame.id, unread])
  // The block fits its pads (blocks from before the empty pad, or edited by hand, catch up).
  const want = padsSize(clips.length)
  const inLayout = !!frame.natural
  useEffect(() => {
    if (inLayout) return
    const w = want.w + BLOCK_PAD * 2
    const h = want.h + BLOCK_HEAD + BLOCK_PAD
    if (Math.abs(frame.w - w) > 1 || Math.abs(frame.h - h) > 1) fitFrame(frame.id, { w, h })
  }, [frame.id, want.w, want.h, frame.w, frame.h, inLayout])
  const pads = useRef(new Map<number, HTMLElement>())
  const [held, setHeld] = useState<number | null>(null)
  const cols = Math.min(PADS_PER_ROW, clips.length)
  // Once the new order renders, the pads already stand where they were dropped: drop the offsets before paint.
  useLayoutEffect(() => {
    for (const el of pads.current.values()) el.style.transform = ''
  }, [clips])

  // Press a pad to play it; drag it to move it. The held pad follows the pointer and the
  // others slide into the slots they'll take; the new order saves on release.
  const press = (i: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (e.button !== 0 || clips.length < 2) return
    const grid = e.currentTarget.parentElement!
    const zoom = grid.getBoundingClientRect().width / grid.offsetWidth || 1
    const step = PAD + PAD_GAP
    const n = clips.length
    const pos = (k: number) => ({ x: (k % cols) * step, y: Math.floor(k / cols) * step })
    const sx = e.clientX
    const sy = e.clientY
    let to = i
    let moving = false
    const place = () => {
      const order = clips.map((_, k) => k)
      order.splice(to, 0, ...order.splice(i, 1))
      order.forEach((k, slot) => {
        if (k === i) return
        const el = pads.current.get(k)
        if (!el) return
        const a = pos(k)
        const b = pos(slot)
        el.style.transform = `translate(${b.x - a.x}px, ${b.y - a.y}px)`
      })
    }
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / zoom
      const dy = (ev.clientY - sy) / zoom
      if (!moving) {
        if (Math.hypot(dx, dy) < 4) return
        moving = true
        setHeld(i)
        document.body.dataset.grabbing = ''
        grab(i / Math.max(1, n - 1))
      }
      const el = pads.current.get(i)
      if (el) el.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`
      const at = pos(i)
      const col = Math.max(0, Math.min(cols - 1, Math.round((at.x + dx) / step)))
      const row = Math.max(0, Math.round((at.y + dy) / step))
      const next = Math.max(0, Math.min(n - 1, row * cols + col))
      if (next !== to) {
        to = next
        place()
        shift(to / Math.max(1, n - 1))
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (!moving) return
      delete document.body.dataset.grabbing
      drop(to / Math.max(1, n - 1))
      setHeld(null)
      if (to !== i) {
        const next = [...clips]
        next.splice(to, 0, ...next.splice(i, 1))
        updateFrame(frame.id, { clips: next })
      } else for (const el of pads.current.values()) el.style.transform = ''
      // The click that follows a drag (if the browser sends one) isn't a press.
      const swallow = (ev: MouseEvent) => ev.stopPropagation()
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div className="deck deck-pads">
      <div className="pads" data-sortable={clips.length > 1 || undefined} data-reordering={held !== null || undefined} style={{ gridTemplateColumns: `repeat(${cols}, ${PAD}px)` }}>
        {clips.map((c, i) => {
          const key = `${frame.id}:${i}`
          return (
            <button
              key={c.src}
              ref={(el) => void (el ? pads.current.set(i, el) : pads.current.delete(i))}
              className="sound-pad"
              data-on={now?.key === key || undefined}
              data-held={held === i || undefined}
              onPointerDown={press(i)}
              onClick={() => playSound(key, assetUrl(c.src))}
              title={c.sound ? `${seconds(c.sound.length)} · ${soundFeel(c.sound)}` : c.name}
            >
              {c.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SpotifyDeck({ frame }: { frame: Frame }) {
  // Spotify's own controls take clicks once the block is selected (before that, a click selects it).
  const selected = useStore((s) => s.selected.length === 1 && s.selected[0] === frame.id)
  const slot = useRef<HTMLDivElement>(null)
  const ctl = useRef<SpotifyController | null>(null)
  const [state, setPlay] = useState({ paused: true, position: 0, duration: 0 })
  const [failed, setFailed] = useState(false)
  const link = spotifyLink(frame.src ?? '')

  useEffect(() => {
    const host = slot.current
    if (!host || !link) return
    // The API swaps the element it's given for its iframe: give it one of its own.
    const target = document.createElement('div')
    host.appendChild(target)
    let gone = false
    loadSpotify()
      .then((api) =>
        api.createController(target, { uri: link.uri, width: '100%', height: 152 }, (c) => {
          if (gone) return c.destroy()
          ctl.current = c
          spotifyPlayers.set(frame.id, c)
          c.addListener('playback_update', (e) => {
            setPlay({ paused: e.data.isPaused, position: e.data.position, duration: e.data.duration })
            spotifyPlaying(frame.id, !e.data.isPaused)
          })
        }),
      )
      .catch(() => setFailed(true))
    return () => {
      gone = true
      ctl.current?.destroy()
      ctl.current = null
      spotifyPlayers.delete(frame.id)
      spotifyPlaying(frame.id, false)
      host.replaceChildren()
    }
  }, [frame.id, link?.uri])

  const on = !state.paused
  const left = Math.max(0, state.duration - state.position) / 1000
  const toggle = () => ctl.current?.togglePlay()
  return (
    <div className="deck deck-spotify">
      <Screws top />
      <div className="deck-window" data-live={selected || undefined}>
        <div ref={slot} className="spotify-slot" />
        {failed && (
          <a className="spotify-fallback" href={frame.src} target="_blank" rel="noreferrer" onPointerDown={stop}>
            Open in Spotify
          </a>
        )}
      </div>
      <div className="deck-keys">
        <button className="reel reel-small" data-on={on || undefined} onPointerDown={stop} onClick={toggle} title={on ? 'Pause' : 'Play'} aria-label={on ? 'Pause' : 'Play'}>
          <Reel speed={1} />
        </button>
        <button className="deck-key deck-key-main" onPointerDown={stop} onClick={toggle} title={on ? 'Pause' : 'Play'} aria-label={on ? 'Pause' : 'Play'}>
          {on ? <PauseGlyph /> : <PlayGlyph />}
        </button>
        <span className="deck-gap" />
        {state.duration > 0 && <span className="deck-time">{clock(left)}</span>}
      </div>
    </div>
  )
}

const clock = (s: number) => `${Math.floor(Math.ceil(s) / 60)}:${String(Math.ceil(s) % 60).padStart(2, '0')}`

function Screws({ top }: { top?: boolean }) {
  return (
    <>
      <i className="screw" style={{ left: 7, top: 7 }} />
      <i className="screw" style={{ right: 7, top: 7 }} />
      {!top && <i className="screw" style={{ left: 7, bottom: 7 }} />}
      {!top && <i className="screw" style={{ right: 7, bottom: 7 }} />}
    </>
  )
}

const RIDGES = Array.from({ length: 17 }, (_, i) => 36 + i * 3)

function Reel({ speed }: { speed: number }) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden>
      <circle cx="100" cy="100" r="96" className="reel-well" />
      <circle cx="100" cy="100" r="90" className="reel-plate" />
      <g className="reel-spin" style={{ animationDuration: `${2.4 / speed}s` }}>
        {RIDGES.map((r) => (
          <circle key={r} cx="100" cy="100" r={r} className={r % 2 ? 'reel-ridge' : 'reel-ridge alt'} />
        ))}
        <circle cx="100" cy="100" r="30" className="reel-hub" />
        {/* A scoop in the rim, where a thumb pushes it round. */}
        <path d="M78 12 A24 24 0 0 0 122 12" className="reel-notch" />
        <path d="M80 12.5 A22 22 0 0 0 120 12.5" className="reel-notch-edge" />
      </g>
      <circle cx="100" cy="100" r="6" className="reel-mark" />
    </svg>
  )
}

/** The sound's loudness over time; the part already played lights up. */
function Wave({ peaks, playing }: { peaks?: number[]; playing: { started: number; length: number } | null }) {
  const [p, setP] = useState(0)
  useEffect(() => {
    if (!playing) return setP(0)
    let raf = 0
    const step = () => {
      const t = playing.length ? (performance.now() - playing.started) / playing.length : 0
      setP(Math.min(1, t))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing])
  const bars = peaks ?? []
  const n = bars.length || 1
  return (
    <svg className="deck-wave" viewBox={`0 0 ${n * 2} 34`} preserveAspectRatio="none" aria-hidden>
      {bars.map((a, i) => {
        const h = Math.max(0.8, a * 32)
        return <rect key={i} x={i * 2} y={17 - h / 2} width={1.1} height={h} data-on={playing && i / n <= p ? true : undefined} />
      })}
      {playing && <line x1={p * n * 2} x2={p * n * 2} y1={0} y2={34} className="deck-head" />}
    </svg>
  )
}

const TICKS = Array.from({ length: 11 }, (_, i) => (-135 + i * 27) * (Math.PI / 180))

function Knob({ turn }: { turn: number }) {
  return (
    <svg viewBox="0 0 44 44" aria-hidden>
      {TICKS.map((a, i) => (
        <line key={i} x1={22 + Math.sin(a) * 17} y1={22 - Math.cos(a) * 17} x2={22 + Math.sin(a) * 20} y2={22 - Math.cos(a) * 20} className="knob-tick" />
      ))}
      <circle cx="22" cy="22" r="13" className="knob-cap" />
      <line x1="22" y1="22" x2="22" y2="11" className="knob-line" style={{ transform: `rotate(${turn}deg)` }} />
    </svg>
  )
}

const PlayGlyph = () => (
  <svg viewBox="0 0 16 16" aria-hidden>
    <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" />
  </svg>
)
const PauseGlyph = () => (
  <svg viewBox="0 0 16 16" aria-hidden>
    <rect x="4" y="3.5" width="2.6" height="9" rx="0.6" fill="currentColor" />
    <rect x="9.4" y="3.5" width="2.6" height="9" rx="0.6" fill="currentColor" />
  </svg>
)
const StopGlyph = () => (
  <svg viewBox="0 0 16 16" aria-hidden>
    <rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="currentColor" />
  </svg>
)
const LoopGlyph = () => (
  <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V6a2 2 0 0 1 2-2h7l-2-2M13 9v1a2 2 0 0 1-2 2H4l2 2" />
  </svg>
)
