import fs from 'node:fs'
import path from 'node:path'
import { launch } from './capture-url.ts'

export interface PickTarget {
  selector: string
  label: string
  /** box in the screenshot's pixels */
  x: number
  y: number
  w: number
  h: number
  /** declares a transition or animation, so a trigger will likely show motion */
  moves: boolean
  /** the trigger it most likely responds to */
  trigger: 'hover' | 'click' | 'focus'
}

export interface PickResult {
  image: string
  width: number
  height: number
  targets: PickTarget[]
}

const W = 1280
const H = 800

/**
 * Open the site and list what's worth capturing on its first screen: links, buttons,
 * inputs and anything that declares a transition or animation, each with a unique
 * selector and its box on a screenshot. "Capture motion" shows the screenshot so a
 * designer clicks the element instead of typing a CSS selector.
 */
export async function pickTargets(boardDir: string, id: string, url: string): Promise<PickResult> {
  const browser = await launch()
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, reducedMotion: 'no-preference' })
    await page.goto(url, { waitUntil: 'load', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {})
    await page.waitForTimeout(600)

    const rel = `assets/${id}.pick.jpg`
    fs.mkdirSync(path.join(boardDir, 'assets'), { recursive: true })
    await page.screenshot({ path: path.join(boardDir, rel), type: 'jpeg', quality: 80 })

    const targets = await page.evaluate(
      ({ W, H }) => {
        const css = (s: string) => CSS.escape(s)
        /** The shortest selector that matches only this element: a unique id, else the shortest unique nth-of-type path. */
        const selectorOf = (el: Element): string => {
          const unique = (sel: string) => {
            try {
              const all = document.querySelectorAll(sel)
              return all.length === 1 && all[0] === el
            } catch {
              return false
            }
          }
          const parts: string[] = []
          for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
            if (n.id && document.querySelectorAll(`#${css(n.id)}`).length === 1) {
              parts.unshift(`#${css(n.id)}`)
              if (unique(parts.join(' > '))) break
              parts.shift()
            }
            let part = n.tagName.toLowerCase()
            const same = n.parentElement ? Array.from(n.parentElement.children).filter((c) => c.tagName === n!.tagName) : []
            if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`
            parts.unshift(part)
          }
          for (let k = 1; k <= parts.length; k++) {
            const sel = parts.slice(-k).join(' > ')
            if (unique(sel)) return sel
          }
          return `body > ${parts.join(' > ')}`
        }
        const moving = (cs: CSSStyleDeclaration) =>
          cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0) || (cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0)

        const out: {
          selector: string
          label: string
          x: number
          y: number
          w: number
          h: number
          moves: boolean
          trigger: 'hover' | 'click' | 'focus'
          area: number
        }[] = []
        const seen = new Set<Element>()
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          if (out.length > 400) break
          const r = el.getBoundingClientRect()
          if (r.width < 14 || r.height < 14 || r.bottom < 0 || r.right < 0 || r.top > H || r.left > W) continue
          if (r.width * r.height > W * H * 0.6) continue
          const cs = getComputedStyle(el)
          if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue
          const tag = el.tagName.toLowerCase()
          const interactive = /^(a|button|input|select|textarea|summary|label)$/.test(tag) || el.getAttribute('role') === 'button' || el.hasAttribute('tabindex')
          const moves = moving(cs)
          if (!interactive && !moves) continue
          // An element inside one we already have adds nothing unless it moves on its own.
          let inside = false
          for (let p = el.parentElement; p; p = p.parentElement) if (seen.has(p)) inside = true
          if (inside && !moves) continue
          seen.add(el)
          const text = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('alt') || el.getAttribute('placeholder') || '')
            .replace(/\s+/g, ' ')
            .trim()
          out.push({
            selector: selectorOf(el),
            label: text ? text.slice(0, 40) : tag,
            x: Math.max(0, r.left),
            y: Math.max(0, r.top),
            w: Math.min(r.width, W - Math.max(0, r.left)),
            h: Math.min(r.height, H - Math.max(0, r.top)),
            moves,
            trigger: /^(input|textarea|select)$/.test(tag) ? 'focus' : 'hover',
            area: r.width * r.height,
          })
        }
        // Moving things first; smaller boxes on top so nested ones stay clickable.
        return out
          .sort((a, b) => Number(b.moves) - Number(a.moves))
          .slice(0, 120)
          .sort((a, b) => b.area - a.area)
          .map(({ area: _area, ...t }) => t)
      },
      { W, H },
    )
    return { image: rel, width: W, height: H, targets }
  } finally {
    await browser.close()
  }
}
