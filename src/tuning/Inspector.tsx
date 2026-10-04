import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE, type ReactNode } from 'react'
import { defaults, humanize, paramUse, parseParams, type Bezier, type Param, type Spring } from '../../shared/params.ts'
import type { Frame } from '../../shared/types.ts'
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
import { CloseIcon } from '../ui/icons'
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
import { SelectionBody } from './SelectionInspector'
import { SectionBody, TileBody } from './ArrangeInspector'
import { isTile } from '../arrange'

const MODE_KIND = { grid: 'Grid', columns: 'Columns', rows: 'Rows' } as const
import { BezierCtl, ColorCtl, NameLabel, NumberCtl, SpringCtl, TextCtl, Timeline } from './controls'
import { ColorPicker } from '../ui/ColorPicker'
import { nameColor } from '../../shared/color.ts'
import { useDetection } from './detection'
import { PropsSections, useComponentProps } from './PropsInspector'
import { runtimeGroups } from '../../shared/runtime-motion.ts'
import { Segmented } from '../ui/Segmented'
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
  const shown = open ? { frame, multi } : last.current

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
  children,
}: {
  title: ReactNode
  note?: string
  /** file:line, right of the title */
  where?: string
  index?: number
  children: ReactNode
}) {
  return (
    <section
      className="insp-section"
      data-scan={index !== undefined || undefined}
      style={index !== undefined ? ({ '--i': index } as React.CSSProperties) : undefined}
    >
      <header className="insp-section-head">
        <div className="insp-title-row">
          <h3>{title}</h3>
          {where && <span className="insp-where">{where}</span>}
        </div>
        {note && (
          <span className="insp-src" title={note}>
            {note}
          </span>
        )}
      </header>
      {children}
    </section>
  )
}

/** One detected animation: its timing on a timeline, then easing / spring / other values. */
function DetectedSection({
  group,
  index,
  values,
  mod,
  set,
  reset,
  rename,
  labels,
  reference,
}: {
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
    <Section title={group.title} note={group.context} where={group.line ? `${group.file}:${group.line}` : group.file} index={index}>
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
  const refKey = useStore((s) => (frame.link && s.files ? JSON.stringify(referenceTiming(frame)) : 'null'))
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
          <Section key={element || 'values'} title={element ? humanize(element) : 'Values'}>
            <div className="insp-stack">
              {list.map((p) => (
                <NumberCtl
                  key={p.name}
                  p={named(p)}
                  value={values[p.name] as number}
                  modified={mod(p.name)}
                  onChange={change(p.name)}
                  onReset={() => reset(p.name)}
                  onRename={(l) => rename(p.name, l)}
                />
              ))}
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
        {[...detection.groups, ...running].map((g, i) => (
          <DetectedSection
            key={g.id}
            group={g}
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
        <Section title="Motion segment">
          <div className="ctl">
            <div className="ctl-head">
              <span className="ctl-val">{t2(time)}</span>
              <span className="ctl-name">{t2(duration)}</span>
            </div>
            <div className="timeline" onPointerDown={seek} style={{ cursor: 'pointer', width: W }}>
              {analysis?.bursts.map((b, i) => (
                <div
                  key={i}
                  className="tl-burst"
                  style={{ left: x(b.startMs / 1000), width: x(b.durationMs / 1000) }}
                  title={`motion ${b.startMs}–${b.endMs}ms`}
                />
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
        <Section title="Measured">
          {analysis?.primary ? (
            <dl className="insp-facts">
              <div>
                <dt>Starts at</dt>
                <dd>{analysis.primary.startMs}ms</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>≈ {analysis.primary.durationMs}ms</dd>
              </div>
              <div>
                <dt>Curve</dt>
                <dd>{analysis.primary.ease.nearest}</dd>
              </div>
              <div>
                <dt>Bezier</dt>
                <dd className="mono">{analysis.primary.ease.bezier.join(', ')}</dd>
              </div>
            </dl>
          ) : (
            <p className="ctl-help">
              {analysis ? 'No clear motion in this segment.' : 'Analyze to measure timing and easing.'}
            </p>
          )}
        </Section>
      </div>
      <footer className="insp-foot">
        <button className="btn" onClick={copyRecreate} title="Paste in Claude Code">
          Copy /recreate
        </button>
        <span className="grow" />
        <button className="btn btn-primary" onClick={analyzeSelected}>
          Analyze motion
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
        <TextCtl name="Name" value={frame.label ?? ''} modified={false} onChange={(label) => updateFrame(frame.id, { label: label.trim() || undefined })} />
        <ColorPicker value={hex} onChange={(color) => updateFrame(frame.id, { color, ...(automatic ? { label: nameColor(color) } : {}) })} />
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
