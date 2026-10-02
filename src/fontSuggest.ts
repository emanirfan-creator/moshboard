// Fonts to suggest for a new font block, from what the board's references set their
// text in: websites (read by headless Chrome), components (reported by the sandbox,
// kept on the frame) and text blocks. Like palettes, each reference gets the same say.
import type { UsedFont } from '../shared/font-probe.ts'
import type { FontFamily } from '../shared/fonts.ts'
import { api } from './api'
import { getState, updateFrame } from './store'

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|emoji|math|fangsong|ui-[\w-]+|-apple-system|blinkmacsystemfont|apple color emoji|segoe ui( emoji| symbol)?|noto color emoji)$/i

/**
 * Well-known fonts that can't be loaded here (commercial, or Apple's system font), and
 * the free family people usually reach for instead. Matched on the start of the name.
 */
const ALTERNATIVES: [RegExp, string][] = [
  [/^(sf pro|sf ui|san francisco|system)/, 'Inter'],
  [/^(sf mono|berkeley mono|söhne mono|sohne mono|operator mono|dank mono)/, 'JetBrains Mono'],
  [/^(söhne|sohne|suisse|neue haas|haas grot|helvetica|graphik|gt america|aktiv|untitled sans|diatype|neue montreal|basier)/, 'Inter'],
  [/^(circular|gt walsheim|cera|lineto|tt commons|euclid)/, 'DM Sans'],
  [/^(proxima|gotham|brandon|museo sans|mark)/, 'Montserrat'],
  [/^(avenir|nunito)/, 'Nunito Sans'],
  [/^(futura|century gothic)/, 'Jost'],
  [/^(founders grotesk|founders|grotesk)/, 'Hanken Grotesk'],
  [/^(gt super|tiempos|canela|ogg|reckless|freight|lyon|domaine|editorial new|pp editorial)/, 'Playfair Display'],
  [/^(gt sectra|recoleta|cooper)/, 'Fraunces'],
  [/^(times|georgia|garamond|caslon|minion)/, 'EB Garamond'],
]
const BY_KIND: Record<string, string> = { 'sans-serif': 'Inter', serif: 'Source Serif 4', monospace: 'JetBrains Mono' }

/** The family names in a font-family stack, cleaned up (next/font's `__Inter_d65c78` → `Inter`, `sohne-var` → `sohne`). */
function families(stack: string) {
  return stack
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s && !GENERIC.test(s) && !/fallback/i.test(s))
    .map((s) => s.replace(/^__(.+?)_[0-9a-f]{5,}$/i, '$1').replace(/_/g, ' ').replace(/[\s-]+(variable|var|vf)$/i, '').trim())
}

/**
 * A family from the stack that can actually be used here (Google Fonts, then this Mac).
 * Failing that, the usual free stand-in for the first font named, then a plain one of its kind.
 */
function resolve(stack: string, list: { mac: FontFamily[]; google: FontFamily[] }) {
  const find = (name: string) => {
    const n = name.toLowerCase()
    return list.google.find((f) => f.family.toLowerCase() === n) ?? list.mac.find((f) => f.family.toLowerCase() === n)
  }
  const names = families(stack)
  for (const name of names) {
    const hit = find(name)
    if (hit) return hit
  }
  for (const name of names) {
    const alt = ALTERNATIVES.find(([re]) => re.test(name.toLowerCase()))
    if (alt) return find(alt[1])
  }
  const kind = /\b(sans-serif|serif|monospace)\s*$/i.exec(stack)?.[1].toLowerCase()
  return names.length && kind ? find(BY_KIND[kind]) : undefined
}

const siteJobs = new Map<string, Promise<UsedFont[]>>()

/** A site's fonts: read once, then kept on the frame. */
function fontsOfSite(id: string, url: string, cached?: UsedFont[]) {
  if (cached) return Promise.resolve(cached)
  let job = siteJobs.get(url)
  if (!job) {
    job = api.siteFonts(url).catch(() => [])
    siteJobs.set(url, job)
  }
  return job.then((fonts) => {
    if (fonts.length) updateFrame(id, { usedFonts: fonts })
    return fonts
  })
}

export interface FontSuggestion {
  font: FontFamily
  /** the weight it's used at most */
  weight: number
}

/** Best matches first; families that already have a font block are left out (this is for adding another). */
export async function suggestFonts(list: { mac: FontFamily[]; google: FontFamily[] }, max = 4): Promise<FontSuggestion[]> {
  const frames = getState().board?.frames ?? []
  const taken = new Set(frames.filter((f) => f.type === 'swatch' && f.font).map((f) => f.font!.toLowerCase()))
  const sources = await Promise.all(
    frames.map(async (f): Promise<UsedFont[]> => {
      if (f.type === 'url' && f.src) return fontsOfSite(f.id, f.src, f.usedFonts)
      if (f.type === 'code') return f.usedFonts ?? []
      if (f.type === 'text' && f.font && f.text?.trim()) return [{ stack: `"${f.font}"`, weight: f.weight ?? 400, score: 1 }]
      return []
    }),
  )
  const tally = new Map<string, { font: FontFamily; score: number; weights: Map<number, number> }>()
  for (const used of sources) {
    const total = used.reduce((t, u) => t + u.score, 0)
    for (const u of used) {
      const font = total && resolve(u.stack, list)
      if (!font || taken.has(font.family.toLowerCase())) continue
      const key = `${font.source}:${font.family}`
      const t = tally.get(key) ?? { font, score: 0, weights: new Map() }
      const share = u.score / total
      t.score += share
      t.weights.set(u.weight, (t.weights.get(u.weight) ?? 0) + share)
      tally.set(key, t)
    }
  }
  return [...tally.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((t) => ({ font: t.font, weight: [...t.weights].sort((a, b) => b[1] - a[1])[0][0] }))
}
