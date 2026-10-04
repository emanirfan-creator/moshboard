import { useEffect, useState } from 'react'
import { weightFromStyle, weightOptions, type FontFamily } from '../shared/fonts.ts'
import { api } from './api'
import { FOLDER_ONLY } from './folder/folder'

type FontList = { mac: FontFamily[]; google: FontFamily[] }
let list: Promise<FontList> | undefined
const listeners = new Set<() => void>()

/** Fonts on this computer and on Google Fonts (fetched once per session). */
export function useFontList() {
  const [fonts, setFonts] = useState<FontList>()
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1)
    listeners.add(bump)
    return () => void listeners.delete(bump)
  }, [])
  useEffect(() => {
    list ??= load().catch((e) => ((list = undefined), Promise.reject(e)))
    let live = true
    list.then((f) => live && setFonts(f)).catch(() => live && setFonts({ mac: [], google: [] }))
    return () => void (live = false)
  }, [version])
  return fonts
}

// The website can't ask a server for the fonts installed on the visitor's computer; Chrome lists
// them itself (Local Font Access), after asking once.
type LocalFont = { family: string; style: string }
declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFont[]>
  }
}

/** Website: whether the installed fonts can be listed (then the picker offers it). */
export const canListLocalFonts = () => FOLDER_ONLY && typeof window.queryLocalFonts === 'function'

async function localFonts(): Promise<FontFamily[]> {
  const families = new Map<string, Set<number>>()
  for (const f of await window.queryLocalFonts!()) {
    if (f.family.startsWith('.')) continue
    const weights = families.get(f.family) ?? new Set()
    weights.add(weightFromStyle(f.style) ?? 400)
    families.set(f.family, weights)
  }
  return [...families]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, w]) => ({ family, source: 'mac' as const, weights: [...w].sort((a, b) => a - b) }))
}

async function load(): Promise<FontList> {
  const fonts = await api.fonts()
  if (!canListLocalFonts()) return fonts
  // Already allowed on an earlier visit: list them straight away, without asking.
  const state = await navigator.permissions.query({ name: 'local-fonts' as PermissionName }).then((p) => p.state, () => 'prompt')
  return state === 'granted' ? { ...fonts, mac: await localFonts().catch(() => []) } : fonts
}

/** Website: list the installed fonts. Must run from a click (Chrome asks the first time). */
export async function allowLocalFonts() {
  const mac = await localFonts()
  const google = (await list?.catch(() => null))?.google ?? []
  list = Promise.resolve({ mac, google })
  listeners.forEach((f) => f())
  return mac.length
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
