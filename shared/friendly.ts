// What the motion detector calls things (shared/detect-motion.ts, runtime-motion.ts) is code
// language: "Transition classes", "Globe3DDemoThird · <button>". The side panel (and motion.md's
// "In words") show them in words anyone reads; the detector's own names stay in the token tables.

const TAGS: Record<string, string> = {
  a: 'link',
  button: 'button',
  img: 'image',
  picture: 'image',
  video: 'video',
  svg: 'icon',
  path: 'icon',
  input: 'field',
  textarea: 'field',
  select: 'menu',
  label: 'label',
  p: 'text',
  span: 'text',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  li: 'list item',
  ul: 'list',
  ol: 'list',
  nav: 'menu',
  header: 'header',
  footer: 'footer',
  section: 'section',
  main: 'page',
  aside: 'panel',
  dialog: 'dialog',
  form: 'form',
  div: 'box',
  canvas: 'canvas',
}

/** "Globe3DDemoThird" → "Globe 3D demo third"; "hover-card" → "Hover card". */
export function words(name: string) {
  const w = name
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    // Keep acronyms like 3D, UI, CTA; lower everything else.
    .map((x, i) => (/^[A-Z0-9]{2,}$/.test(x) ? x : /^\d+[a-z]$/i.test(x) ? x.toUpperCase() : i ? x.toLowerCase() : x[0].toUpperCase() + x.slice(1).toLowerCase()))
    .join(' ')
  return w
}

/** One piece of where it is: a component name, an element, a selector or a call. */
function part(p: string) {
  const t = p.trim()
  const tag = /^<(\w+)[^>]*>$/.exec(t)
  if (tag) return TAGS[tag[1].toLowerCase()] ?? words(tag[1])
  if (/\(\)$/.test(t)) return '' // a function call says nothing to a designer
  if (/^[\w.-]+\.(html?|tsx?|jsx?|css|vue|svelte)$/i.test(t)) return '' // nor does a file name
  if (/^[.#]/.test(t)) return words(t.replace(/^[.#]/, '').split(/[:\s.#[>]/)[0]) // ".card:hover" → "Card"
  if (/^[“"].*[”"]$/.test(t)) return t
  return words(t)
}

/** "Globe3DDemoThird · <button>" → "Globe 3D demo third · Button". */
export function friendlyPlace(context: string) {
  const parts = context
    .split('·')
    .map(part)
    .filter(Boolean)
  return parts.map((p, i) => (i ? p[0].toUpperCase() + p.slice(1) : p)).join(' · ')
}

/** "Transition classes" → "Transition", "Hover transition classes" → "On hover", "GSAP tween" → "Animation". */
export function friendlyTitle(title: string) {
  const t = title.replace(/\s+classes$/i, '').trim()
  const state = /^(hover|focus|active|group hover|group-hover|focus visible|focus-visible|disabled|checked|open)\s+(transition|spring)$/i.exec(t)
  if (state) return `On ${state[1].replace(/-/g, ' ').toLowerCase()}`
  if (/^gsap tween$|^web animation$/i.test(t)) return 'Animation'
  if (/^gsap timeline defaults$/i.test(t)) return 'Timeline'
  const named = /^“(.+)” animation$/.exec(t)
  if (named) return `${words(named[1])} animation`
  const variant = /^“(.+)” variant$/.exec(t)
  if (variant) return `${words(variant[1])} state`
  const call = /^(\w+)\(\) (transition|spring)$/.exec(t)
  if (call) return call[2][0].toUpperCase() + call[2].slice(1)
  return t
}

const GENERIC = /^(transition|animation|spring|motion|timeline)$/i

/**
 * A detected animation's name in the panel: what it animates when the code says ("Title fades
 * in"), else its kind with the element it's on ("Button transition"); and where it lives,
 * without repeating what the name already says.
 */
export function friendlyGroup(g: { title: string; what?: string; context: string }) {
  const place = friendlyPlace(g.context).split(' · ')
  if (g.what) return { name: g.what, place: place[0] ?? '' }
  const t = friendlyTitle(g.title)
  const element = place.length > 1 ? place[place.length - 1] : ''
  if (GENERIC.test(t) && element) return { name: `${element} ${t.toLowerCase()}`, place: place.slice(0, -1).join(' · ') }
  return { name: t, place: place.join(' · ') }
}
