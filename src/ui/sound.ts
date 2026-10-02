// Detent clicks for controls: a short filtered noise burst each time a value
// crosses a step, pitched by position. Synthesized, so there are no audio files.

const KEY = 'mb:sounds'
/** Overall loudness of every control sound. */
const VOLUME = 7
let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null
let out: AudioNode | null = null
let last = 0

export function soundsOn() {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSounds(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // storage unavailable: stays on for this session
  }
}

function audio() {
  if (!ctx) {
    ctx = new AudioContext()
    noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.03), ctx.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    // A limiter on the way out, so overlapping clicks get louder without crackling.
    const limit = ctx.createDynamicsCompressor()
    limit.threshold.value = -6
    limit.knee.value = 4
    limit.ratio.value = 12
    limit.attack.value = 0.001
    limit.release.value = 0.05
    limit.connect(ctx.destination)
    out = limit
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

/**
 * One click. `pos` is 0..1 along the control (higher = brighter tick);
 * `edge` is a heavier thunk for hitting the end of the range; `volume` scales it
 * (a spring's bounces fade out).
 */
export function tick(pos: number, edge = false, volume = 1) {
  if (!soundsOn()) return
  const now = performance.now()
  // Fast drags cross many steps per frame; cap the rate so it purrs instead of buzzing.
  if (now - last < 22 && !edge && volume === 1) return
  last = now
  const a = audio()
  const t = a.currentTime
  const src = a.createBufferSource()
  src.buffer = noise
  const band = a.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = edge ? 900 : 1800 + pos * 2600
  band.Q.value = edge ? 4 : 9
  const gain = a.createGain()
  const peak = (edge ? 0.22 : 0.12) * volume * VOLUME
  const len = edge ? 0.03 : 0.012
  gain.gain.setValueAtTime(peak, t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + len)
  src.connect(band).connect(gain).connect(out ?? a.destination)
  src.start(t)
  src.stop(t + len + 0.01)
}

const buckets = new Map<string, number>()

/**
 * A detent: clicks when `bucket` changes for control `id`, so any control can
 * feel notched (a timeline end crossing a time step, a curve handle crossing a
 * grid line). `pos` 0..1 pitches the click; `edge` is the end-stop thunk.
 */
export function detent(id: string, bucket: number, pos: number, edge = false) {
  const prev = buckets.get(id)
  buckets.set(id, bucket)
  if (prev !== undefined && prev !== bucket) tick(pos, edge)
}

/** Rising sweep when a scan finds controls: one blip per animation found, then a lock-in. */
export function scanChirp(groups: number) {
  if (!soundsOn()) return
  const n = Math.max(1, Math.min(8, groups))
  for (let i = 0; i < n; i++) setTimeout(() => tick(i / n, false, 0.8), i * 55)
  setTimeout(() => tick(1, true, 0.6), n * 55 + 40)
}

/** A scan that found nothing: one low, quiet thunk. */
export function scanEmpty() {
  tick(0, true, 0.5)
}
