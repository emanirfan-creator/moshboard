// Websites that refuse to be framed (X-Frame-Options / CSP frame-ancestors) get a
// full-page snapshot instead of a live iframe.
import fs from 'node:fs'
import path from 'node:path'
import { FONT_PROBE, type UsedFont } from '../shared/font-probe.ts'
import { launch } from './capture-url.ts'

export { checkEmbeddable } from './embeddable.ts'

const MAX_HEIGHT = 6000

export async function snapshotUrl(boardDir: string, id: string, url: string, width = 1280) {
  const browser = await launch()
  try {
    const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 })
    await page.goto(url, { waitUntil: 'load', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {})
    // Nudge lazy-loaded sections into view, then return to the top.
    await page.evaluate(async () => {
      for (let y = 0; y < Math.min(document.body.scrollHeight, 6000); y += 700) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 120))
      }
      window.scrollTo(0, 0)
    })
    // Hide (not accept) cookie/consent banners so they don't cover the reference.
    await page
      .addStyleTag({
        content: `[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i],
          #onetrust-banner-sdk, #CybotCookiebotDialog, .cc-window, [aria-label*="cookie" i] { display: none !important; }`,
      })
      .catch(() => {})
    await page.waitForTimeout(500)
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    // Unique name per capture so the browser never shows a cached old one.
    const rel = `assets/${id}.snapshot-${Date.now().toString(36)}.jpg`
    await page.screenshot({
      path: path.join(boardDir, rel),
      type: 'jpeg',
      quality: 82,
      fullPage: height <= MAX_HEIGHT,
      clip: height > MAX_HEIGHT ? { x: 0, y: 0, width, height: MAX_HEIGHT } : undefined,
    })
    // Drop older snapshots of this frame.
    for (const f of fs.readdirSync(path.join(boardDir, 'assets')))
      if (f.startsWith(`${id}.snapshot`) && `assets/${f}` !== rel) fs.rmSync(path.join(boardDir, 'assets', f))
    return { path: rel, width, height: Math.min(height, MAX_HEIGHT), takenAt: new Date().toISOString() }
  } finally {
    await browser.close()
  }
}

/** The fonts a website sets its text in (headless Chrome), most-used first. */
export async function siteFonts(url: string): Promise<UsedFont[]> {
  const browser = await launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url, { waitUntil: 'load', timeout: 20000 })
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    await page.evaluate(() => document.fonts.ready).catch(() => {})
    return await page.evaluate(FONT_PROBE)
  } finally {
    await browser.close()
  }
}
