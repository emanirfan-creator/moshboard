import type { FrameLink } from './frame-links.ts'

export type FrameType = 'image' | 'video' | 'audio' | 'url' | 'code' | 'swatch' | 'note' | 'text' | 'palette' | 'section'

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
  /** image/video/audio: path relative to the board dir (assets/…); url: the href; audio from Spotify: its open.spotify.com link */
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
  colors?: { hex: string; locked?: boolean; share?: number }[]
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
  /** image/video/audio: the page it came from (e.g. a Cosmos element, the site a tab recording was made on) */
  origin?: string
  /** audio: what the sound measures as (read in the page from the file) */
  sound?: SoundReading
  /** audio: sounds split from one tab recording, shown as pads (`src` is unset) */
  clips?: Clip[]
  /** audio: a Spotify link, played in Spotify's own player (nothing of it is saved but the link and title) */
  music?: { provider: 'spotify'; title?: string }
  /** the links this block follows: a reference it copies or annotates, and the link's number (shared/frame-links.ts) */
  links?: FrameLink[]
  /** older boards and tools: the one reference this block follows; read into `links` on load */
  link?: string
  /** video: the part of the clip that contains the motion */
  segment?: Segment
  /** video: the area to analyze (0–1 of the frame), picked by drawing a box */
  region?: Region
  /** video: what it reads as, set by hand over the analysis's guess */
  motionKind?: MotionKind
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
  /** comments left on the board for yourself (src/comments/) */
  comments?: BoardComment[]
}

/**
 * A pin with a thread. On a block, `x`/`y` are where on it (0–1 across its width and height,
 * so the pin stays put when the block moves or a layout resizes it); on the canvas they're
 * world coordinates. Comments on a deleted block stay in the file and show again on undo.
 */
export interface BoardComment {
  id: string
  /** shown on its pin; comments count 1, 2, 3… and are renumbered when one is deleted */
  n: number
  /** the block it's on */
  on?: string
  x: number
  y: number
  /** the border its key sits off, when picked by dragging (else the nearest one with room) */
  side?: 'l' | 'r' | 't' | 'b'
  messages: CommentMessage[]
  resolved?: boolean
}

export interface CommentMessage {
  id: string
  text: string
  /** ISO time it was written */
  at: string
  edited?: boolean
}

/** A short sound, measured: how long, how it starts and fades, how high, how loud. */
export interface SoundReading {
  /** seconds, from the first audible sample to where it falls silent */
  length: number
  /** seconds to reach its peak */
  attack: number
  /** seconds from the peak down to silence */
  fade: number
  /** Hz of its strongest tone, when it has one */
  pitch?: number
  /** peak level, dBFS */
  peak: number
  /** where its energy sits, Hz (spectral centroid): low is warm/dull, high is bright/crisp */
  bright: number
  /** 0–1: how much of it is tone rather than noise */
  tonal: number
  /** loudness envelope, 0–1, for drawing */
  peaks: number[]
}

export interface Clip {
  src: string
  name: string
  sound?: SoundReading
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
  /** what kind of video it reads as, and what was measured for that kind (older analyses lack it) */
  read?: MotionReading
  /** the part of the frame that was analyzed (0–1), when an area was picked */
  region?: Region
}

/** Interface: a UI recording. Graphic: a brand post, carousel, animated type. Footage: film, live action. */
export type MotionKind = 'interface' | 'graphic' | 'footage'

export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export interface Ease {
  bezier: [number, number, number, number]
  rmse: number
  nearest: string
}

/** One burst of motion, read: how it moved, how long, on what curve. */
export interface Move extends Burst {
  /** slide: the content shifts; fade: brightness crossfades; move: something small moves; change: anything else */
  type: 'slide' | 'fade' | 'move' | 'change'
  dir?: '←' | '→' | '↑' | '↓'
  /** how far a slide went, as a share of the frame's width (or height) */
  distance?: number
  /** how much of the frame changed (0–1) */
  area: number
  ease: Ease
  /** it overshot and settled: a spring fits better than a curve */
  spring?: { stiffness: number; damping: number }
}

export interface MotionReading {
  kind: MotionKind
  sure: 'sure' | 'likely' | 'unsure'
  /** one line on why */
  why: string
  /** 0–1 each: still frames between moves, motion kept to one area, hard cuts, photographic look */
  signals: { stills: number; local: number; cuts: number; photo: number }
  moves: Move[]
  /** when each hard cut happens (ms) */
  cuts: number[]
  /** repeated moves: how many, how long each holds, how long each move takes (± spread), start to start */
  rhythm?: { beats: number; holdMs: number; moveMs: number; spreadMs: number; everyMs: number }
  /** footage: shots, average shot length, camera moves, overall feel */
  pacing?: { shots: number; shotMs: number; camera: { kind: string; startMs: number; endMs: number }[]; feel: 'calm' | 'steady' | 'energetic' }
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
