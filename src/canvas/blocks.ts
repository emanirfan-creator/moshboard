import type { Frame } from '../../shared/types.ts'

/** Block layout in world px: header height and inner padding (keep in sync with theme.css). */
export const BLOCK_HEAD = 44
export const BLOCK_PAD = 8

const BLOCK_TYPES = new Set(['code', 'url', 'image', 'video', 'audio', 'palette'])
export const isBlock = (f: Frame) => BLOCK_TYPES.has(f.type)

/**
 * Overlaps stack in layers, so nothing gets stuck under something else: blocks at the back,
 * notes/text/swatches (see-through, written on top of things) above them, and within a layer
 * the board's order (⌘] / ⌘[ change it). The selected one rises within its layer; one being
 * interacted with goes over everything.
 */
export function stackLayer(f: Frame, selected: boolean, interact: boolean) {
  if (interact) return 5
  return (isBlock(f) ? 1 : 3) + (selected ? 1 : 0)
}
