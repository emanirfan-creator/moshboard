// Saved animations: an animation tuned on one canvas, saved under a name ("bounce out") so any
// canvas in the boards folder can use it, and Claude can find it in any project. Kept at the top
// of the boards folder as `motions.json` (the app's) and `motions.md` (for people and AI tools).
import type { Bezier, Spring } from './params.ts'
import { easeWords, feelWord, motionBrief, springWords } from './motion-words.ts'

export interface SavedMotion {
  id: string
  name: string
  /** ms */
  duration?: number
  delay?: number
  ease?: Bezier
  spring?: Spring
  /** where it was saved from: canvas and block */
  from?: { board: string; boardName?: string; frame?: string; block?: string }
  /** ISO time */
  saved: string
}

export interface MotionLibrary {
  motions: SavedMotion[]
}

export const MOTIONS_JSON = 'motions.json'
export const MOTIONS_MD = 'motions.md'

/** "bounce out" → `bounceOut`, the name its code goes by. */
export function codeName(name: string) {
  const words = name.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
  const n = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') || 'motion'
  return /^\d/.test(n) ? `m${n}` : n
}

/** "bounce out" → `bounce-out`, for CSS variables. */
const cssName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'motion'

const sec = (ms: number) => +(ms / 1000).toFixed(3)
const bezier = (b: Bezier) => `cubic-bezier(${b.join(', ')})`

/** "240ms · ease-out · snappy", for a list. */
export function motionMeta(m: SavedMotion) {
  const how = m.spring ? springWords(m.spring).replace(/ \(.*\)$/, '') : [m.duration !== undefined ? `${Math.round(m.duration)}ms` : '', m.ease ? easeWords(m.ease).split(',')[0] : ''].filter(Boolean).join(' · ')
  const feel = feelWord(m)
  return [how, feel].filter(Boolean).join(' · ')
}

export type CodeKind = 'motion' | 'css' | 'gsap'

/** Ready code for one saved animation. */
export function motionCode(m: SavedMotion, kind: CodeKind): string {
  const name = codeName(m.name)
  if (kind === 'motion') {
    const fields = m.spring
      ? [`type: 'spring'`, `stiffness: ${m.spring.stiffness}`, `damping: ${m.spring.damping}`, ...(m.spring.mass !== undefined ? [`mass: ${m.spring.mass}`] : [])]
      : [...(m.duration !== undefined ? [`duration: ${sec(m.duration)}`] : []), ...(m.ease ? [`ease: [${m.ease.join(', ')}]`] : [])]
    if (m.delay) fields.push(`delay: ${sec(m.delay)}`)
    return `// ${m.name}, from Moshboard. import { motion } from 'motion/react'\nexport const ${name} = { ${fields.join(', ')} } as const\n// <motion.div animate={{ x: 0 }} transition={${name}} />`
  }
  if (kind === 'css') {
    if (m.spring && m.duration === undefined)
      return `/* ${m.name}: a spring (stiffness ${m.spring.stiffness}, damping ${m.spring.damping}). CSS has no springs; use the Motion version. */`
    const v = cssName(m.name)
    const timing = `var(--${v}-duration) var(--${v}-ease)${m.delay ? ` ${Math.round(m.delay)}ms` : ''}`
    return `/* ${m.name}, from Moshboard */\n:root {\n  --${v}-duration: ${Math.round(m.duration ?? 0)}ms;\n  --${v}-ease: ${m.ease ? bezier(m.ease) : 'ease'};\n}\n.element { transition: transform ${timing}, opacity ${timing}; }`
  }
  if (m.spring && m.duration === undefined)
    return `// ${m.name}: a spring (stiffness ${m.spring.stiffness}, damping ${m.spring.damping}). GSAP has no springs; use the Motion version, or ease: 'elastic.out(1, 0.5)'.`
  const fields = [`duration: ${sec(m.duration ?? 0)}`]
  if (m.delay) fields.push(`delay: ${sec(m.delay)}`)
  if (m.ease) fields.push(`ease: CustomEase.create('${name}', 'M0,0 C${m.ease[0]},${m.ease[1]} ${m.ease[2]},${m.ease[3]} 1,1')`)
  return `// ${m.name}, from Moshboard. import { CustomEase } from 'gsap/CustomEase'; gsap.registerPlugin(CustomEase)\nexport const ${name} = { ${fields.join(', ')} }\n// gsap.to('.element', { x: 240, ...${name} })`
}

/** motions.md: what each saved animation is, in plain words, with its code. Read by people and AI tools. */
export function motionsMarkdown(list: SavedMotion[]): string {
  const lines = [
    '# Saved animations',
    '',
    'Animations saved in Moshboard, tuned against real references. When someone asks for one by name, use these exact values: pick the version that matches what the project already animates with (Motion, CSS or GSAP). Written by Moshboard; edit them in the app.',
    '',
  ]
  if (!list.length) return [...lines, '_None saved yet._', ''].join('\n')
  for (const m of list) lines.push(`- **${m.name}**: ${motionBrief(m)}.`)
  for (const m of list) {
    lines.push('', `## ${m.name}`, '')
    if (m.from?.boardName || m.from?.block) lines.push(`From ${[m.from.boardName ?? m.from.board, m.from.block].filter(Boolean).join(' · ')}.`, '')
    for (const [kind, lang, title] of [
      ['motion', 'ts', 'Motion'],
      ['css', 'css', 'CSS'],
      ['gsap', 'ts', 'GSAP'],
    ] as const) {
      lines.push(`${title}:`, '', '```' + lang, motionCode(m, kind), '```', '')
    }
    lines.pop()
  }
  return lines.join('\n') + '\n'
}

/** A name not taken yet: "box open", "box open 2". */
export function freeName(list: SavedMotion[], wanted: string) {
  const base = wanted.trim() || 'animation'
  const taken = new Set(list.map((m) => m.name.toLowerCase()))
  let n = base
  for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${base} ${i}`
  return n
}
