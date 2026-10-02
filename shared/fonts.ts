// Font families offered by the font picker: installed on this Mac, or from Google Fonts.

export interface FontFamily {
  family: string
  source: 'mac' | 'google'
  /** Google: Sans Serif, Serif, Display, Handwriting, Monospace */
  category?: string
  /** Google: the stylesheet that loads the family */
  href?: string
  /** Weights it comes in: a range for variable fonts, else the static weights */
  weights?: number[] | { min: number; max: number }
}

/** The weights to offer for a family (every standard weight when it's unknown). */
export function weightOptions(f?: Pick<FontFamily, 'weights'>): number[] {
  const all = [100, 200, 300, 400, 500, 600, 700, 800, 900]
  const w = f?.weights
  if (!w) return all
  if (Array.isArray(w)) return w.length ? [...new Set(w)].sort((a, b) => a - b) : [400]
  return all.filter((x) => x >= w.min && x <= w.max)
}

/** CSS weight for a font style name like "Demi Bold Italic" (null if the name doesn't say). */
export function weightFromStyle(style: string): number | null {
  const s = style.toLowerCase().replace(/[\s_-]/g, '')
  const table: [RegExp, number][] = [
    [/hairline|thin/, 100],
    [/(ultra|extra)light/, 200],
    [/light/, 300],
    [/medium/, 500],
    [/(semi|demi)bold/, 600],
    [/(ultra|extra)bold|heavy/, 800],
    [/black/, 900],
    [/bold/, 700],
    [/regular|book|roman|plain|normal|italic|oblique/, 400],
  ]
  return table.find(([re]) => re.test(s))?.[1] ?? null
}

/**
 * Google Fonts stylesheet for a family: the full weight range when it's variable, else its
 * static weights (none means the family only comes in italic).
 */
export function googleHref(family: string, weights: { min: number; max: number } | number[]) {
  const spec = !Array.isArray(weights)
    ? `:wght@${weights.min}..${weights.max}`
    : !weights.length
      ? ':ital@1'
      : weights.length > 1 || weights[0] !== 400
        ? `:wght@${weights.join(';')}`
        : ''
  return `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}${spec}&display=swap`
}

export const DEFAULT_FONT: FontFamily = {
  family: 'Inter',
  source: 'google',
  category: 'Sans Serif',
  href: googleHref('Inter', { min: 100, max: 900 }),
}

/** The family a frame's font fields describe (none for text in the app font). */
export const fontOf = (f: { font?: string; fontHref?: string; fontCategory?: string }): FontFamily | undefined =>
  f.font ? { family: f.font, source: f.fontHref ? 'google' : 'mac', href: f.fontHref, category: f.fontCategory } : undefined


/**
 * How a font block presents its family: the name set in itself, a short "Aa Gg 123"
 * specimen under the name, or the full set of letters and figures.
 */
export type FontLayout = 'name' | 'specimen' | 'glyphs'
export const FONT_LAYOUTS: { id: FontLayout; label: string }[] = [
  { id: 'name', label: 'Name' },
  { id: 'specimen', label: 'Specimen' },
  { id: 'glyphs', label: 'Glyphs' },
]
export const SPECIMEN = 'Aa Gg 123'
export const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 &?!@'

/** The board's fonts: the families set in its font blocks, in board order. */
export function boardFonts(frames: { type: string; font?: string; fontHref?: string; fontCategory?: string }[]): FontFamily[] {
  const out: FontFamily[] = []
  for (const f of frames) {
    const font = f.type === 'swatch' && fontOf(f)
    if (font && !out.some((x) => x.family === font.family && x.source === font.source)) out.push(font)
  }
  return out
}

/** A font block's default size, and the block size that fits a layout at a size (the block can grow past it). */
export const SWATCH_SIZE = 44
export function swatchBox(size: number, name: string, layout: FontLayout = 'name') {
  const line = size * 1.3
  if (layout === 'glyphs') {
    // About 14 characters a line; the block grows to fit however it wraps.
    const w = Math.max(320, Math.round(size * 0.62 * 14 + 48))
    return { w, h: Math.round(line * Math.ceil(GLYPHS.length / 14) + 92) }
  }
  const text = layout === 'specimen' ? SPECIMEN : name
  return { w: Math.max(200, Math.round(size * 0.58 * text.length + 48)), h: Math.round(line + (layout === 'specimen' ? 92 : 66)) }
}

export const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
}

/** "SemiBold Italic", "Regular", … */
export const styleName = (weight = 400, italic = false) =>
  `${WEIGHT_NAMES[weight] ?? weight}${italic ? (weight === 400 ? '' : ' ') + 'Italic' : ''}`.replace(/^RegularItalic$/, 'Italic')

/** The frame fields for a font swatch showing this family. */
export const swatchFont = (f: FontFamily) => ({ font: f.family, fontHref: f.href, fontCategory: f.category })

/** CSS font-family value with a fallback that matches the family's kind. */
export function fontStack(family: string, category?: string) {
  const fallback =
    category === 'Serif' ? 'serif' : category === 'Monospace' ? 'monospace' : category === 'Handwriting' ? 'cursive' : 'sans-serif'
  return `"${family}", ${fallback}`
}
