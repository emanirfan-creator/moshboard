import type { Frame } from '../../shared/types.ts'

/** Block layout in world px: header height and inner padding (keep in sync with theme.css). */
export const BLOCK_HEAD = 44
export const BLOCK_PAD = 8

const BLOCK_TYPES = new Set(['code', 'url', 'image', 'video', 'palette'])
export const isBlock = (f: Frame) => BLOCK_TYPES.has(f.type)
