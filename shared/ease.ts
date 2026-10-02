import type { Bezier } from './params.ts'

export const NAMED_EASES: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  'out-cubic': [0.33, 1, 0.68, 1],
  'out-quart': [0.25, 1, 0.5, 1],
  'out-expo': [0.16, 1, 0.3, 1],
  'in-out-cubic': [0.65, 0, 0.35, 1],
  'in-out-quart': [0.76, 0, 0.24, 1],
}

/** y of a CSS cubic-bezier at progress x (bisection on the x curve). */
export function bezierAt([x1, y1, x2, y2]: Bezier, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const cx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3
  let lo = 0
  let hi = 1
  let t = x
  for (let i = 0; i < 22; i++) {
    t = (lo + hi) / 2
    if (cx(t) < x) lo = t
    else hi = t
  }
  return 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3
}

function rmse(b: Bezier, samples: number[]): number {
  const n = samples.length
  let s = 0
  for (let i = 0; i < n; i++) {
    const d = bezierAt(b, i / (n - 1)) - samples[i]
    s += d * d
  }
  return Math.sqrt(s / n)
}

/** Fit a cubic-bezier to a normalized 0→1 progress curve sampled at even time steps. */
export function fitBezier(progress: number[]): { bezier: Bezier; rmse: number; nearest: string } {
  const samples = resample(progress, 32)
  let best: Bezier = [0.25, 0.1, 0.25, 1]
  let bestErr = Infinity
  const steps = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
  for (const x1 of steps)
    for (const y1 of steps)
      for (const x2 of steps)
        for (const y2 of steps) {
          const b: Bezier = [x1, y1, x2, y2]
          const e = rmse(b, samples)
          if (e < bestErr) {
            bestErr = e
            best = b
          }
        }
  // Small local refinement around the grid winner.
  for (let pass = 0; pass < 3; pass++) {
    const step = 0.05 / (pass + 1)
    for (let i = 0; i < 4; i++) {
      for (const d of [-step, step]) {
        const c = [...best] as Bezier
        c[i] = i % 2 === 0 ? Math.min(1, Math.max(0, c[i] + d)) : c[i] + d
        const e = rmse(c, samples)
        if (e < bestErr) {
          bestErr = e
          best = c
        }
      }
    }
  }
  let nearest = 'linear'
  let nearestErr = Infinity
  for (const [name, b] of Object.entries(NAMED_EASES)) {
    const e = rmse(b, samples)
    if (e < nearestErr) {
      nearestErr = e
      nearest = name
    }
  }
  return {
    bezier: best.map((n) => Math.round(n * 100) / 100) as Bezier,
    rmse: Math.round(bestErr * 1000) / 1000,
    nearest,
  }
}

function resample(xs: number[], n: number): number[] {
  if (xs.length < 2) return Array.from({ length: n }, (_, i) => i / (n - 1))
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * (xs.length - 1)
    const a = Math.floor(t)
    const b = Math.min(xs.length - 1, a + 1)
    return xs[a] + (xs[b] - xs[a]) * (t - a)
  })
}
