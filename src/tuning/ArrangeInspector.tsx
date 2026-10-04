import { useEffect, useState } from 'react'
import type { Param } from '../../shared/params.ts'
import type { Frame } from '../../shared/types.ts'
import {
  arrange,
  canCrop,
  clearArrangePreview,
  evenOut,
  freeLayout,
  geoOf,
  lastArrange,
  previewArrange,
  resetCrop,
  setLayout,
  startCrop,
  takeOut,
  tileSection,
} from '../arrange'
import { computeLayout, currentOption, LAYOUT_GAP, LAYOUT_PAD, optionsFor, ROW_OPTIONS, shapesFor, withOption, type LayoutMode } from '../layout'
import { frameById, useStore } from '../store'
import { Segmented } from '../ui/Segmented'
import { NumberCtl } from './controls'

const MODES: { id: LayoutMode; label: string }[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'columns', label: 'Columns' },
  { id: 'rows', label: 'Rows' },
]
/** The choice a mode starts on. */
const firstOption = (mode: LayoutMode) => (mode === 'grid' ? 0 : mode === 'columns' ? 3 : 240)
const optionLabel = (mode: LayoutMode, o: number) =>
  mode === 'columns' ? `${o} columns` : mode === 'rows' ? (ROW_OPTIONS.find((r) => r.h === o)?.label ?? '') : ''

const MINI_W = 112
const MINI_H = 64
/** Space between blocks in a drawing, in its own pixels. */
const MINI_GAP = 3
/** Laid out big without gaps, then stretched to fill the drawing, so every choice fills the same area. */
const BIG = 760

/** One choice drawn as plain blocks filling the card. */
function Mini({ mode, option, ids }: { mode: LayoutMode; option: number; ids: string[] }) {
  const L = withOption({ mode, order: ids, gap: 0 }, mode, option)
  const h0 = mode === 'grid' ? BIG * (shapesFor(ids.length)[option]?.a ?? 0.6) : BIG
  const geo = computeLayout({ x: -LAYOUT_PAD, y: -LAYOUT_PAD, w: BIG + LAYOUT_PAD * 2, h: h0 + LAYOUT_PAD * 2 }, L, frameById)
  const kx = MINI_W / BIG
  const ky = MINI_H / Math.max(1, mode === 'grid' ? h0 : geo.height)
  const half = MINI_GAP / 2
  // Inset each block by half a gap, except along the drawing's edges.
  const edge = (v: number, lo: number, hi: number) => (Math.abs(v - lo) < 0.5 || Math.abs(v - hi) < 0.5 ? 0 : half)
  return (
    <svg className="mini" viewBox={`0 0 ${MINI_W} ${MINI_H}`} aria-hidden>
      {[...geo.rects.values()].map((r, i) => {
        const x0 = r.x * kx
        const y0 = r.y * ky
        const x1 = (r.x + r.w) * kx
        const y1 = Math.min(MINI_H, (r.y + r.h) * ky)
        const x = x0 + edge(x0, 0, MINI_W)
        const y = y0 + edge(y0, 0, MINI_H)
        const w = x1 - edge(x1, 0, MINI_W) - x
        const h = y1 - edge(y1, 0, MINI_H) - y
        return <rect key={i} x={x} y={y} width={Math.max(1, w)} height={Math.max(1, h)} rx="2" />
      })}
    </svg>
  )
}

/**
 * Grid / Columns / Rows and the choices for each, drawn with the blocks themselves. Hovering
 * a choice shows it on the canvas; clicking applies it. `target` is a section, or null for
 * the loose blocks selected.
 */
export function ArrangeChoices({
  target,
  ids,
  mode,
  active,
  onMode,
}: {
  target: string | null
  ids: string[]
  mode: LayoutMode
  active: number | null
  onMode: (m: LayoutMode) => void
}) {
  // Leaving the panel (or the selection changing) takes any preview away.
  useEffect(() => () => clearArrangePreview(), [target, ids.join()])
  const options = optionsFor(mode, ids.length)
  return (
    <>
      <Segmented options={MODES} value={mode} onChange={onMode} remember="arrange-mode" />
      {options.length > 0 && (
        <div className="shapes" onMouseLeave={clearArrangePreview}>
          {options.map((o) => (
            <button
              key={o}
              className="shape"
              data-active={active === o || undefined}
              onMouseEnter={() => (active === o ? clearArrangePreview() : previewArrange(target, mode, o))}
              onFocus={() => active !== o && previewArrange(target, mode, o)}
              onBlur={clearArrangePreview}
              onClick={() => arrange(target, mode, o)}
              aria-label={optionLabel(mode, o) || `Shape ${o + 1}`}
            >
              <Mini mode={mode} option={o} ids={ids} />
              {optionLabel(mode, o) && <small>{optionLabel(mode, o)}</small>}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

const GAP_PARAM: Param = { name: 'gap', label: 'Gap', kind: 'number', value: LAYOUT_GAP, unit: 'px', min: 0, max: 48, step: 1, start: 0, end: 0 }

const HELP: Record<LayoutMode, string> = {
  grid: 'Drag a block’s edges or the lines between blocks to resize. Push past a block and it moves to make room.',
  columns: 'Drag a block’s side to span more columns. Heights follow each block’s shape.',
  rows: 'Drag a block’s bottom edge to change its row. Widths follow each block’s shape.',
}

/** A selected section: lay out what's in it, or change its layout. */
export function SectionBody({ frame }: { frame: Frame }) {
  const L = frame.layout
  const [mode, setMode] = useState<LayoutMode>(() => lastArrange().mode)
  const inner = useStore((s) => (L ? '' : (s.board?.frames ?? []).filter((f) => f.type !== 'section' && f.x + f.w / 2 > frame.x && f.x + f.w / 2 < frame.x + frame.w && f.y + f.h / 2 > frame.y && f.y + f.h / 2 < frame.y + frame.h).map((f) => f.id).join()))
  const ids = L ? L.order : inner ? inner.split(',') : []
  return (
    <div className="insp-scroll">
      <section className="insp-section">
        <h3>{L ? 'Layout' : 'Arrange'}</h3>
        <ArrangeChoices
          target={frame.id}
          ids={ids}
          mode={L ? L.mode : mode}
          active={L ? currentOption(L) : null}
          onMode={(m) => (L ? m !== L.mode && arrange(frame.id, m, firstOption(m)) : setMode(m))}
        />
        <p className="ctl-help">{L ? HELP[L.mode] : 'Lays out the blocks in this section. Blocks dropped in later join it.'}</p>
      </section>
      {L && (
        <section className="insp-section">
          <NumberCtl
            p={GAP_PARAM}
            value={L.gap}
            modified={L.gap !== LAYOUT_GAP}
            onChange={(gap) => setLayout(frame.id, { gap })}
            onReset={() => setLayout(frame.id, { gap: LAYOUT_GAP })}
          />
          <div className="insp-buttons">
            <button className="btn" onClick={() => evenOut(frame.id)} title="Every part back to the same size">
              Even out
            </button>
            <button className="btn" onClick={() => freeLayout(frame.id)} title="Keep the section and where its blocks are, without a layout">
              Free layout
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

/** A block in a layout: its size there, its crop, and taking it out. */
export function TileBody({ frame }: { frame: Frame }) {
  const s = useStore(() => tileSection(frame.id))
  const cropping = useStore((st) => st.crop === frame.id)
  const crop = useStore(() => frameById(frame.id)?.crop)
  const size = useStore(() => {
    const sec = tileSection(frame.id)
    const r = sec && geoOf(sec).rects.get(frame.id)
    return r ? `${Math.round(r.w)} × ${Math.round(r.h)}` : ''
  })
  if (!s?.layout) return null
  return (
    <section className="insp-section">
      <h3>
        In {s.label ? `“${s.label}”` : 'a layout'}
        <small className="insp-size">{size}</small>
      </h3>
      <p className="ctl-help">
        <kbd>←</kbd> <kbd>↑</kbd> <kbd>→</kbd> <kbd>↓</kbd> trade places. {HELP[s.layout.mode]}
      </p>
      <div className="insp-buttons">
        {canCrop(frame) && (
          <button className="btn" onClick={() => startCrop(frame.id)} title="Drag to move the picture, scroll to zoom  ↵">
            {cropping ? 'Done' : 'Crop'}
          </button>
        )}
        {crop && (
          <button className="btn" onClick={() => resetCrop(frame.id)}>
            Reset crop
          </button>
        )}
        <button className="btn" onClick={() => takeOut(frame.id)}>
          Take out
        </button>
      </div>
    </section>
  )
}

/** Several loose blocks selected: put them in a layout. */
export function SelectionArrange({ ids }: { ids: string[] }) {
  const [mode, setMode] = useState<LayoutMode>(() => lastArrange().mode)
  return (
    <section className="insp-section">
      <h3>Arrange</h3>
      <ArrangeChoices target={null} ids={ids} mode={mode} active={null} onMode={setMode} />
      <p className="ctl-help">
        Hover to preview.
      </p>
    </section>
  )
}
