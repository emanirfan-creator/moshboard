export type FrameType = 'image' | 'video' | 'url' | 'code' | 'swatch' | 'note' | 'text' | 'palette'

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
  label?: string
  /** image/video: path relative to the board dir (assets/…); url: the href */
  src?: string
  /** code: path relative to the board dir (frames/<id>.tsx | .html) */
  file?: string
  /** code: extra modules it imports, as JSON { "@/components/ui/x": source } (from a registry install) */
  modules?: string
  /** note: markdown; text: plain text */
  text?: string
  /** text: font size in px */
  size?: number
  /** palette: ordered colors (locked ones survive regeneration) */
  colors?: { hex: string; locked?: boolean }[]
  /** swatch */
  color?: string
  font?: string
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
  /** the frame's own size before any tidy-up layout resized it (layouts work from this) */
  natural?: { w: number; h: number }
  /** code/url: logical render width; content is scaled to fit the frame */
  viewport?: number
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
