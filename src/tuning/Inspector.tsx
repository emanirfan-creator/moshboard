import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE, type ReactNode } from 'react'
import { defaults, humanize, paramUse, parseParams, roundFor, shareParts, type Bezier, type Param, type Spring } from '../../shared/params.ts'
import type { Frame, MotionKind, Move, VideoAnalysis } from '../../shared/types.ts'
import {
  analyzeSelected,
  copyRecreate,
  detectMotionValues,
  ensureFile,
  lockParams,
  makeTunable,
  markSegment,
  readAnalysis,
  referenceTiming,
  renameParam,
  replay,
  resetParam,
  resetParams,
  setParam,
} from '../actions'
import { clamp, drag } from '../drag'
import { videos } from '../frames/registry'
import {
  frameById,
  getState,
  INSPECTOR_W,
  inspectorOpen,
  sameFrameExcept,
  setCamera,
  setState,
  updateFrame,
  useStore,
  viewLeft,
} from '../store'
import { CaretIcon, ChevronIcon, CloseIcon } from '../ui/icons'
import { FontPicker } from '../ui/FontPicker'
import {
  FONT_LAYOUTS,
  fontOf,
  fontStack,
  SWATCH_SIZE,
  boardFonts,
  swatchFont,
  WEIGHT_NAMES,
  weightOptions,
} from '../../shared/fonts.ts'
import { useWeights } from '../fonts'
import { PaletteBody } from './PaletteInspector'
import { Fold } from './Fold'
import { friendlyGroup, words } from './friendly'
import { SelectionBody } from './SelectionInspector'
import { SectionBody, TileBody } from './ArrangeInspector'
import { LinksBody } from './LinksInspector'
import { isTile } from '../arrange'

const MODE_KIND = { grid: 'Grid', columns: 'Columns', rows: 'Rows' } as const
import { BezierCtl, ColorCtl, NameLabel, NumberCtl, SpringCtl, SplitCtl, TextCtl, Timeline } from './controls'
import { ColorPicker } from '../ui/ColorPicker'
import { nameColor } from '../../shared/color.ts'
import { useDetection } from './detection'
import { PropsSections, useComponentProps } from './PropsInspector'
import { runtimeGroups } from '../../shared/runtime-motion.ts'
import { Segmented } from '../ui/Segmented'
import { feelOf, mainMove } from '../../shared/read-motion.ts'
import { scanChirp } from '../ui/sound'
import type { DetectedGroup } from '../../shared/detect-motion.ts'

const EMPTY = {}
/** Frames whose detected controls have already scanned in this session. */
const scanned = new Set<string>()
const GEOMETRY = ['x', 'y', 'w', 'h', 'natural'] as const
const INNER_W = INSPECTOR_W - 32

/**
 * Docked right-hand panel for the selected frame's controls, so they never
 * cover other things on the canvas. Slides in/out; keeps showing the last
 * frame's content while it slides out.
 */
export function Inspector() {
  // Moving or resizing the frame doesn't change its controls: keep the previous object so
  // the panel doesn't re-render on every pointer move of a drag.
  const kept = useRef<Frame | undefined>(undefined)
  const frame = useStore((s) => {
    const f = s.selected.length === 1 ? frameById(s.selected[0]) : undefined
    if (f && kept.current && sameFrameExcept(kept.current, f, GEOMETRY)) return kept.current
    return (kept.current = f)
  })
  const open = useStore(inspectorOpen)
  const multi = useStore((s) => s.selected.length > 1)
  const last = useRef<{ frame?: Frame; multi: boolean }>({ multi: false })
  if (open) last.current = { frame, multi }
  // The closed panel keeps its contents only while it slides out (240ms), so a closed panel
  // isn't still rendering (a video's playhead, a layout's sizes) on every change.
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (open) return setClosing(false)
    setClosing(true)
    const t = setTimeout(() => setClosing(false), 260)
    return () => clearTimeout(t)
  }, [open])
  const shown = open ? { frame, multi } : closing ? last.current : { multi: false }

  // If the panel would cover the selected frame, glide the canvas left so it stays in view.
  useEffect(() => {
    if (!open || !frame) return
    const { camera } = getState()
    const right = (frame.x + frame.w) * camera.z + camera.x
    const limit = window.innerWidth - INSPECTOR_W - 32
    const left = frame.x * camera.z + camera.x
    const shift = Math.min(right - limit, left - (viewLeft() + 32))
    if (shift <= 0) return
    const from = camera.x
    const start = performance.now()
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 240)
      const e = 1 - (1 - k) ** 3
      setCamera({ ...getState().camera, x: from - shift * e })
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [open, frame?.id])

  return (
    <aside className="inspector" data-open={open || undefined} aria-hidden={!open} inert={!open}>
      {shown.multi ? <SelectionBody /> : shown.frame && <Body key={shown.frame.id} frame={shown.frame} />}
    </aside>
  )
}

const KIND: Record<string, string> = {
  code: 'Component',
  video: 'Video',
  text: 'Text',
  palette: 'Palette',
  swatch: 'Font',
  image: 'Image',
  url: 'Website',
  note: 'Note',
  section: 'Section',
}

function Body({ frame }: { frame: Frame }) {
  const modified = useStore((s) => !!s.overrides[frame.id])
  const tile = useStore(() => isTile(frame.id))
  const kind = frame.type === 'swatch' && !frame.font ? 'Color' : frame.layout ? MODE_KIND[frame.layout.mode] : KIND[frame.type]
  return (
    <>
      <header className="insp-head">
        <span className="block-dot" data-state={modified ? 'modified' : undefined} />
        <span className="insp-title">{frame.label || kind}</span>
        <span className="insp-kind">{kind}</span>
        <button className="icon-btn" onClick={() => setState({ selected: [] })} title="Close  Esc" aria-label="Close">
          <CloseIcon />
        </button>
      </header>
      {frame.type === 'section' && <SectionBody frame={frame} />}
      {tile && <TileBody frame={frame} />}
      <LinksBody frame={frame} />
      {frame.type === 'code' && <CodeBody frame={frame} />}
      {frame.type === 'video' && <VideoBody frame={frame} />}
      {frame.type === 'text' && <TextBody frame={frame} />}
      {frame.type === 'palette' && <PaletteBody frame={frame} />}
      {frame.type === 'swatch' && frame.font && <FontBody frame={frame} />}
      {frame.type === 'swatch' && !frame.font && <ColorBody frame={frame} />}
    </>
  )
}

function Section({
  title,
  note,
  where,
  index,
  reveal,
  children,
}: {
  title: ReactNode
  /** opens the section when it changes to something (e.g. a fresh analysis) */
  reveal?: unknown
  note?: string
  /** file:line, right of the title */
  where?: string
  index?: number
  children: ReactNode
}) {
  return (
    <Fold
      // The file and line are for whoever opens the code: a tooltip, not a label.
      title={where ? <span title={where}>{title}</span> : title}
      // A detected animation by its place in the code: several can share a title.
      id={where ?? (typeof title === 'string' ? title : undefined)}
      reveal={reveal}
      scan={index !== undefined}
      style={index !== undefined ? ({ '--i': index } as React.CSSProperties) : undefined}
      sub={
        note && (
          <span className="insp-src" title={note}>
            {note}
          </span>
        )
      }
    >
      {children}
    </Fold>
  )
}

/** One detected animation: its timing on a timeline, then easing / spring / other values. */
function DetectedSection({
  group,
  name,
  place,
  index,
  values,
  mod,
  set,
  reset,
  rename,
  labels,
  reference,
}: {
  name: string
  place: string
  group: DetectedGroup
  index: number
  values: Record<string, unknown>
  mod: (name: string) => boolean
  set: (name: string, v: unknown) => void
  reset: (name: string) => void
  rename: (name: string, label: string) => void
  labels?: Record<string, string>
  reference?: { duration?: number; ease?: Bezier }
}) {
  const by = (label: string) => group.params.find((p) => p.label === label && isMs(p))
  const duration = by('duration')
  const delay = duration && by('delay')
  const stagger = duration && by('stagger')
  const onTimeline = new Set([duration, delay, stagger].filter(Boolean))
  const rest = group.params.filter((p) => !onTimeline.has(p))
  return (
    <Section title={name} note={place || undefined} where={group.line ? `${group.file}:${group.line}` : group.file} index={index}>
      {duration && (
        <Timeline
          width={INNER_W}
          duration={duration}
          delay={delay}
          stagger={stagger}
          values={values as Record<string, number>}
          modified={mod}
          onChange={set}
          onReset={reset}
          reference={reference?.duration ? { duration: reference.duration } : undefined}
        />
      )}
      {rest.map((p) =>
        p.kind === 'ease' ? (
          <BezierCtl key={p.name} p={p} width={INNER_W} value={values[p.name] as Bezier} modified={mod(p.name)} onChange={(v) => set(p.name, v)} onReset={() => reset(p.name)} reference={reference?.ease} />
        ) : p.kind === 'spring' ? (
          <SpringCtl key={p.name} p={p} value={values[p.name] as Spring} modified={mod(p.name)} onChange={(v) => set(p.name, v)} onReset={() => reset(p.name)} />
        ) : (
          <NumberCtl
            key={p.name}
            p={labels?.[p.name] ? { ...p, label: labels[p.name] } : p}
            value={values[p.name] as number}
            modified={mod(p.name)}
            onChange={(v) => set(p.name, v)}
            onReset={() => reset(p.name)}
            onRename={(l) => rename(p.name, l)}
          />
        ),
      )}
    </Section>
  )
}

const isMs = (p?: Param) => p?.kind === 'number' && p.unit === 'ms'

function CodeBody({ frame }: { frame: Frame }) {
  const source = useStore((s) => (frame.file ? s.files[frame.file] : undefined))
  const overrides = useStore((s) => s.overrides[frame.id] ?? EMPTY) as Record<string, unknown>
  const params = useMemo(() => (source ? parseParams(source) : []), [source])
  const detection = useDetection(frame)
  // The frame may never have been on screen (⌘A, a link), so its files might not be loaded yet.
  useEffect(() => {
    for (const f of [frame.file, frame.modules, frame.wrapper]) if (f) ensureFile(f)
  }, [frame.file, frame.modules, frame.wrapper])
  const props = useComponentProps(frame)
  // The first time a component's controls show up, they "scan in": a rising chirp and a staggered reveal.
  useEffect(() => {
    if (!detection.groups.length || scanned.has(frame.id)) return
    scanned.add(frame.id)
    scanChirp(detection.groups.length)
  }, [frame.id, detection.groups.length])
  // Motion measured in the running frame that the code scan didn't find (theme values, CSS from a library).
  const measured = useStore((s) => s.motion[frame.id])
  const running = useMemo(() => {
    const known = new Set<number>()
    for (const p of [...params, ...detection.params]) {
      if (p.kind !== 'number' || p.unit !== 'ms') continue
      known.add(Math.round(p.value as number))
      if (typeof overrides[p.name] === 'number') known.add(Math.round(overrides[p.name] as number))
    }
    return runtimeGroups(measured, known, frame.runtime)
  }, [measured, params, detection, overrides, frame.runtime])
  const values = {
    ...defaults(params),
    ...defaults(detection.params),
    ...defaults(running.flatMap((g) => g.params)),
    ...overrides,
  } as Record<string, unknown>
  const mod = (name: string) => name in overrides
  const change = (name: string) => (v: unknown) => setParam(frame.id, name, v as never)
  const reset = (name: string) => resetParam(frame.id, name)
  const rename = (name: string, label: string) => renameParam(frame.id, name, label)
  // Timing measured on the reference this copy is linked to, so the controls show what to aim for.
  const refKey = useStore((s) => (frame.links?.length && s.files ? JSON.stringify(referenceTiming(frame)) : 'null'))
  const reference = useMemo(() => JSON.parse(refKey) as ReturnType<typeof referenceTiming>, [refKey]) ?? undefined
  // Where the code uses each param ("<Pause size={…}>"): a readable name, and a section per element.
  const uses = useMemo(
    () => Object.fromEntries(params.map((p) => [p.name, source ? paramUse(source, p.name) : {}])),
    [params, source],
  )
  const named = (p: Param): Param => {
    const use = uses[p.name]
    return { ...p, label: frame.labels?.[p.name] ?? (use?.element && use.prop ? humanize(use.prop) : p.label) }
  }
  const title = (p: Param, fallback: string, many: boolean) => (
    <NameLabel
      className="insp-h3-name"
      text={frame.labels?.[p.name] ?? (many ? humanize(p.name) : fallback)}
      onRename={(l) => rename(p.name, l)}
    />
  )

  const find = (re: RegExp) => params.find((p) => re.test(p.name) && isMs(p))
  const duration = find(/^(duration|dur)$/i)
  const delay = duration && find(/^delay$/i)
  const stagger = duration && find(/^stagger$/i)
  const onTimeline = new Set([duration, delay, stagger].filter(Boolean))
  const rest = params.filter((p) => !onTimeline.has(p))
  const eases = rest.filter((p) => p.kind === 'ease')
  const springs = rest.filter((p) => p.kind === 'spring')
  const numbers = rest.filter((p) => p.kind === 'number')
  const colors = rest.filter((p) => p.kind === 'color')
  const numberGroups = new Map<string, Param[]>()
  for (const p of numbers) {
    const el = uses[p.name]?.element ?? ''
    numberGroups.set(el, [...(numberGroups.get(el) ?? []), p])
  }
  const dirty = Object.keys(overrides).length > 0

  return (
    <>
      <div className="insp-scroll">
        {props.length > 0 && <PropsSections frame={frame} props={props} />}
        {params.length === 0 && detection.params.length === 0 && running.length === 0 && props.length === 0 && (
          <Section title="No controls yet">
            <p className="ctl-help">
              No timing values in this code.
            </p>
            <div className="insp-buttons">
              <button className="btn btn-primary" onClick={() => detectMotionValues(frame.id)}>
                Detect motion values
              </button>
              {frame.file?.endsWith('.tsx') && (
                <button className="btn" onClick={() => makeTunable(frame.id)}>
                  Add controls to code
                </button>
              )}
            </div>
            <p className="ctl-help">
              Or run <b>Copy /recreate</b> (⌘K) in Claude Code, or annotate:{' '}
              <span className="mono">{'/* @param duration 320ms 80..1200 */'}</span>
            </p>
          </Section>
        )}
        {duration && (
          <Section title="Timing">
            <Timeline
              width={INNER_W}
              duration={duration}
              delay={delay}
              stagger={stagger}
              values={values as Record<string, number>}
              modified={mod}
              onChange={(name, n) => setParam(frame.id, name, n)}
              onReset={reset}
              reference={reference?.duration ? { duration: reference.duration } : undefined}
            />
          </Section>
        )}
        {eases.map((p) => (
          <Section key={p.name} title={title(p, 'Easing', eases.length > 1)}>
            <BezierCtl
              p={p}
              width={INNER_W}
              value={values[p.name] as Bezier}
              modified={mod(p.name)}
              onChange={change(p.name)}
              onReset={() => reset(p.name)}
              reference={reference?.ease}
            />
          </Section>
        ))}
        {springs.map((p) => (
          <Section key={p.name} title={title(p, 'Spring', springs.length > 1)}>
            <SpringCtl p={p} value={values[p.name] as Spring} modified={mod(p.name)} onChange={change(p.name)} onReset={() => reset(p.name)} />
          </Section>
        ))}
        {[...numberGroups].map(([element, list]) => (
          <Section key={element || 'values'} title={element ? words(element) : 'Values'}>
            <div className="insp-stack">
              {list.map((p) => {
                const parts = shareParts(p)
                if (parts) return <ShareCtl key={p.name} p={named(p)} parts={parts} value={values[p.name] as number} modified={mod(p.name)} onChange={change(p.name)} onReset={() => reset(p.name)} onRename={(l) => rename(p.name, l)} />
                return (
                <NumberCtl
                  key={p.name}
                  p={named(p)}
                  value={values[p.name] as number}
                  modified={mod(p.name)}
                  onChange={change(p.name)}
                  onReset={() => reset(p.name)}
                  onRename={(l) => rename(p.name, l)}
                />
                )
              })}
            </div>
          </Section>
        ))}
        {colors.length > 0 && (
          <Section title="Colors">
            <div className="insp-stack">
              {colors.map((p) => (
                <ColorCtl
                  key={p.name}
                  p={named(p)}
                  value={values[p.name] as string}
                  onChange={change(p.name)}
                  modified={mod(p.name)}
                  onReset={() => reset(p.name)}
                />
              ))}
            </div>
          </Section>
        )}
        {nameGroups([...detection.groups, ...running]).map(({ g, name, place }, i) => (
          <DetectedSection
            key={g.id}
            group={g}
            name={name}
            place={place}
            index={i}
            values={values}
            mod={mod}
            set={(n, v) => setParam(frame.id, n, v as never)}
            reset={reset}
            rename={rename}
            labels={frame.labels}
            // The reference's timing goes on the first animation when the code has no @param timing of its own.
            reference={i === 0 && !duration ? reference : undefined}
          />
        ))}
      </div>
      <footer className="insp-foot">
        {dirty ? (
          <>
            <span className="unsaved">Unsaved changes</span>
            <span className="grow" />
            <button className="btn" onClick={() => resetParams()}>
              Discard
            </button>
            <button className="btn btn-primary" onClick={() => lockParams()}>
              Save <kbd>⌘S</kbd>
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => replay()}>
              Replay <kbd>R</kbd>
            </button>
            {detection.groups.length > 0 && (
              <button
                className="btn btn-ghost"
                onClick={() => detectMotionValues(frame.id)}
                title="Scan for motion values again"
              >
                Rescan
              </button>
            )}
            <span className="grow" />
            <span className="insp-file" title={frame.file}>
              {frame.file?.split('/').pop()}
            </span>
          </>
        )}
      </footer>
    </>
  )
}

const t2 = (n: number) => `${n.toFixed(2)}s`

function VideoBody({ frame }: { frame: Frame }) {
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const raw = useStore((s) => (frame.analysis ? s.files[frame.analysis] : undefined))
  // Analyzing (and a result coming back) opens Measured.
  const measuring = useStore((s) => s.jobs[frame.id] ?? null)
  const analysis = useMemo(() => (raw ? readAnalysis(frame) : null), [raw, frame])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const v = videos.get(frame.id)
      if (v) {
        setTime(v.currentTime)
        if (v.duration && Number.isFinite(v.duration)) setDuration(v.duration)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [frame.id])

  const W = INNER_W
  const x = (t: number) => (duration ? (t / duration) * W : 0)
  const seg = frame.segment

  const seek = (e: RPE<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const v = videos.get(frame.id)
    if (!v || !duration) return
    const at = (cx: number) => (v.currentTime = clamp((cx - rect.left) / rect.width, 0, 1) * duration)
    v.pause()
    at(e.clientX)
    drag(
      e,
      (_dx, _dy, ev) => at(ev.clientX),
      () => v.play().catch(() => {}),
      0,
      'tune',
    )
  }
  const moveEdge = (edge: 'in' | 'out') => (e: RPE) => {
    e.stopPropagation()
    if (!seg || !duration) return
    const s0 = seg
    drag(
      e,
      (dx) => {
        const t = Math.round(clamp(s0[edge] + (dx / W) * duration, 0, duration) * 100) / 100
        const next =
          edge === 'in'
            ? { in: Math.min(t, s0.out - 0.05), out: s0.out }
            : { in: s0.in, out: Math.max(t, s0.in + 0.05) }
        updateFrame(frame.id, { segment: next })
        const v = videos.get(frame.id)
        if (v) v.currentTime = next[edge]
      },
      undefined,
      0,
      'tune',
    )
  }

  return (
    <>
      <div className="insp-scroll">
        <Section title="Motion" reveal={measuring ?? raw}>
          <Measured frame={frame} analysis={analysis} />
        </Section>
        <Section title="Segment">
          <div className="ctl">
            <div className="ctl-head">
              <span className="ctl-val">{t2(time)}</span>
              <span className="ctl-name">{t2(duration)}</span>
            </div>
            <div className="timeline" onPointerDown={seek} style={{ cursor: 'pointer', width: W }}>
              {(analysis?.read?.moves ?? analysis?.bursts)?.map((b, i) => (
                <div
                  key={i}
                  className="tl-burst"
                  style={{ left: x(b.startMs / 1000), width: x(b.durationMs / 1000) }}
                  title={`motion ${b.startMs}–${b.endMs}ms`}
                />
              ))}
              {analysis?.read?.cuts.map((ms) => (
                <div key={ms} className="tl-cut" style={{ left: x(ms / 1000) }} title={`cut at ${t2(ms / 1000)}`} />
              ))}
              {seg && (
                <>
                  <div
                    className="tl-bar"
                    style={{ left: x(seg.in), width: x(seg.out) - x(seg.in), pointerEvents: 'none' }}
                  />
                  <div className="tl-handle" style={{ left: x(seg.in) }} onPointerDown={moveEdge('in')} />
                  <div className="tl-handle" style={{ left: x(seg.out) }} onPointerDown={moveEdge('out')} />
                </>
              )}
              <div className="tl-playhead" style={{ left: x(time) }} />
            </div>
            <span className="ctl-help">
              {seg
                ? `${t2(seg.in)} → ${t2(seg.out)} · ${Math.round((seg.out - seg.in) * 1000)}ms. Drag the ends.`
                : 'Scrub to the start, press I. To the end, press O.'}
            </span>
          </div>
          <div className="insp-buttons">
            <button className="btn" onClick={() => markSegment('in')}>
              Mark start <kbd>I</kbd>
            </button>
            <button className="btn" onClick={() => markSegment('out')}>
              Mark end <kbd>O</kbd>
            </button>
          </div>
        </Section>
      </div>
      <footer className="insp-foot">
        {/* The next step sits on the right, like Save, Apply and Export in the other panels. */}
        <span className="grow" />
        <button className="btn" onClick={copyRecreate} title="Paste in Claude Code">
          Copy /recreate
        </button>
      </footer>
    </>
  )
}

const SIZES: [string, number][] = [
  ['S', 14],
  ['M', 18],
  ['L', 24],
  ['XL', 40],
  ['Display', 64],
]

const FONT_SIZE: Param = { name: 'fontSize', kind: 'number', value: 24, unit: 'px', min: 8, max: 500, start: 0, end: 0 }
const SAMPLE_SIZE: Param = { ...FONT_SIZE, name: 'sampleSize', value: SWATCH_SIZE }

/** Font blocks: the family's name set at a size and weight, as a type spec. */
/** A color swatch: its name and its color. */
function ColorBody({ frame }: { frame: Frame }) {
  const hex = frame.color ?? '#d0d6e0'
  // A name that's still the automatic one follows the color; one the user typed stays.
  const automatic = !frame.label || frame.label === 'Color' || frame.label === nameColor(hex)
  return (
    <div className="insp-scroll">
      <Section title="Color">
        <TextCtl name="Name" plain value={frame.label ?? ''} modified={false} onChange={(label) => updateFrame(frame.id, { label: label.trim() || undefined })} />
        <ColorPicker key={frame.id} value={hex} onChange={(color) => updateFrame(frame.id, { color, ...(automatic ? { label: nameColor(color) } : {}) })} />
      </Section>
    </div>
  )
}

function FontBody({ frame }: { frame: Frame }) {
  const size = frame.size ?? SWATCH_SIZE
  const weight = frame.weight ?? 400
  const weights = useWeights(frame)
  const layout = frame.fontLayout ?? 'name'
  return (
    <div className="insp-scroll insp-font">
      <Section title="Layout">
        <Segmented
          options={FONT_LAYOUTS}
          value={layout}
          onChange={(id) => updateFrame(frame.id, { fontLayout: id === 'name' ? undefined : id })}
        />
      </Section>
      <Section title="Typeface">
        <FontPicker
          value={fontOf(frame)}
          // A weight the new family doesn't come in falls back to Regular.
          onPick={(f) =>
            updateFrame(frame.id, {
              ...swatchFont(f),
              weight: weightOptions(f).includes(weight) && weight !== 400 ? weight : undefined,
            })
          }
        />
      </Section>
      <Section title="Size">
        <NumberCtl p={SAMPLE_SIZE} value={size} modified={size !== SWATCH_SIZE} onChange={(px) => updateFrame(frame.id, { size: px })} />
      </Section>
      <StyleSection frame={frame} weights={weights} weight={weight} onWeight={(w) => updateFrame(frame.id, { weight: w === 400 ? undefined : w })} />
    </div>
  )
}

/** Text: any font, not tied to the board's (the app font until one is picked). */
function TextBody({ frame }: { frame: Frame }) {
  const size = frame.size ?? 24
  const weights = useWeights(frame)
  // The board's fonts are the ones set in its font blocks; text can follow them in one click.
  const frames = useStore((s) => s.board?.frames)
  const board = useMemo(() => boardFonts(frames ?? []), [frames])
  const current = fontOf(frame)
  const onBoardFont = !!current && board.some((f) => f.family === current.family && f.source === current.source)
  return (
    <div className="insp-scroll insp-font">
      <Section title="Typeface">
        {board[0] && !onBoardFont && (
          <div className="insp-buttons">
            <button className="btn" onClick={() => updateFrame(frame.id, { ...swatchFont(board[0]), weight: undefined })}>
              Use board font
            </button>
          </div>
        )}
        <FontPicker
          value={current}
          suggested={board}
          suggestedLabel="Board fonts"
          onPick={(f) => updateFrame(frame.id, { ...swatchFont(f), weight: frame.weight && weightOptions(f).includes(frame.weight) ? frame.weight : undefined })}
        />
      </Section>
      <Section title="Size">
        <NumberCtl p={FONT_SIZE} value={size} modified={size !== FONT_SIZE.value} onChange={(px) => updateFrame(frame.id, { size: px })} />
        <Segmented
          options={SIZES.map(([name, px]) => ({ id: px, label: name }))}
          value={size}
          onChange={(px) => updateFrame(frame.id, { size: px })}
        />
      </Section>
      <StyleSection frame={frame} weights={weights} weight={frame.weight} auto onWeight={(w) => updateFrame(frame.id, { weight: w })} />
    </div>
  )
}

/** Weight buttons (each set in its own weight) plus italic. `auto` adds a choice for "follow the size". */
function StyleSection({
  frame,
  weights,
  weight,
  auto,
  onWeight,
}: {
  frame: Frame
  weights: number[]
  weight?: number
  auto?: boolean
  onWeight: (w: number | undefined) => void
}) {
  const family = frame.font ? fontStack(frame.font, frame.fontCategory) : undefined
  return (
    <Section title="Weight">
      <div className="insp-buttons weight-grid">
        {auto && (
          <button className="btn" data-active={weight === undefined || undefined} style={{ fontFamily: family }} onClick={() => onWeight(undefined)}>
            Auto
          </button>
        )}
        {weights.map((w) => (
          <button
            key={w}
            className="btn"
            data-active={w === weight || undefined}
            title={`${WEIGHT_NAMES[w] ?? w} ${w}`}
            style={{ fontFamily: family, fontWeight: w }}
            onClick={() => onWeight(w)}
          >
            {WEIGHT_NAMES[w] ?? w}
          </button>
        ))}
        <button
          className="btn"
          data-active={frame.italic || undefined}
          style={{ fontFamily: family, fontStyle: 'italic' }}
          onClick={() => updateFrame(frame.id, { italic: frame.italic ? undefined : true })}
        >
          Italic
        </button>
      </div>
    </Section>
  )
}

/** A value that's a share between two parts (a mix, a ratio): the split control, in the value's own units. */
function ShareCtl({
  p,
  parts,
  value,
  modified,
  onChange,
  onReset,
  onRename,
}: {
  p: Param
  parts: [string, string]
  value: number
  modified: boolean
  onChange: (n: number) => void
  onReset: () => void
  onRename: (label: string) => void
}) {
  const max = p.max ?? 1
  const t = Math.min(1, Math.max(0, value / max))
  const o = Math.min(1, Math.max(0, (p.value as number) / max))
  return (
    <SplitCtl
      name={p.label ?? humanize(p.name)}
      parts={parts}
      value={[t, 1 - t]}
      original={[o, 1 - o]}
      min={0}
      modified={modified}
      onChange={(v) => onChange(roundFor(p, v[0] * max))}
      onReset={onReset}
      onRename={onRename}
    />
  )
}

const KINDS: { id: MotionKind; label: string; about: string }[] = [
  { id: 'interface', label: 'Interface', about: 'An app or website recording' },
  { id: 'graphic', label: 'Motion graphic', about: 'A brand post, carousel or animated type' },
  { id: 'footage', label: 'Footage', about: 'Film or live action' },
]
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`
/** "a full width" when it's about one frame across, else the share. */
const howFar = (d = 0) => (Math.abs(d - 1) < 0.08 ? 'a full width' : `${Math.round(d * 100)}%`)
/**
 * The video's motion, for anyone: one button to analyze, then a sentence saying what moves and
 * how ("A new slide every 2.4s…"), what kind of video it reads as (a chip you can change), and
 * the exact numbers under Details. Reading just part of the video is a quiet option.
 */
function Measured({ frame, analysis }: { frame: Frame; analysis: VideoAnalysis | null }) {
  const picking = useStore((s) => s.regionPick === frame.id)
  const busy = useStore((s) => !!s.jobs[frame.id])
  const r = analysis?.read
  const kind = frame.motionKind ?? r?.kind
  const staleArea = !!analysis && JSON.stringify(analysis.region ?? null) !== JSON.stringify(frame.region ?? null)
  const pick = () => setState({ regionPick: picking ? null : frame.id, selected: [frame.id] })
  const area = picking ? (
    <>
      Drag over the part to read on the video ·{' '}
      <button className="link" onClick={pick}>
        Cancel
      </button>
    </>
  ) : frame.region ? (
    <>
      Reading the picked part ·{' '}
      <button className="link" onClick={() => updateFrame(frame.id, { region: undefined })}>
        Whole video
      </button>
    </>
  ) : (
    <button className="link" onClick={pick}>
      Read just part of the video
    </button>
  )
  const analyze = (
    <div className="insp-buttons">
      <button className="btn" onClick={analyzeSelected} disabled={busy}>
        {busy ? 'Watching the video…' : 'Analyze motion'}
      </button>
    </div>
  )

  if (!analysis || !r || !kind) {
    return (
      <>
        <p className="ctl-help">
          {analysis ? 'Analyze again to read this video the new way.' : 'Find how things move in this video: timing, rhythm and pace.'}
        </p>
        {analyze}
        <p className="ctl-help measure-links">{area}</p>
      </>
    )
  }

  const main = mainMove(r)
  const where = (m: Move) => (m.dir ? `${DIR_WORD[m.dir]}, ${howFar(m.distance)}` : m.type === 'fade' ? 'fades' : 'changes in place')
  const curve = (m: Move) => (m.spring ? `stiffness ${m.spring.stiffness} · damping ${m.spring.damping}` : m.ease.bezier.join(', '))
  // Plain names for the measured values, per kind (the export has the same numbers).
  const rows: [string, string, boolean?][] =
    kind === 'footage'
      ? [
          // One continuous shot: nothing to time between cuts.
          ...(r.cuts.length && r.pacing
            ? ([['Shots', `${r.pacing.shots}`], ['New shot every', secs(r.pacing.shotMs)]] as [string, string][])
            : ([['Shots', '1, no cuts']] as [string, string][])),
          ['Pace', r.pacing?.feel ?? 'steady'],
          ...(r.pacing?.camera.length ? ([['Camera', r.pacing.camera.map((c) => c.kind).join(', ')]] as [string, string][]) : []),
        ]
      : kind === 'graphic' && r.rhythm
        ? [
            ['Changes', `${r.rhythm.beats}`],
            ['Each change takes', secs(r.rhythm.moveMs)],
            ['Stays for', secs(r.rhythm.holdMs)],
            ['New one every', secs(r.rhythm.everyMs)],
            ...(main ? ([['Moves', where(main)], ['Feel', feelOf(main)], ['Curve', curve(main), true]] as [string, string, boolean][]) : []),
          ]
        : main
          ? [
              ['Starts at', secs(main.startMs)],
              ['Takes', secs(main.durationMs)],
              ['Moves', where(main)],
              ['Feel', feelOf(main)],
              ...(r.moves.length > 1 ? ([['Other moves', r.moves.filter((m) => m !== main).map((m) => secs(m.durationMs)).join(', ')]] as [string, string][]) : []),
              ['Curve', curve(main), true],
            ]
          : []

  return (
    <>
      <KindChip value={kind} guessed={r.kind} set={!!frame.motionKind} onChange={(k) => updateFrame(frame.id, { motionKind: k === r.kind ? undefined : k })} />
      {rows.length ? <Facts rows={rows} /> : <p className="ctl-help">No clear motion in this part of the video.</p>}
      {staleArea && <p className="ctl-help">Analyze again to read {frame.region ? 'just the picked part' : 'the whole video'}.</p>}
      <p className="ctl-help measure-links">
        <button className="link" onClick={analyzeSelected} disabled={busy}>
          {busy ? 'Watching…' : 'Analyze again'}
        </button>
        <span className="grow" />
        {area}
      </p>
    </>
  )
}

const DIR_WORD: Record<NonNullable<Move['dir']>, string> = { '←': 'left', '→': 'right', '↑': 'up', '↓': 'down' }

/** What kind of video it reads as: a chip that opens the three kinds, each said in everyday words. */
function KindChip({ value, guessed, set, onChange }: { value: MotionKind; guessed: MotionKind; set: boolean; onChange: (k: MotionKind) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [open])
  const k = KINDS.find((x) => x.id === value)!
  return (
    <div className="kind-chip" ref={root}>
      <button className="kind-chip-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="What kind of video this is">
        {k.label}
        <CaretIcon />
      </button>
      {set && <span className="kind-chip-note">set by you</span>}
      {open && (
        <div className="kind-menu" role="menu">
          {KINDS.map((x) => (
            <button key={x.id} role="menuitemradio" aria-checked={x.id === value} onClick={() => (onChange(x.id), setOpen(false))}>
              <span>
                {x.label}
                {x.id === guessed && <small> · its guess</small>}
              </span>
              <small>{x.about}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Facts({ rows }: { rows: [string, string, boolean?][] }) {
  return (
    <dl className="insp-facts">
      {rows.map(([k, v, mono]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className={mono ? 'mono' : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Each detected animation with its name in words; repeats get a number ("Title fades in 2"). */
function nameGroups<G extends { id: string; title: string; what?: string; context: string }>(groups: G[]) {
  const seen = new Map<string, number>()
  const total = new Map<string, number>()
  const all = groups.map((g) => ({ g, ...friendlyGroup(g) }))
  for (const x of all) total.set(x.name, (total.get(x.name) ?? 0) + 1)
  return all.map((x) => {
    if ((total.get(x.name) ?? 0) < 2) return x
    const n = (seen.get(x.name) ?? 0) + 1
    seen.set(x.name, n)
    return { ...x, name: `${x.name} ${n}` }
  })
}
