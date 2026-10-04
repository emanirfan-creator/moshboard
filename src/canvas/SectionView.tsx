import { memo, useMemo, useState } from 'react'
import type { Frame } from '../../shared/types.ts'
import { isSection, sectionContents } from '../../shared/sections.ts'
import { addText, pickSection } from '../actions'
import { getState, screenToWorld, setState, updateFrame, useStore } from '../store'
import { DIRS, HANDLE_POS, HIDDEN, NONE, dragLine, pressFrame, resizeFrame } from './gestures'
import { computeLayout, layoutMembers } from '../layout'
import { frameById } from '../store'

/**
 * A section: a titled area that holds the blocks inside it. The title sits above the box at
 * a readable size at any zoom, with the section's one-line description beside it. Drag it by
 * its title or its empty space to move it with its blocks (like Figma); ⌘-drag inside it to
 * box-select its blocks.
 */
export const SectionView = memo(function SectionView({ frame: stored }: { frame: Frame }) {
  // Hovering a layout in the side panel: drawn at the size it would take.
  const preview = useStore((s) => (s.arrange?.id === stored.id ? s.arrange.section : null))
  const frame = preview ? { ...stored, ...preview } : stored
  // A grid's lines show while it or one of its blocks is selected.
  const showLines = useStore(
    (s) =>
      stored.layout?.mode === 'grid' &&
      !s.arrange &&
      !s.crop &&
      s.selected.length === 1 &&
      (s.selected[0] === stored.id || (!!s.board && layoutMembers(s.board.frames).get(s.selected[0]) === stored.id)),
  )
  const frames = useStore((s) => (showLines ? s.board?.frames : undefined))
  const lines = useMemo(() => (frames ? computeLayout(stored, stored.layout!, frameById).lines : null), [frames, stored])
  const selected = useStore((s) => s.selected.includes(frame.id))
  const single = useStore((s) => s.selected.length === 1 && s.selected[0] === frame.id)
  const drop = useStore((s) => s.dropSection === frame.id)
  const renaming = useStore((s) => s.renaming === frame.id)
  const count = useStore((s) => (s.board ? sectionContents(frame, s.board.frames).filter((f) => !isSection(f)).length : 0))
  const [describing, setDescribing] = useState(false)
  const off = useStore((s) => (s.compare ? (s.compare.offsets[frame.id] ?? HIDDEN) : NONE))
  const comparing = off !== NONE && off !== HIDDEN

  return (
    <div
      className="section"
      data-selected={selected || undefined}
      data-drop={drop || undefined}
      data-hidden={off === HIDDEN || undefined}
      data-chosen={frame.chosen || undefined}
      data-layout={frame.layout?.mode}
      data-preview={preview ? '' : undefined}
      style={{ left: frame.x + off.dx, top: frame.y + off.dy, width: frame.w, height: frame.h, '--w': `${frame.w}px` } as React.CSSProperties}
    >
      <div
        className="section-box"
        onPointerDown={(e) => {
          // ⌘-drag falls through to the canvas: a selection box inside the section.
          if (!e.metaKey && !e.ctrlKey) pressFrame(e, frame.id)
        }}
        // Double-click writes there; a layout places its blocks itself.
        onDoubleClick={(e) => (e.stopPropagation(), !frame.layout && addText(screenToWorld(e.clientX, e.clientY), false))}
      />
      <div
        className="section-head"
        onPointerDown={(e) => pressFrame(e, frame.id)}
        onDoubleClick={(e) => (e.stopPropagation(), setState({ renaming: frame.id, selected: [frame.id] }))}
      >
        {frame.chosen && (
          <svg className="section-check" width="12" height="12" viewBox="0 0 12 12" aria-label="Approved">
            <path d="m2.5 6.2 2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {renaming ? (
          <input
            className="section-input section-title"
            autoFocus
            placeholder="Name this section"
            defaultValue={frame.label ?? ''}
            size={Math.max(12, (frame.label ?? '').length + 1)}
            onPointerDown={(e) => e.stopPropagation()}
            onFocus={(e) => e.target.select()}
            onInput={(e) => ((e.target as HTMLInputElement).size = Math.max(12, (e.target as HTMLInputElement).value.length + 1))}
            onBlur={(e) => {
              updateFrame(frame.id, { label: e.target.value.trim() || undefined })
              if (getState().renaming === frame.id) setState({ renaming: null })
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
              // Tab goes on to the description, like a form.
              if (e.key === 'Tab') {
                e.preventDefault()
                ;(e.target as HTMLInputElement).blur()
                setDescribing(true)
              }
            }}
          />
        ) : (
          <span className="section-title" title="Double-click to rename">
            {frame.label || 'Section'}
          </span>
        )}
        {count > 0 && <span className="section-count">{count}</span>}
        {/* Approve the direction to build: on the selected section, or any section while comparing
            (quiet until hovered). Approving one turns any other off. */}
        {(comparing || single) && (
          <button
            className="section-pick"
            data-on={frame.chosen || undefined}
            data-shown={single || undefined}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => pickSection(frame.id)}
          >
            {frame.chosen ? 'Approved' : 'Approve'}
          </button>
        )}
        {describing ? (
          <input
            className="section-input section-desc"
            autoFocus
            placeholder="What these have in common"
            defaultValue={frame.text ?? ''}
            size={Math.max(24, (frame.text ?? '').length + 1)}
            onPointerDown={(e) => e.stopPropagation()}
            onInput={(e) => ((e.target as HTMLInputElement).size = Math.max(24, (e.target as HTMLInputElement).value.length + 1))}
            onBlur={(e) => {
              updateFrame(frame.id, { text: e.target.value.trim() || undefined })
              setDescribing(false)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') {
                e.preventDefault()
                ;(e.target as HTMLInputElement).blur()
              }
            }}
          />
        ) : frame.text ? (
          <span
            className="section-desc"
            onPointerDown={(e) => selected && e.stopPropagation()}
            onClick={() => selected && setDescribing(true)}
          >
            {frame.text}
          </span>
        ) : (
          selected && (
            <button
              className="section-desc section-add"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setDescribing(true)}
            >
              Add description
            </button>
          )
        )}
      </div>
      {lines?.map((l) => (
        <div
          key={`${l.path.join('.')}:${l.i}`}
          className="layout-line"
          data-axis={l.axis}
          style={
            l.axis === 'x'
              ? { left: l.at - frame.x, top: l.from - frame.y, height: l.len }
              : { left: l.from - frame.x, top: l.at - frame.y, width: l.len }
          }
          onPointerDown={(e) => dragLine(e, stored, l)}
        >
          <i />
        </div>
      ))}
      {single &&
        !preview &&
        off === NONE &&
        // Columns and rows set their own height: only the width is yours.
        (frame.layout && frame.layout.mode !== 'grid' ? (['e', 'w'] as const) : DIRS).map((d) => (
          <div
            key={d}
            className="handle"
            data-dir={d}
            style={{ left: `${HANDLE_POS[d][0]}%`, top: `${HANDLE_POS[d][1]}%` }}
            onPointerDown={(e) => resizeFrame(e, frame, d)}
          />
        ))}
    </div>
  )
})
