import { useEffect, useMemo, useRef, useState } from 'react'
import { SANDBOX_FONT, type UsedFont } from '../../shared/font-probe.ts'
import { annotation, cssVars, defaults, parseParams, runtimeValues, startupParams, type Param } from '../../shared/params.ts'
import type { Frame } from '../../shared/types.ts'
import { ensureFile } from '../actions'
import { api } from '../api'
import { frameById, getState, setState, updateFrame, useStore } from '../store'
import { BLOCK_HEAD, BLOCK_PAD } from '../canvas/blocks'
import { BlockError } from './BlockError'
import { BlockLoader } from './BlockLoader'
import { isJsSite, previewSources } from '../../shared/detect-motion.ts'
import { presetFor } from '../../shared/providers.ts'
import { componentProps } from '../../shared/props.ts'
import { runtimeTune, type RuntimeItem } from '../../shared/runtime-motion.ts'
import { useDetection } from '../tuning/detection'
import { buildSrcdoc } from './sandbox'

const EMPTY = {}

const cssCache = new Map<string, Promise<string | undefined>>()
function frameCss(sources: string[]) {
  const key = sources.join('\0')
  let p = cssCache.get(key)
  if (!p) {
    p = api.tailwind(sources).catch(() => undefined)
    cssCache.set(key, p)
    if (cssCache.size > 100) cssCache.delete(cssCache.keys().next().value!)
  }
  return p
}

function setError(id: string, message?: string) {
  setState((s) => {
    if (s.errors[id] === message) return {}
    const errors = { ...s.errors }
    if (message) errors[id] = message
    else delete errors[id]
    return { errors }
  })
}

export function CodeFrame({
  frame,
  interact,
  size,
  inView = true,
}: {
  frame: Frame
  interact: boolean
  size: { w: number; h: number }
  inView?: boolean
}) {
  const file = frame.file!
  const source = useStore((s) => s.files[file])
  const overrides = useStore((s) => s.overrides[frame.id] ?? EMPTY)
  const tick = useStore((s) => s.replay[frame.id] ?? 0)
  const error = useStore((s) => s.errors[frame.id])
  const modulesRaw = useStore((s) => (frame.modules ? s.files[frame.modules] : ''))
  const iframe = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (source === undefined) ensureFile(file)
  }, [file, source])
  useEffect(() => {
    if (frame.modules && modulesRaw === undefined) ensureFile(frame.modules)
  }, [frame.modules, modulesRaw])
  const modules = useMemo(() => {
    try {
      return modulesRaw ? (JSON.parse(modulesRaw) as Record<string, string>) : {}
    } catch {
      return {}
    }
  }, [modulesRaw])
  // Providers: the frame's own wrapper file, or a preset when it imports a library that needs one.
  const wrapperRaw = useStore((s) => (frame.wrapper ? s.files[frame.wrapper] : ''))
  useEffect(() => {
    if (frame.wrapper && wrapperRaw === undefined) ensureFile(frame.wrapper)
  }, [frame.wrapper, wrapperRaw])
  const wrapper = useMemo(
    () => (frame.wrapper ? wrapperRaw || undefined : source !== undefined ? presetFor([source, ...Object.values(modules)])?.code : undefined),
    [frame.wrapper, wrapperRaw, source, modules],
  )
  const waitingForModules = (!!frame.modules && modulesRaw === undefined) || (!!frame.wrapper && wrapperRaw === undefined)

  // Motion values detected in the code run from a copy where each literal reads its
  // tuned value (see shared/detect-motion.ts). The stored source is left as pasted.
  const detection = useDetection(frame)
  const preview = useMemo(
    () =>
      source !== undefined && detection.params.length
        ? previewSources(detection, { main: source, modules })
        : { main: source, modules },
    [detection, source, modules],
  )

  // Tailwind compiled once on the server (cached by content). `null` = still compiling;
  // `undefined` = server compile failed, so the frame falls back to in-browser Tailwind.
  const [twCss, setTwCss] = useState<string | null | undefined>(null)
  useEffect(() => {
    if (source === undefined || waitingForModules) return
    let live = true
    setTwCss(null)
    frameCss([preview.main ?? '', ...Object.values(preview.modules), wrapper ?? '']).then((css) => live && setTwCss(css))
    return () => {
      live = false
    }
  }, [source, preview, waitingForModules, wrapper])

  const params = useMemo(() => (source ? parseParams(source) : []), [source])
  const values = useMemo(() => ({ ...defaults(params), ...overrides }), [params, overrides])
  const latest = useRef(values)
  latest.current = values
  // Sent into the frame: every @param, and detected values only once tuned (until then the code's own literal applies).
  const sentParams = (ov: Record<string, unknown>) => [...params, ...detection.params.filter((p) => p.name in ov)]
  const sent = useMemo(() => sentParams(overrides), [params, detection, overrides])

  // The component's own props: saved on the frame, plus unsaved tweaks from the side panel.
  const props = useMemo(() => componentProps(frame.props, overrides), [frame.props, overrides])
  const latestProps = useRef(props)
  latestProps.current = props

  const kind = file.endsWith('.html') ? 'html' : 'tsx'
  // A hard reload only happens on source change, a retry, or replaying a broken frame.
  const [reload, setReload] = useState(0)
  const srcdoc = useMemo(
    () =>
      source && preview.main && !waitingForModules && twCss !== null
        ? buildSrcdoc(
            kind,
            preview.main,
            cssVars(sentParams(latest.current), latest.current),
            runtimeValues(sentParams(latest.current), latest.current),
            preview.modules,
            twCss ?? undefined,
            wrapper,
            latestProps.current,
          )
        : '',
    [source, kind, params, reload, preview, waitingForModules, twCss, wrapper],
  )

  // Loading state, with one automatic retry if esm.sh/Tailwind are slow to answer.
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  readyRef.current = ready
  const retried = useRef(false)
  useEffect(() => {
    setError(frame.id)
    setReady(false)
    if (!srcdoc) return
    const t = setTimeout(() => {
      // Loaded (or showing its own error) in time: nothing to retry.
      if (readyRef.current) return
      if (!retried.current) {
        retried.current = true
        setReload((n) => n + 1)
      } else if (!getState().errors[frame.id]) {
        setError(frame.id, 'Didn’t finish loading. Check your connection, then press R.')
      }
    }, 12000)
    return () => clearTimeout(t)
  }, [srcdoc, frame.id])

  // Replay (R, linked video loop, or the auto loop) restarts inside the frame without reloading it.
  const firstTick = useRef(tick)
  useEffect(() => {
    if (tick === firstTick.current) return
    if (!readyRef.current || getState().errors[frame.id]) setReload((n) => n + 1)
    else iframe.current?.contentWindow?.postMessage({ type: 'mb:replay' }, '*')
  }, [tick, frame.id])

  // Entrance animations loop on their own: play, rest, play again. Hover/click
  // components wait for the user, and copies linked to a video follow its loop.
  const loop = useStore((s) => s.loop)
  const linkedToVideo = useStore(() => !!frame.link && frameById(frame.link)?.type === 'video')
  const trigger = source ? annotation(source, 'trigger')?.toLowerCase() : undefined
  // Only loop things that are about entrance motion: explicitly marked, or carrying timing params
  // (a duration, an ease, a spring). Params that only set looks (a 3D globe's colors, an icon
  // size) don't count: remounting such a component every few seconds rebuilds it from scratch.
  const loops =
    loop &&
    ready &&
    inView &&
    !interact &&
    !linkedToVideo &&
    (trigger === 'mount' || trigger === 'loop' || (!trigger && params.some(isTiming)))
  useEffect(() => {
    if (!loops) return
    let t: ReturnType<typeof setTimeout>
    const cycle = () => {
      const v = latest.current as Record<string, unknown>
      const ms = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : 0)
      const active = Math.max(600, ms('delay') + (ms('duration') || 600) + 3 * ms('stagger'))
      t = setTimeout(() => {
        iframe.current?.contentWindow?.postMessage({ type: 'mb:replay' }, '*')
        cycle()
      }, active + 1200)
    }
    cycle()
    return () => clearTimeout(t)
  }, [loops])

  useEffect(() => {
    iframe.current?.contentWindow?.postMessage(
      { type: 'mb:params', css: cssVars(sent, values), values: runtimeValues(sent, values) },
      '*',
    )
  }, [sent, values])

  useEffect(() => {
    iframe.current?.contentWindow?.postMessage({ type: 'mb:props', props }, '*')
  }, [props])

  // Detected JS values often only take effect when the animation (re)starts, e.g. a GSAP
  // tween in an effect, so replay shortly after tuning. Values in module-level code
  // (variants objects) only run on load, so those reload the frame instead.
  const prevOverrides = useRef(overrides)
  useEffect(() => {
    const before = prevOverrides.current as Record<string, unknown>
    prevOverrides.current = overrides
    const now = overrides as Record<string, unknown>
    const changed = detection.params.filter((p) => before[p.name] !== now[p.name])
    if (!changed.length) return
    const reloadNeeded = changed.some((p) => !p.live && p.sites.some(isJsSite))
    const replayNeeded = changed.some((p) => p.sites.some(isJsSite))
    if (!reloadNeeded && !replayNeeded) return
    const t = setTimeout(() => {
      if (reloadNeeded) setReload((n) => n + 1)
      else iframe.current?.contentWindow?.postMessage({ type: 'mb:replay' }, '*')
    }, 350)
    return () => clearTimeout(t)
  }, [overrides, detection])

  // A param the code only reads when it starts (inside an effect, memo or state
  // initializer) doesn't change anything on re-render, so restart the frame once
  // tuning pauses. Everything else updates live without losing the frame's state.
  const startup = useMemo(() => (source ? startupParams(source, params.map((p) => p.name)) : new Set<string>()), [source, params])
  const prevValues = useRef(values)
  const restart = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    const before = prevValues.current as Record<string, unknown>
    prevValues.current = values
    const now = values as Record<string, unknown>
    if (![...startup].some((n) => before[n] !== now[n])) return
    clearTimeout(restart.current)
    restart.current = setTimeout(() => iframe.current?.contentWindow?.postMessage({ type: 'mb:replay' }, '*'), 250)
  }, [values, startup])
  useEffect(() => () => clearTimeout(restart.current), [])

  // A newly added component is sized to what it draws once it has settled (entrance motion done).
  useEffect(() => {
    if (!ready || !frame.fit) return
    if (frame.viewport) return void updateFrame(frame.id, { fit: undefined })
    const t = setTimeout(() => iframe.current?.contentWindow?.postMessage({ type: 'mb:fit' }, '*'), 900)
    return () => clearTimeout(t)
  }, [ready, frame.fit, frame.viewport, frame.id])

  // Measured motion (any library) gets tuned from outside the code: saved values plus unsaved tweaks.
  const tune = useMemo(() => runtimeTune(frame.runtime, overrides), [frame.runtime, overrides])
  useEffect(() => {
    if (ready) iframe.current?.contentWindow?.postMessage({ type: 'mb:runtime', tune }, '*')
  }, [tune, ready])

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== iframe.current?.contentWindow) return
      if (e.data?.type === 'mb:motion') {
        const items = e.data.items as RuntimeItem[]
        // Measured again on every replay; only a real change re-renders the inspector.
        setState((s) =>
          JSON.stringify(s.motion[frame.id]) === JSON.stringify(items) ? {} : { motion: { ...s.motion, [frame.id]: items } },
        )
      }
      if (e.data?.type === 'mb:error') {
        setError(frame.id, e.data.message)
        setReady(true)
      }
      if (e.data?.type === 'mb:ready') {
        setError(frame.id)
        setReady(true)
        retried.current = false
      }
      if (e.data?.type === 'mb:size') fitToContent(frame.id, e.data.w, e.data.h)
      if (e.data?.type === 'mb:fonts' && Array.isArray(e.data.fonts)) {
        // Kept on the frame (like a site's) for font suggestions; the inherited default isn't a choice.
        const fonts = (e.data.fonts as UsedFont[]).filter((u) => u.stack !== SANDBOX_FONT)
        const f = getState().board?.frames.find((x) => x.id === frame.id)
        if (fonts.length && f && JSON.stringify(f.usedFonts) !== JSON.stringify(fonts)) updateFrame(frame.id, { usedFonts: fonts })
      }
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [frame.id])

  const vp = frame.viewport
  const scale = vp ? size.w / vp : 1
  return (
    <>
      <BlockLoader loading={!ready} />
      {error && <BlockError frame={frame} message={error} />}
      <iframe
        key={reload}
        ref={iframe}
        className="content-iframe"
        title={frame.label ?? frame.id}
        sandbox="allow-scripts allow-forms allow-pointer-lock allow-popups allow-modals"
        srcDoc={srcdoc}
        style={{
          width: vp ?? size.w,
          height: size.h / scale,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          pointerEvents: interact ? 'auto' : 'none',
          visibility: ready && !error ? 'visible' : 'hidden',
        }}
      />
    </>
  )
}

/**
 * Size a new code frame to its measured content plus breathing room, keeping its
 * center in place. Nothing measurable (a full-bleed canvas or 3D scene) keeps the default.
 */
function fitToContent(id: string, w: number, h: number) {
  const f = getState().board?.frames.find((x) => x.id === id)
  if (!f?.fit) return
  if (!(w > 0 && h > 0)) return updateFrame(id, { fit: undefined })
  const fw = Math.round(Math.min(1200, Math.max(220, w + 64)) + BLOCK_PAD * 2)
  const fh = Math.round(Math.min(900, Math.max(140, h + 64)) + BLOCK_HEAD + BLOCK_PAD)
  updateFrame(id, { fit: undefined, w: fw, h: fh, x: Math.round(f.x + (f.w - fw) / 2), y: Math.round(f.y + (f.h - fh) / 2) })
}

/** A param that times motion: an ease or spring, or a number in ms/s (duration, delay, stagger…). */
const isTiming = (p: Param) => p.kind === 'ease' || p.kind === 'spring' || (p.kind === 'number' && /^m?s$/.test(p.unit))
