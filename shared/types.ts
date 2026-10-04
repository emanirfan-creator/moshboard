export type FrameType = 'image' | 'video' | 'url' | 'code' | 'swatch' | 'note' | 'text' | 'palette' | 'section'

export interface Segment {
  in: number // seconds
  out: number
}

export interface Frame {
  id: string
  type: FrameType
  x: number
  y: number
  w: number
  h: number
  /** section: its title */
  label?: string
  /** section: the approved direction (one per board); "approved only" exports use it alone */
  chosen?: boolean
  /** image/video: path relative to the board dir (assets/…); url: the href */
  src?: string
  /** code: path relative to the board dir (frames/<id>.tsx | .html) */
  file?: string
  /** code: extra modules it imports, as JSON { "@/components/ui/x": source } (from a registry install) */
  modules?: string
  /** note: markdown; text: plain text; section: what its blocks have in common (one line) */
  text?: string
  /** text: font size in px; font swatch: sample size */
  size?: number
  /** palette: ordered colors (locked ones survive regeneration) */
  colors?: { hex: string; locked?: boolean }[]
  /** swatch */
  color?: string
  /** font swatch: the family shown; text: a family picked for it (else the app font) */
  font?: string
  /** font swatch, text: Google Fonts stylesheet for `font` (unset for fonts installed on this Mac) */
  fontHref?: string
  /** font swatch, text: Google Fonts category, for the fallback (Serif, Monospace…) */
  fontCategory?: string
  /** font swatch: weight shown (100–900, default 400); text: its weight (else it follows the size) */
  weight?: number
  /** font swatch, text: shown in italic */
  italic?: boolean
  /** url, code: the fonts it sets its text in (read once for a site, on each render for a component; for font suggestions) */
  usedFonts?: { stack: string; weight: number; score: number }[]
  /** font swatch: how it presents the family (default 'name') */
  fontLayout?: 'name' | 'specimen' | 'glyphs'
  /** image/video: the page it came from (e.g. a Cosmos element) */
  origin?: string
  /** id of the frame this one copies (code replica) or annotates (note) */
  link?: string
  /** video: the part of the clip that contains the motion */
  segment?: Segment
  /** video: analysis json; url: capture json (relative to board dir) */
  analysis?: string
  /** url: whether the site allows being framed (checked once); blocked sites show `snapshot` */
  embed?: 'live' | 'blocked'
  /** url: full-page screenshot used when the site blocks embedding */
  snapshot?: string
  /** the frame's own size before a section's layout sized it (it gets it back when it leaves) */
  natural?: { w: number; h: number }
  /** section: lays out the blocks in it as a grid, columns or rows (see src/layout.ts) */
  layout?: SectionLayout
  /** image/video in a layout: what part shows in its box (pan -0.5..0.5 across the overflow, zoom ≥ 1) */
  crop?: { x: number; y: number; s: number }
  /** code: not sized yet; set when added, cleared once it's sized to what it renders */
  fit?: boolean
  /** code/url: logical render width; content is scaled to fit the frame */
  viewport?: number
  /** code: wrapper the component renders inside (frames/<id>.wrapper.tsx): providers, themes, context */
  wrapper?: string
  /** code: tuned values for motion measured in the running frame, keyed by what was measured (see shared/runtime-motion.ts) */
  runtime?: Record<string, RuntimeTune>
  /** code: a copy whose tuned values have been saved (⌘S) at least once */
  tuned?: boolean
  /** code: names given to its controls in the side panel, by param name (double-click a control's name) */
  labels?: Record<string, string>
  /** code: values set on the component's own props in the side panel (see shared/props.ts) */
  props?: Record<string, unknown>
}

/**
 * A grid is a tree of splits: a split lays its parts side by side (row) or stacked (col),
 * each with a weight; leaves are slots into the layout's `order`. Each line between two parts
 * belongs to one split, so moving it only resizes the blocks on either side.
 */
export type LayoutNode = { slot: number } | { dir: 'row' | 'col'; kids: { n: LayoutNode; w: number }[] }

export interface SectionLayout {
  mode: 'grid' | 'columns' | 'rows'
  /** block ids, slot by slot (slot 0 is the big one in a grid shape) */
  order: string[]
  gap: number
  /** grid: the shape picked from the list; unset once reshaped by hand */
  shape?: number
  /** grid: the splits; unset means "build `shape` for the current count" */
  tree?: LayoutNode
  /** columns: how many */
  columns?: number
  /** columns: blocks spanning more than one column */
  span?: Record<string, number>
  /** rows: the height rows are packed at */
  rowHeight?: number
  /** rows: heights set by hand, by row */
  rowH?: (number | null)[]
}

/** A measured transition/animation, tuned on the canvas. It comes from a library or stylesheet, not a literal in the code. */
export interface RuntimeTune {
  label: string
  duration?: number
  delay?: number
  ease?: [number, number, number, number]
}

export interface Board {
  name: string
  frames: Frame[]
}

export interface Burst {
  startMs: number
  endMs: number
  durationMs: number
}

export interface VideoAnalysis {
  source: string
  fps: number
  segment: Segment
  bursts: Burst[]
  primary: (Burst & {
    ease: { bezier: [number, number, number, number]; rmse: number; nearest: string }
  }) | null
  energy: number[]
  contactSheet: string
}

export interface MotionCapture {
  url: string
  selector: string
  trigger: string
  capturedAt: string
  transitions: { property: string; duration: string; timingFunction: string; delay: string }[]
  animations: {
    name: string
    duration: number
    delay: number
    easing: string
    iterations: number | string
    fill: string
    keyframes: Record<string, unknown>[]
  }[]
  changed: Record<string, { before: string; after: string }>
  recording?: string
}
