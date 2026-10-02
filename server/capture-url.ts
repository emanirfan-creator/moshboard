import fs from 'node:fs'
import path from 'node:path'
import type { MotionCapture } from '../shared/types.ts'

const PROPS = [
  'transform', 'translate', 'scale', 'rotate', 'opacity', 'filter', 'clip-path',
  'background-color', 'color', 'border-color', 'box-shadow', 'width', 'height', 'top', 'left',
]

interface CaptureInput {
  url: string
  selector?: string
  trigger?: string
}

export async function launch() {
  const { chromium } = await import('playwright')
  // Prefer the installed Google Chrome so no browser download is needed.
  try {
    return await chromium.launch({ channel: 'chrome', headless: true })
  } catch {
    return await chromium.launch({ headless: true })
  }
}

const toMs = (s: string) => (s.endsWith('ms') ? parseFloat(s) : parseFloat(s) * 1000)

/**
 * Open a page, fire a trigger on an element and read back the real timing:
 * declared transitions, running Web Animations (CSS animations/transitions
 * and WAAPI) and which computed styles changed.
 */
export async function captureUrl(boardDir: string, id: string, input: CaptureInput) {
  const selector = input.selector?.trim() || 'body'
  const trigger = (input.trigger ?? 'hover').toLowerCase()
  const recDir = path.join(boardDir, 'assets', `.rec-${id}`)
  const browser = await launch()
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir: recDir, size: { width: 1280, height: 800 } },
      reducedMotion: 'no-preference',
    })
    const page = await context.newPage()
    await page.goto(input.url, { waitUntil: 'load', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {})
    const el = page.locator(selector).first()
    await el.waitFor({ state: 'attached', timeout: 8000 })
    await el.scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(400)

    const snapshot = () =>
      el.evaluate((root, props) => {
        const nodes = [root, ...Array.from(root.querySelectorAll('*')).slice(0, 30)]
        const out: Record<string, string> = {}
        nodes.forEach((n, i) => {
          const cs = getComputedStyle(n)
          for (const p of props) out[`${i === 0 ? 'root' : `child${i}`} ${p}`] = cs.getPropertyValue(p)
        })
        return out
      }, PROPS)

    const declared = await el.evaluate((n) => {
      const cs = getComputedStyle(n)
      return {
        property: cs.transitionProperty,
        duration: cs.transitionDuration,
        timing: cs.transitionTimingFunction,
        delay: cs.transitionDelay,
      }
    })

    const before = await snapshot()
    await page.evaluate(() => {
      const w = window as unknown as { __mbSeen: Map<Animation, true> }
      w.__mbSeen = new Map(document.getAnimations().map((a) => [a, true]))
    })

    if (trigger === 'hover') await el.hover()
    else if (trigger === 'click') await el.click()
    else if (trigger === 'focus') await el.focus()
    else if (trigger === 'scroll') await page.mouse.wheel(0, 700)
    else if (trigger === 'load') await page.reload({ waitUntil: 'commit' })

    // Sample a few times: short transitions finish before long ones start.
    const animations = new Map<string, MotionCapture['animations'][number]>()
    for (const wait of [16, 80, 200, 450]) {
      await page.waitForTimeout(wait)
      const found = await page.evaluate(() => {
        const w = window as unknown as { __mbSeen?: Map<Animation, true> }
        const describe = (t: Element | null) =>
          t ? `${t.tagName.toLowerCase()}${t.id ? `#${t.id}` : ''}${t.classList.length ? `.${[...t.classList].slice(0, 2).join('.')}` : ''}` : '?'
        return document
          .getAnimations()
          .filter((a) => !w.__mbSeen?.has(a))
          .map((a) => {
            const effect = a.effect as KeyframeEffect | null
            const timing = effect?.getComputedTiming()
            const kind =
              'transitionProperty' in a
                ? `transition ${(a as CSSTransition).transitionProperty}`
                : 'animationName' in a
                  ? `animation ${(a as CSSAnimation).animationName}`
                  : `waapi ${a.id || ''}`.trim()
            return {
              name: `${kind} on ${describe(effect?.target ?? null)}`,
              duration: Number(timing?.duration ?? 0),
              delay: Number(timing?.delay ?? 0),
              easing: String(effect?.getTiming().easing ?? 'linear'),
              iterations: timing?.iterations === Infinity ? 'infinite' : Number(timing?.iterations ?? 1),
              fill: String(timing?.fill ?? 'none'),
              keyframes: (effect?.getKeyframes() ?? []).map((k) => {
                const { composite: _c, computedOffset: _o, ...rest } = k as Record<string, unknown>
                return rest
              }),
            }
          })
      })
      for (const a of found) if (!animations.has(a.name)) animations.set(a.name, a)
    }
    await page.waitForTimeout(900)
    const after = await snapshot()

    const changed: MotionCapture['changed'] = {}
    for (const k of Object.keys(after)) if (before[k] !== after[k]) changed[k] = { before: before[k], after: after[k] }

    // Expand the declared shorthand lists into one entry per property.
    const split = (s: string) => s.split(/,(?![^(]*\))/).map((x) => x.trim())
    const props = split(declared.property)
    const durs = split(declared.duration)
    const tfs = split(declared.timing)
    const dels = split(declared.delay)
    const transitions = props
      .map((property, i) => ({
        property,
        duration: durs[i % durs.length],
        timingFunction: tfs[i % tfs.length],
        delay: dels[i % dels.length],
      }))
      .filter((t) => toMs(t.duration) > 0)

    await context.close()
    const video = await page.video()?.path()
    let recording: string | undefined
    if (video && fs.existsSync(video)) {
      recording = `assets/${id}.capture.webm`
      fs.renameSync(video, path.join(boardDir, recording))
    }
    fs.rmSync(recDir, { recursive: true, force: true })

    const capture: MotionCapture = {
      url: input.url,
      selector,
      trigger,
      capturedAt: new Date().toISOString(),
      transitions,
      animations: [...animations.values()],
      changed,
      recording,
    }
    const rel = `assets/${id}.capture.json`
    fs.writeFileSync(path.join(boardDir, rel), JSON.stringify(capture, null, 2) + '\n')
    return { capture, path: rel, scaffold: scaffold(capture) }
  } finally {
    await browser.close()
  }
}

/** A starting HTML frame that replays the captured timing with tunable params. */
function scaffold(c: MotionCapture): string {
  const t = c.transitions[0]
  const a = c.animations[0]
  const duration = Math.round(t ? toMs(t.duration) : (a?.duration ?? 300))
  const delay = Math.round(t ? toMs(t.delay) : (a?.delay ?? 0))
  const rawEase = t?.timingFunction ?? a?.easing ?? 'ease'
  const named: Record<string, string> = {
    ease: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
    linear: 'cubic-bezier(0, 0, 1, 1)',
    'ease-in': 'cubic-bezier(0.42, 0, 1, 1)',
    'ease-out': 'cubic-bezier(0, 0, 0.58, 1)',
    'ease-in-out': 'cubic-bezier(0.42, 0, 0.58, 1)',
  }
  const ease = named[rawEase] ?? (rawEase.startsWith('cubic-bezier') ? rawEase : 'cubic-bezier(0.25, 0.1, 0.25, 1)')
  const rootChanges = Object.entries(c.changed)
    .filter(([k]) => k.startsWith('root '))
    .map(([k, v]) => `    ${k.slice(5)}: ${v.after};`)
  const pseudo = c.trigger === 'hover' ? ':hover' : c.trigger === 'focus' ? ':focus' : '.on'
  const props = c.transitions.map((x) => x.property).join(', ') || 'all'

  return `<!-- Captured from ${c.url} (${c.trigger} on ${c.selector}) at ${c.capturedAt} -->
<!-- @param duration ${duration}ms 0..${Math.max(1200, duration * 2)} -->
<!-- @param delay ${delay}ms 0..1000 -->
<!-- @param ease ${ease} -->
<!-- @trigger ${c.trigger} -->
<!-- @animates ${props} -->
<button class="target" ${c.trigger === 'click' ? `onclick="this.classList.toggle('on')"` : ''}>${c.trigger}</button>
<style>
  .target {
    padding: 14px 22px; border: 1px solid rgba(255,255,255,.12); border-radius: 10px;
    background: #111214; color: #f7f8f8; font: 500 14px Inter, system-ui; cursor: pointer;
    transition-property: ${props};
    transition-duration: var(--p-duration);
    transition-timing-function: var(--p-ease);
    transition-delay: var(--p-delay);
  }
  .target${pseudo} {
${rootChanges.join('\n') || '    /* no computed style changes were captured on the element itself */'}
  }
</style>
`
}
