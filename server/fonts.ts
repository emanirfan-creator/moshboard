// Font lists for the picker: families installed on this Mac (via AppKit) and the
// Google Fonts catalog (cached on disk so the list still works offline).
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { googleHref, weightFromStyle, type FontFamily } from '../shared/fonts.ts'

const CACHE = path.resolve('node_modules/.cache/moshboard/google-fonts-v2.json')
const DAY = 24 * 60 * 60 * 1000

/** AppKit's 0–15 weight scale, for styles whose name doesn't say (e.g. "W6"). */
const APPKIT_WEIGHT: Record<number, number> = { 2: 200, 3: 300, 4: 300, 5: 400, 6: 500, 7: 600, 8: 600, 9: 700, 10: 800, 11: 900, 12: 900, 13: 900, 14: 900 }

function macFonts(): Promise<FontFamily[]> {
  // Each family with its styles: { family: [[styleName, appkitWeight], …] }
  const script = `ObjC.import("AppKit")
const m = $.NSFontManager.sharedFontManager, out = {}
for (const f of ObjC.deepUnwrap(m.availableFontFamilies)) out[f] = (ObjC.deepUnwrap(m.availableMembersOfFontFamily(f)) || []).map((x) => [x[1], x[2]])
JSON.stringify(out)`
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve([])
    execFile('osascript', ['-l', 'JavaScript', '-e', script], { timeout: 10_000 }, (err, out) => {
      if (err) return resolve([])
      try {
        const families: Record<string, [string, number][]> = JSON.parse(out)
        resolve(
          Object.entries(families)
            .filter(([n]) => !n.startsWith('.'))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([family, styles]) => ({
              family,
              source: 'mac' as const,
              weights: styles.map(([style, w]) => weightFromStyle(style) ?? APPKIT_WEIGHT[w] ?? 400),
            })),
        )
      } catch {
        resolve([])
      }
    })
  })
}

interface GoogleMeta {
  family: string
  category: string
  popularity: number
  fonts: Record<string, unknown>
  axes: { tag: string; min: number; max: number }[]
}

async function googleFonts(): Promise<FontFamily[]> {
  const cached = fs.existsSync(CACHE) ? fs.statSync(CACHE) : null
  if (cached && Date.now() - cached.mtimeMs < 7 * DAY) return JSON.parse(fs.readFileSync(CACHE, 'utf8'))
  try {
    const r = await fetch('https://fonts.google.com/metadata/fonts')
    if (!r.ok) throw new Error(`${r.status}`)
    // The response may start with an anti-JSON-hijacking prefix.
    const text = (await r.text()).replace(/^\)\]\}'\s*/, '')
    const list: GoogleMeta[] = JSON.parse(text).familyMetadataList
    const fonts = list
      .sort((a, b) => a.popularity - b.popularity)
      .map((m): FontFamily => {
        const wght = m.axes.find((a) => a.tag === 'wght')
        const weights = Object.keys(m.fonts)
          .filter((k) => /^\d+$/.test(k))
          .map(Number)
          .sort((a, b) => a - b)
        const range = wght && { min: wght.min, max: wght.max }
        return { family: m.family, source: 'google', category: m.category, href: googleHref(m.family, range ?? weights), weights: range ?? weights }
      })
    fs.mkdirSync(path.dirname(CACHE), { recursive: true })
    fs.writeFileSync(CACHE, JSON.stringify(fonts))
    return fonts
  } catch {
    // Offline: use an older cached list if there is one.
    return cached ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : []
  }
}

let job: Promise<{ mac: FontFamily[]; google: FontFamily[] }> | undefined

export function listFonts() {
  job ??= Promise.all([macFonts(), googleFonts()]).then(([mac, google]) => ({ mac, google }))
  // Don't keep an empty result around (e.g. Google was unreachable): try again next time.
  job.then((r) => !r.google.length && (job = undefined))
  return job
}
