import { useEffect, useState } from 'react'
import { weightOptions, type FontFamily } from '../shared/fonts.ts'
import { api } from './api'

let list: Promise<{ mac: FontFamily[]; google: FontFamily[] }> | undefined

/** Fonts on this Mac and on Google Fonts (fetched once per session). */
export function useFontList() {
  const [fonts, setFonts] = useState<{ mac: FontFamily[]; google: FontFamily[] }>()
  useEffect(() => {
    list ??= api.fonts().catch((e) => ((list = undefined), Promise.reject(e)))
    let live = true
    list.then((f) => live && setFonts(f)).catch(() => live && setFonts({ mac: [], google: [] }))
    return () => void (live = false)
  }, [])
  return fonts
}

/** The weights a frame's font comes in (all of them for the app font, or while the list loads). */
export function useWeights(f: { font?: string; fontHref?: string }) {
  const fonts = useFontList()
  if (!f.font) return weightOptions()
  const entry = (f.fontHref ? fonts?.google : fonts?.mac)?.find((x) => x.family === f.font)
  return weightOptions(entry)
}

const loaded = new Set<string>()

/** Add a Google Fonts stylesheet to the page once. */
export function loadFont(href: string | undefined) {
  if (!href || loaded.has(href)) return
  loaded.add(href)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

/**
 * Load just the glyphs of `text`, to preview a family in the picker without loading all of it.
 * Skipped once the whole family is loaded: a later subset would take over its glyphs.
 */
export function loadPreview(href: string, text: string) {
  if (!loaded.has(href)) loadFont(`${href}&text=${encodeURIComponent(text)}`)
}
