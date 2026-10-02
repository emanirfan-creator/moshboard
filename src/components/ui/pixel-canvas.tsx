import * as React from 'react'

// From 21st.dev "pixel-canvas", adapted for Roto:
// - `active` prop plays the animation without hover (used as a loading state)
// - sizes from layout (offsetWidth/Height), so it stays correct on a zoomed canvas
// - hover/focus listeners are real references, so they're actually removed
// - pixel grid in CSS px (the original mixed device px with a dpr-scaled context)

class Pixel {
  width: number
  height: number
  ctx: CanvasRenderingContext2D
  x: number
  y: number
  color: string
  speed: number
  size: number
  sizeStep: number
  minSize: number
  maxSizeInteger: number
  maxSize: number
  delay: number
  counter: number
  counterStep: number
  isIdle: boolean
  isReverse: boolean
  isShimmer: boolean

  constructor(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    speed: number,
    delay: number,
  ) {
    this.width = canvas.width
    this.height = canvas.height
    this.ctx = context
    this.x = x
    this.y = y
    this.color = color
    this.speed = this.getRandomValue(0.1, 0.9) * speed
    this.size = 0
    this.sizeStep = Math.random() * 0.4
    this.minSize = 0.5
    this.maxSizeInteger = 2
    this.maxSize = this.getRandomValue(this.minSize, this.maxSizeInteger)
    this.delay = delay
    this.counter = 0
    this.counterStep = Math.random() * 4 + (this.width + this.height) * 0.01
    this.isIdle = false
    this.isReverse = false
    this.isShimmer = false
  }

  getRandomValue(min: number, max: number) {
    return Math.random() * (max - min) + min
  }

  draw() {
    const centerOffset = this.maxSizeInteger * 0.5 - this.size * 0.5
    this.ctx.fillStyle = this.color
    this.ctx.fillRect(this.x + centerOffset, this.y + centerOffset, this.size, this.size)
  }

  appear() {
    this.isIdle = false
    if (this.counter <= this.delay) {
      this.counter += this.counterStep
      return
    }
    if (this.size >= this.maxSize) this.isShimmer = true
    if (this.isShimmer) this.shimmer()
    else this.size += this.sizeStep
    this.draw()
  }

  disappear() {
    this.isShimmer = false
    this.counter = 0
    if (this.size <= 0) {
      this.isIdle = true
      return
    }
    this.size -= 0.1
    this.draw()
  }

  shimmer() {
    if (this.size >= this.maxSize) this.isReverse = true
    else if (this.size <= this.minSize) this.isReverse = false
    this.size += this.isReverse ? -this.speed : this.speed
  }
}

function definePixelCanvas() {
  if (typeof window === 'undefined' || customElements.get('pixel-canvas')) return

  class PixelCanvasElement extends HTMLElement {
    static observedAttributes = ['data-active']

    private canvas: HTMLCanvasElement
    private ctx: CanvasRenderingContext2D | null
    private pixels: Pixel[] = []
    private animation: number | null = null
    private timeInterval = 1000 / 60
    private timePrevious = performance.now()
    private reducedMotion: boolean
    private initialized = false
    private resizeObserver: ResizeObserver | null = null
    private host: Element | null = null
    // Grid lives in CSS pixels; the context is scaled by devicePixelRatio.
    private cssW = 0
    private cssH = 0
    private onEnter = () => this.handleAnimation('appear')
    private onLeave = () => !this.active && this.handleAnimation('disappear')

    constructor() {
      super()
      this.canvas = document.createElement('canvas')
      this.ctx = this.canvas.getContext('2d')
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const shadow = this.attachShadow({ mode: 'open' })
      const style = document.createElement('style')
      style.textContent = `:host { display: grid; inline-size: 100%; block-size: 100%; overflow: hidden; }`
      shadow.append(style, this.canvas)
    }

    get colors() {
      return this.dataset.colors?.split(',') || ['#f8fafc', '#f1f5f9', '#cbd5e1']
    }
    get gap() {
      return Math.max(4, Math.min(50, Number(this.dataset.gap) || 5))
    }
    get speed() {
      const value = Number(this.dataset.speed) || 35
      return this.reducedMotion ? 0 : Math.max(0, Math.min(100, value)) * 0.001
    }
    get noFocus() {
      return this.hasAttribute('data-no-focus')
    }
    get variant() {
      return this.dataset.variant || 'default'
    }
    get active() {
      return this.hasAttribute('data-active')
    }

    connectedCallback() {
      if (this.initialized) return
      this.initialized = true
      this.host = this.parentElement
      requestAnimationFrame(() => {
        this.handleResize()
        if (this.active) this.handleAnimation('appear')
        this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => this.handleResize()))
        this.resizeObserver.observe(this)
      })
      this.host?.addEventListener('mouseenter', this.onEnter)
      this.host?.addEventListener('mouseleave', this.onLeave)
      if (!this.noFocus) {
        this.host?.addEventListener('focus', this.onEnter, { capture: true })
        this.host?.addEventListener('blur', this.onLeave, { capture: true })
      }
    }

    disconnectedCallback() {
      this.initialized = false
      this.resizeObserver?.disconnect()
      this.host?.removeEventListener('mouseenter', this.onEnter)
      this.host?.removeEventListener('mouseleave', this.onLeave)
      this.host?.removeEventListener('focus', this.onEnter, { capture: true })
      this.host?.removeEventListener('blur', this.onLeave, { capture: true })
      if (this.animation) cancelAnimationFrame(this.animation)
      this.animation = null
      this.host = null
    }

    attributeChangedCallback() {
      if (!this.initialized || !this.pixels.length) return
      this.handleAnimation(this.active ? 'appear' : 'disappear')
    }

    handleResize() {
      if (!this.ctx || !this.initialized) return
      // Layout size, not getBoundingClientRect: the canvas board is CSS-scaled.
      const width = this.offsetWidth
      const height = this.offsetHeight
      if (!width || !height) return
      const dpr = window.devicePixelRatio || 1
      this.canvas.width = width * dpr
      this.canvas.height = height * dpr
      this.canvas.style.width = `${width}px`
      this.canvas.style.height = `${height}px`
      this.ctx.setTransform(1, 0, 0, 1, 0, 0)
      this.ctx.scale(dpr, dpr)
      this.cssW = width
      this.cssH = height
      this.createPixels()
      if (this.active && !this.animation) this.handleAnimation('appear')
    }

    getDistanceToCenter(x: number, y: number) {
      const dx = x - this.cssW / 2
      const dy = y - this.cssH / 2
      return Math.sqrt(dx * dx + dy * dy)
    }

    getDistanceToBottomLeft(x: number, y: number) {
      const dy = this.cssH - y
      return Math.sqrt(x * x + dy * dy)
    }

    createPixels() {
      if (!this.ctx) return
      this.pixels = []
      for (let x = 0; x < this.cssW; x += this.gap) {
        for (let y = 0; y < this.cssH; y += this.gap) {
          const color = this.colors[Math.floor(Math.random() * this.colors.length)]
          const delay = this.reducedMotion
            ? 0
            : this.variant === 'icon'
              ? this.getDistanceToCenter(x, y)
              : this.getDistanceToBottomLeft(x, y)
          this.pixels.push(new Pixel(this.canvas, this.ctx, x, y, color, this.speed, delay))
        }
      }
    }

    handleAnimation(name: 'appear' | 'disappear') {
      if (this.animation) cancelAnimationFrame(this.animation)
      const animate = () => {
        this.animation = requestAnimationFrame(animate)
        const timeNow = performance.now()
        const timePassed = timeNow - this.timePrevious
        if (timePassed < this.timeInterval) return
        this.timePrevious = timeNow - (timePassed % this.timeInterval)
        if (!this.ctx) return
        this.ctx.clearRect(0, 0, this.cssW, this.cssH)
        let allIdle = true
        for (const pixel of this.pixels) {
          pixel[name]()
          if (!pixel.isIdle) allIdle = false
        }
        if (allIdle && this.animation) {
          cancelAnimationFrame(this.animation)
          this.animation = null
        }
      }
      animate()
    }
  }

  customElements.define('pixel-canvas', PixelCanvasElement)
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'pixel-canvas': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        'data-gap'?: number
        'data-speed'?: number
        'data-colors'?: string
        'data-variant'?: string
        'data-active'?: string
        'data-no-focus'?: string
      }
    }
  }
}

export interface PixelCanvasProps extends React.HTMLAttributes<HTMLElement> {
  gap?: number
  speed?: number
  colors?: string[]
  variant?: 'default' | 'icon'
  noFocus?: boolean
  /** Play without hover (e.g. as a loading state). Turning it off fades the pixels out. */
  active?: boolean
}

const PixelCanvas = React.forwardRef<HTMLElement, PixelCanvasProps>(
  ({ gap, speed, colors, variant, noFocus, active, style, ...props }, ref) => {
    definePixelCanvas()
    return (
      <pixel-canvas
        ref={ref}
        data-gap={gap}
        data-speed={speed}
        data-colors={colors?.join(',')}
        data-variant={variant}
        {...(active && { 'data-active': '' })}
        {...(noFocus && { 'data-no-focus': '' })}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', width: '100%', height: '100%', ...style }}
        {...props}
      />
    )
  },
)
PixelCanvas.displayName = 'PixelCanvas'

export { PixelCanvas }
