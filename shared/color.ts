// Color math for palettes: sRGB ↔ OKLab/OKLCH, harmony-based generation (Coolors-style),
// whole-palette adjustments, shades, contrast and human color names.

export interface PaletteColor {
  hex: string
  locked?: boolean
}

type RGB = [number, number, number] // 0–1
type Lab = [number, number, number] // OKLab
type LCH = [number, number, number] // L 0–1, C ~0–0.37, h degrees

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB
}

export function rgbToHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((n) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0')).join('')}`
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

export function rgbToOklab([r, g, b]: RGB): Lab {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function oklabToRgb([L, a, b]: Lab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

const labToLch = ([L, a, b]: Lab): LCH => [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360]
const lchToLab = ([L, C, h]: LCH): Lab => [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)]

const inGamut = (rgb: RGB) => rgb.every((c) => c >= -0.0005 && c <= 1.0005)

/** OKLCH → hex, reducing chroma until it fits in sRGB (keeps hue and lightness). */
export function lchToHex([L, C, h]: LCH): string {
  let c = C
  let rgb = oklabToRgb(lchToLab([L, c, h]))
  for (let i = 0; i < 24 && !inGamut(rgb); i++) {
    c *= 0.9
    rgb = oklabToRgb(lchToLab([L, c, h]))
  }
  return rgbToHex(rgb)
}

export function hexToLch(hex: string): LCH {
  return labToLch(rgbToOklab(hexToRgb(hex) ?? [0, 0, 0]))
}

// ── readability ────────────────────────────────────────

export function luminance(hex: string) {
  const [r, g, b] = (hexToRgb(hex) ?? [0, 0, 0]).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Text color that reads on top of `hex`. */
export const inkFor = (hex: string) => (contrast(hex, '#ffffff') >= contrast(hex, '#111111') ? '#ffffff' : '#111111')

// ── generation ─────────────────────────────────────────

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]
const wrap = (h: number) => ((h % 360) + 360) % 360

/**
 * Regenerate the unlocked colors of a palette. Locked colors anchor the hue
 * (and stay put); unlocked ones follow a harmony scheme across a light→dark
 * ramp, which is what makes Coolors palettes feel usable.
 */
export function generatePalette(current: PaletteColor[], count = current.length || 5): PaletteColor[] {
  const locked = current.filter((c) => c.locked)
  const anchor = locked.length ? hexToLch(locked[0].hex) : null
  const base = anchor && anchor[1] > 0.02 ? anchor[2] : rand(0, 360)
  const scheme = pick(['analogous', 'complementary', 'split', 'triadic', 'mono', 'analogous'])
  const hues: number[] = Array.from({ length: count }, (_, i) => {
    const t = count > 1 ? i / (count - 1) : 0
    switch (scheme) {
      case 'complementary':
        return wrap(base + (t > 0.5 ? 180 : 0) + rand(-12, 12))
      case 'split':
        return wrap(base + [0, 150, 210][i % 3] + rand(-8, 8))
      case 'triadic':
        return wrap(base + [0, 120, 240][i % 3] + rand(-8, 8))
      case 'mono':
        return wrap(base + rand(-6, 6))
      default:
        return wrap(base + (t - 0.5) * rand(50, 90))
    }
  })
  const darkFirst = Math.random() < 0.7
  const lo = rand(0.18, 0.3)
  const hi = rand(0.88, 0.96)
  const chromaPeak = scheme === 'mono' ? rand(0.04, 0.1) : rand(0.06, 0.16)

  const out: PaletteColor[] = []
  for (let i = 0; i < count; i++) {
    if (current[i]?.locked) {
      out.push(current[i])
      continue
    }
    const t = count > 1 ? i / (count - 1) : 0.5
    const L = darkFirst ? lo + (hi - lo) * t : hi - (hi - lo) * t
    // Chroma peaks in the middle of the ramp; near-black and near-white stay quiet.
    const C = chromaPeak * (0.35 + 0.65 * Math.sin(Math.PI * t)) * rand(0.8, 1.15)
    out.push({ hex: lchToHex([L, C, hues[i]]) })
  }
  return out
}

/** A color halfway between two (inserting between columns). */
export function mixHex(a: string, b: string, t = 0.5) {
  const x = rgbToOklab(hexToRgb(a) ?? [0, 0, 0])
  const y = rgbToOklab(hexToRgb(b) ?? [0, 0, 0])
  return rgbToHex(oklabToRgb([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as Lab))
}

/** Tints and shades of one color, light → dark. */
export function shadesOf(hex: string, n = 9) {
  const [, C, h] = hexToLch(hex)
  return Array.from({ length: n }, (_, i) => lchToHex([0.97 - (i / (n - 1)) * 0.82, C * (0.4 + 0.6 * Math.sin((Math.PI * (i + 1)) / (n + 1))), h]))
}

export interface Adjust {
  hue: number // degrees, −180..180
  saturation: number // −100..100 (%)
  brightness: number // −100..100
  temperature: number // −100 (cool) .. 100 (warm)
}

export const NO_ADJUST: Adjust = { hue: 0, saturation: 0, brightness: 0, temperature: 0 }

export function adjustHex(hex: string, a: Adjust) {
  let [L, C, h] = hexToLch(hex)
  h = wrap(h + a.hue)
  C = Math.max(0, C * (1 + a.saturation / 100))
  L = Math.min(1, Math.max(0, L + (a.brightness / 100) * 0.25))
  let lab = lchToLab([L, C, h])
  // Warm pushes toward orange (+a, +b), cool toward blue (−b).
  const t = a.temperature / 100
  lab = [lab[0], lab[1] + t * 0.02, lab[2] + t * 0.06]
  const [L2, C2, h2] = labToLch(lab)
  return lchToHex([L2, C2, h2])
}

// ── names ──────────────────────────────────────────────

const NAMES: [string, string][] = [
  ['Space Indigo', '#22223b'], ['Dusty Grape', '#4a4e69'], ['Lilac Ash', '#9a8c98'], ['Almond Silk', '#c9ada7'],
  ['Parchment', '#f2e9e4'], ['Ink Black', '#0d1b2a'], ['Prussian Blue', '#1b263b'], ['Dusk Blue', '#415a77'],
  ['Shadow Blue', '#778da9'], ['Platinum', '#e0e1dd'], ['Jet', '#2b2d42'], ['Cool Gray', '#8d99ae'],
  ['Anti-flash White', '#edf2f4'], ['Imperial Red', '#ef233c'], ['Fire Brick', '#d90429'], ['Midnight Green', '#003049'],
  ['Barn Red', '#780000'], ['Fire Engine', '#c1121f'], ['Papaya Whip', '#fdf0d5'], ['Air Superiority', '#669bbc'],
  ['Charcoal', '#264653'], ['Persian Green', '#2a9d8f'], ['Saffron', '#e9c46a'], ['Sandy Brown', '#f4a261'],
  ['Burnt Sienna', '#e76f51'], ['Rich Black', '#001219'], ['Dark Cyan', '#005f73'], ['Tiffany Blue', '#94d2bd'],
  ['Vanilla', '#e9d8a6'], ['Gamboge', '#ee9b00'], ['Alloy Orange', '#ca6702'], ['Rust', '#bb3e03'],
  ['Rufous', '#ae2012'], ['Auburn', '#9b2226'], ['Tea Green', '#ccd5ae'], ['Beige', '#e9edc9'],
  ['Cornsilk', '#fefae0'], ['Papaya Cream', '#faedcd'], ['Buff', '#d4a373'], ['Pistachio', '#a3b18a'],
  ['Fern', '#588157'], ['Hunter Green', '#3a5a40'], ['Brunswick Green', '#344e41'], ['Timberwolf', '#dad7cd'],
  ['Thistle', '#cdb4db'], ['Fairy Pink', '#ffc8dd'], ['Carnation', '#ffafcc'], ['Uranian Blue', '#bde0fe'],
  ['Light Sky', '#a2d2ff'], ['Mauve', '#e0aaff'], ['Amethyst', '#9d4edd'], ['Grape', '#7b2cbf'],
  ['Indigo Night', '#3c096c'], ['Russian Violet', '#240046'], ['Dark Purple', '#10002b'], ['Rose Taupe', '#9e6b6b'],
  ['Coral', '#ff7f50'], ['Salmon', '#fa8072'], ['Peach', '#ffcba4'], ['Apricot', '#fbceb1'],
  ['Butter', '#fff1a8'], ['Lemon', '#fff44f'], ['Mustard', '#e1ad01'], ['Olive', '#708238'],
  ['Moss', '#8a9a5b'], ['Sage', '#b2ac88'], ['Mint', '#98ff98'], ['Seafoam', '#9fe2bf'],
  ['Jade', '#00a86b'], ['Emerald', '#50c878'], ['Forest', '#228b22'], ['Pine', '#01796f'],
  ['Teal', '#008080'], ['Aqua', '#00b7c2'], ['Sky', '#87ceeb'], ['Cornflower', '#6495ed'],
  ['Azure', '#007fff'], ['Cobalt', '#0047ab'], ['Royal Blue', '#4169e1'], ['Navy', '#000080'],
  ['Periwinkle', '#ccccff'], ['Lavender', '#e6e6fa'], ['Iris', '#5a4fcf'], ['Violet', '#7f00ff'],
  ['Plum', '#8e4585'], ['Orchid', '#da70d6'], ['Magenta', '#ff00ff'], ['Fuchsia', '#c154c1'],
  ['Raspberry', '#e30b5c'], ['Crimson', '#dc143c'], ['Cherry', '#d2042d'], ['Wine', '#722f37'],
  ['Maroon', '#800000'], ['Oxblood', '#4a0000'], ['Terracotta', '#e2725b'], ['Clay', '#b66a50'],
  ['Copper', '#b87333'], ['Bronze', '#cd7f32'], ['Caramel', '#ffd59a'], ['Honey', '#eba937'],
  ['Amber', '#ffbf00'], ['Tangerine', '#f28500'], ['Pumpkin', '#ff7518'], ['Chocolate', '#7b3f00'],
  ['Coffee', '#6f4e37'], ['Mocha', '#967969'], ['Taupe', '#483c32'], ['Sand', '#c2b280'],
  ['Khaki', '#c3b091'], ['Ivory', '#fffff0'], ['Bone', '#e3dac9'], ['Linen', '#faf0e6'],
  ['Snow', '#fffafa'], ['Silver', '#c0c0c0'], ['Ash', '#b2beb5'], ['Slate', '#708090'],
  ['Graphite', '#383838'], ['Onyx', '#353839'], ['Obsidian', '#0b1215'], ['Smoke', '#738276'],
  ['Steel', '#4682b4'], ['Denim', '#1560bd'], ['Ocean', '#006994'], ['Lagoon', '#017987'],
  ['Blush', '#de5d83'], ['Rose', '#ff66cc'], ['Petal', '#f5c6d6'], ['Dusty Rose', '#dcae96'],
  ['Champagne', '#f7e7ce'], ['Pearl', '#eae0c8'], ['Cream', '#fffdd0'], ['Lime', '#bfff00'],
  ['Chartreuse', '#dfff00'], ['Spring Green', '#00ff7f'], ['Turquoise', '#40e0d0'], ['Cyan', '#00ffff'],
]
const NAME_LAB = NAMES.map(([n, h]) => [n, rgbToOklab(hexToRgb(h)!)] as const)

/** Nearest evocative name (perceptual distance in OKLab). */
export function nameColor(hex: string) {
  const lab = rgbToOklab(hexToRgb(hex) ?? [0, 0, 0])
  let best = NAMES[0][0]
  let d = Infinity
  for (const [n, l] of NAME_LAB) {
    const dist = (l[0] - lab[0]) ** 2 + (l[1] - lab[1]) ** 2 + (l[2] - lab[2]) ** 2
    if (dist < d) {
      d = dist
      best = n
    }
  }
  return best
}

/** Colors from a Coolors link: coolors.co/22223b-4a4e69-… or coolors.co/palette/… */
export function parseCoolors(url: string): PaletteColor[] | null {
  const m = /coolors\.co\/(?:palette\/)?([0-9a-f]{6}(?:-[0-9a-f]{6}){1,9})/i.exec(url)
  return m ? m[1].split('-').map((h) => ({ hex: `#${h.toLowerCase()}` })) : null
}
