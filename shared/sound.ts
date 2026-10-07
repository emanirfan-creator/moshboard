import type { SoundReading } from './types.ts'

// Short sounds, measured from their samples: shared by the app (which decodes them in the
// page, locally and on the website) and the export (which words them for design.md).

const WIN = 0.005 // seconds per envelope step

/** Mono loudness per 5 ms step. */
function envelope(x: Float32Array, rate: number) {
  const n = Math.max(1, Math.round(rate * WIN))
  const out = new Float32Array(Math.ceil(x.length / n))
  for (let i = 0; i < out.length; i++) {
    let s = 0
    const end = Math.min(x.length, (i + 1) * n)
    for (let j = i * n; j < end; j++) s += x[j] * x[j]
    out[i] = Math.sqrt(s / Math.max(1, end - i * n))
  }
  return { env: out, step: n }
}

const db = (a: number) => 20 * Math.log10(Math.max(a, 1e-9))

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(a * k)
        const s = Math.sin(a * k)
        const p = i + k
        const q = p + len / 2
        const tr = re[q] * c - im[q] * s
        const ti = re[q] * s + im[q] * c
        re[q] = re[p] - tr
        im[q] = im[p] - ti
        re[p] += tr
        im[p] += ti
      }
    }
  }
}

/** Where the energy sits, the strongest tone, and how tonal it is, from up to 4096 samples at `at`. */
function spectrum(x: Float32Array, rate: number, from: number, to: number) {
  const N = 4096
  const len = Math.min(N, to - from)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let i = 0; i < len; i++) re[i] = x[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, len - 1)))
  fft(re, im)
  const hz = rate / N
  const lo = Math.ceil(60 / hz)
  const hi = Math.min(N / 2 - 1, Math.floor(16000 / hz))
  let sum = 0
  let weighted = 0
  let logSum = 0
  let best = lo
  const mag = new Float64Array(N / 2)
  for (let k = lo; k <= hi; k++) {
    const m = Math.hypot(re[k], im[k])
    mag[k] = m
    sum += m
    weighted += m * k * hz
    logSum += Math.log(m * m + 1e-12)
    if (m > mag[best]) best = k
  }
  const count = hi - lo + 1
  const mean = (sum * sum) / count / count
  // Spectral flatness: 1 for noise, near 0 for a pure tone.
  const flat = Math.exp(logSum / count) / Math.max(mean, 1e-12)
  // The peak's bin, refined between its neighbours.
  const a = mag[best - 1] ?? 0
  const b = mag[best]
  const c = mag[best + 1] ?? 0
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1)
  return {
    bright: sum ? weighted / sum : 0,
    pitch: (best + (Number.isFinite(shift) ? shift : 0)) * hz,
    tonal: Math.max(0, Math.min(1, 1 - Math.pow(flat, 0.25))),
  }
}

/** Measures a sound. `x` is mono; silence before and after it is ignored. */
export function readSound(x: Float32Array, rate: number): SoundReading {
  const { env, step } = envelope(x, rate)
  let top = 0
  let at = 0
  for (let i = 0; i < env.length; i++) if (env[i] > top) ((top = env[i]), (at = i))
  const floor = top * Math.pow(10, -42 / 20)
  let first = 0
  while (first < at && env[first] < floor) first++
  let last = env.length - 1
  while (last > at && env[last] < floor) last--
  let peakAbs = 0
  for (let i = first * step; i < Math.min(x.length, (last + 1) * step); i++) peakAbs = Math.max(peakAbs, Math.abs(x[i]))
  const s = spectrum(x, rate, at * step, Math.min(x.length, (last + 1) * step))
  const span = last - first + 1
  // The drawing comes from the samples themselves: a short click is only a few envelope steps long.
  const n = 64
  const a0 = first * step
  const len = Math.max(n, Math.min(x.length, (last + 1) * step) - a0)
  const peaks = Array.from({ length: n }, (_, i) => {
    let m = 0
    for (let j = a0 + Math.floor((i * len) / n); j < a0 + Math.floor(((i + 1) * len) / n); j++) m = Math.max(m, Math.abs(x[j] ?? 0))
    return Math.round((m / (peakAbs || 1)) * 100) / 100
  })
  const r3 = (v: number) => Math.round(v * 1000) / 1000
  return {
    length: r3((span * step) / rate),
    attack: r3(((at - first) * step) / rate),
    fade: r3(((last - at) * step) / rate),
    pitch: s.tonal > 0.45 ? Math.round(s.pitch) : undefined,
    peak: Math.round(db(peakAbs) * 10) / 10,
    bright: Math.round(s.bright),
    tonal: Math.round(s.tonal * 100) / 100,
    peaks,
  }
}

/** Where each sound in a recording starts and ends (in samples), split at the silences between them. */
export function splitAtSilences(x: Float32Array, rate: number): { start: number; end: number }[] {
  const { env, step } = envelope(x, rate)
  let top = 0
  for (const v of env) top = Math.max(top, v)
  if (top < 1e-4) return []
  const on = Math.max(top * Math.pow(10, -36 / 20), 2e-4)
  const gap = Math.round(0.06 / WIN) // quieter than this long ends a sound
  const parts: { a: number; b: number }[] = []
  let a = -1
  let quiet = 0
  for (let i = 0; i < env.length; i++) {
    if (env[i] >= on) {
      if (a < 0) a = i
      quiet = 0
    } else if (a >= 0 && ++quiet > gap) {
      parts.push({ a, b: i - quiet })
      a = -1
      quiet = 0
    }
  }
  if (a >= 0) parts.push({ a, b: env.length - 1 - quiet })
  const pre = Math.round(0.005 * rate)
  const post = Math.round(0.04 * rate)
  const max = Math.round(3 * rate)
  return parts
    .filter((p) => (p.b - p.a + 1) * WIN >= 0.012)
    .map((p) => {
      const start = Math.max(0, p.a * step - pre)
      return { start, end: Math.min(x.length, (p.b + 1) * step + post, start + max) }
    })
}

/** 16-bit mono WAV. */
export function encodeWav(x: Float32Array, rate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + x.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + x.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, x.length * 2, true)
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 0x7fff, true)
  return buf
}

const height = (r: SoundReading) => {
  const f = r.pitch ?? r.bright
  return f >= 1200 ? 'High' : f >= 400 ? 'Mid' : 'Low'
}

const texture = (r: SoundReading) =>
  r.attack > 0.02 ? 'soft' : r.tonal > 0.6 && r.fade > 0.3 ? 'ringing' : r.bright > 3000 && r.tonal < 0.5 ? 'crisp' : r.fade < 0.12 ? 'dry' : 'round'

/** Two plain words for how it sounds: "High, crisp". */
export const soundFeel = (r: SoundReading) => `${height(r)}, ${texture(r)}`

/** A name for a sound split from a recording: Tick, Click, Tap, Pop, Chime, Whoosh. */
export function soundName(r: SoundReading) {
  if (r.length < 0.04) return 'Tick'
  if (r.tonal > 0.6 && r.length > 0.25) return 'Chime'
  if (r.tonal < 0.35 && r.length > 0.25) return 'Whoosh'
  if (r.length < 0.25) return height(r) === 'Low' ? (r.length < 0.1 ? 'Tap' : 'Pop') : 'Click'
  return 'Sound'
}

/** "84 ms", "1.2 s" */
export const seconds = (s: number) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(s < 10 ? 2 : 1)} s`)

/** "1.9 kHz", "440 Hz" */
export const hertz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(1)} kHz` : `${Math.round(f)} Hz`)

/** The measured values as label/value rows (the side panel and design.md use the same words). */
export function soundFacts(r: SoundReading): [string, string][] {
  return [
    ['Length', seconds(r.length)],
    ['Gets loud in', seconds(r.attack)],
    ['Fades over', seconds(r.fade)],
    ...(r.pitch ? ([['Pitch', hertz(r.pitch)]] as [string, string][]) : []),
    ['Brightness', hertz(r.bright)],
    ['Loudest', `${r.peak} dB`],
    ['Feel', soundFeel(r)],
  ]
}
