import { cue } from './ui/sound'

/** Copy text (with a copy cue), falling back to execCommand where the async clipboard API is blocked. */
export async function copyText(text: string): Promise<boolean> {
  const ok = await write(text)
  if (ok) cue('copy')
  return ok
}

async function write(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
    document.body.append(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}
