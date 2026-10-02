import { useEffect, useMemo, useRef, useState } from 'react'
import { hasColors } from '../boardColors'
import {
  addNote,
  addPalette,
  alignSelection,
  tidySelection,
  combineSwatches,
  regeneratePalette,
  splitPalette,
  addText,
  addSwatch,
  analyzeSelected,
  captureSelected,
  copyRecreate,
  deleteSelected,
  duplicateSelected,
  exportBoard,
  fitBoard,
  linkSelected,
  lockParams,
  makeTunable,
  detectMotionValues,
  markSegment,
  replay,
  resetParams,
  setViewport,
  switchBoard,
  createCanvas,
  renameCanvas,
  unlinkSelected,
} from '../actions'
import { isTunable } from '../../shared/autoParams.ts'
import { setSounds, soundsOn } from '../ui/sound'
import { frameById, getState, setState, toggleSidebar, updateFrame, useStore } from '../store'

interface Command {
  id: string
  group: string
  title: string
  kbd?: string
  run: () => unknown
}

interface Prompt {
  placeholder: string
  initial?: string
  submit: (value: string) => unknown
}

export function CommandPalette() {
  const open = useStore((s) => s.palette)
  if (!open) return null
  return <Palette />
}

function Palette() {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const close = () => setState({ palette: false })

  const commands = useMemo<Command[]>(() => {
    const s = getState()
    const sel = s.selected.map(frameById).filter(Boolean)
    const one = sel.length === 1 ? sel[0]! : undefined
    const ask = (p: Prompt) => () => {
      setPrompt(p)
      setQuery(p.initial ?? '')
      return 'keep'
    }
    const list: Command[] = []
    const add = (group: string, title: string, run: () => unknown, kbd?: string) =>
      list.push({ id: `${group}:${title}`, group, title, run, kbd })

    if (one?.type === 'code') {
      add('Frame', 'Replay', () => replay(), 'R')
      if (s.overrides[one.id]) {
        add('Frame', 'Save tuned values to code', () => lockParams(), '⌘S')
        add('Frame', 'Reset tuned values', () => resetParams())
      }
      add('Frame', 'Detect motion values', () => detectMotionValues())
      if (one.file?.endsWith('.tsx') && !isTunable(s.files[one.file] ?? '')) add('Frame', 'Add controls to code', () => makeTunable())
      add('Frame', 'Copy /recreate command', copyRecreate)
    }
    if (one?.type === 'video') {
      add('Video', 'Analyze motion', analyzeSelected)
      add('Video', 'Mark segment start', () => markSegment('in'), 'I')
      add('Video', 'Mark segment end', () => markSegment('out'), 'O')
      if (one.segment) add('Video', 'Clear segment', () => updateFrame(one.id, { segment: undefined }))
      add('Video', 'Copy /recreate command', copyRecreate)
      add('Video', 'Replay with linked copy', () => replay(), 'R')
    }
    if (one?.type === 'url') {
      add(
        'Site',
        'Capture motion…',
        ask({
          placeholder: 'Selector and trigger, e.g. .card hover · nav a click · section scroll',
          submit: (v) => {
            const m = /^(.*?)\s+(hover|click|focus|scroll|load)$/i.exec(v.trim())
            return captureSelected(m ? m[1] : v.trim() || 'body', m ? m[2].toLowerCase() : 'hover')
          },
        }),
      )
      add('Site', 'Copy /recreate command', copyRecreate)
    }
    if (one?.type === 'code' || one?.type === 'url') {
      for (const w of [375, 768, 1280]) add('Frame', `Render at ${w}px wide`, () => setViewport(w))
      if (one.viewport) add('Frame', 'Render at frame size', () => setViewport(undefined))
    }
    if (one?.type === 'palette') {
      add('Palette', 'Generate new colors', () => regeneratePalette())
      add('Palette', 'Split into swatches', () => splitPalette())
    }
    if (sel.filter((f) => f!.type === 'swatch' || f!.type === 'palette').length >= 2)
      add('Palette', 'Merge into one palette', combineSwatches)
    if (sel.length >= 2) {
      add('Arrange', 'Tidy up into a grid', tidySelection, '⌃⌥T')
      add('Arrange', 'Align left', () => alignSelection('left'))
      add('Arrange', 'Align top', () => alignSelection('top'))
    }
    if (sel.length === 2) add('Frame', 'Link to reference', linkSelected)
    if (sel.some((f) => f!.link)) add('Frame', 'Unlink', unlinkSelected)
    if (one)
      add(
        'Frame',
        'Rename…',
        ask({
          placeholder: 'Frame name',
          initial: one.label ?? '',
          submit: (v) => updateFrame(one.id, { label: v.trim() || undefined }),
        }),
      )
    if (sel.length) {
      add('Frame', 'Duplicate', duplicateSelected, '⌘D')
      add('Frame', 'Delete', deleteSelected, '⌫')
    }

    add('Add', 'Image or video…', () => setState({ add: 'media' }))
    add('Add', 'Component (install command or code)…', () => setState({ add: 'code' }))
    add('Add', 'Link (Pinterest, Cosmos, website)…', () => setState({ add: 'url' }))
    add('Add', 'Text', () => addText(), 'T')
    add('Add', 'Note', () => addNote())
    add('Add', sel.some((f) => hasColors(f!, true)) ? 'Palette from selection' : 'Palette', () => addPalette())
    add('Add', 'Color swatch', () => addSwatch('color'))
    add('Add', 'Font swatch', () => addSwatch('font'))

    add('Canvas', 'Fit to screen', fitBoard, '⌘0')
    add('Canvas', soundsOn() ? 'Turn control sounds off' : 'Turn control sounds on', () => setSounds(!soundsOn()))
    add('Canvas', 'Export spec (design.md, motion.md)', exportBoard)
    add('Canvas', 'New canvas…', ask({ placeholder: 'Canvas name', submit: (v) => createCanvas(v) }))
    add(
      'Canvas',
      'Rename canvas…',
      ask({ placeholder: 'Canvas name', initial: s.board?.name, submit: (v) => renameCanvas(v) }),
    )
    add('Canvas', s.sidebar ? 'Hide sidebar' : 'Show sidebar', () => toggleSidebar(), '[')
    add('Help', 'Keyboard shortcuts', () => setState({ shortcuts: true }), '?')
    for (const c of s.canvases) if (c.id !== s.boardName) add('Go to', c.name, () => switchBoard(c.id))
    return list
  }, [])

  const filtered = useMemo(() => {
    if (prompt) return []
    const q = query.toLowerCase().trim()
    if (!q) return commands
    return commands.filter((c) => q.split(/\s+/).every((w) => `${c.group} ${c.title}`.toLowerCase().includes(w)))
  }, [commands, query, prompt])

  useEffect(() => setActive(0), [query])
  useEffect(() => input.current?.focus(), [prompt])

  const run = async (c?: Command) => {
    if (!c) return
    const r = await c.run()
    if (r !== 'keep') close()
  }

  return (
    <>
      <div className="palette-scrim" onPointerDown={close} />
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          ref={input}
          value={query}
          placeholder={prompt?.placeholder ?? 'Type a command…'}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              if (prompt) {
                setPrompt(null)
                setQuery('')
              } else close()
            } else if (prompt && e.key === 'Enter') {
              const p = prompt
              close()
              p.submit(query)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(filtered.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter') run(filtered[active])
            else if (e.key === 'k' && e.metaKey) close()
          }}
        />
        {prompt ? (
          <div className="hint">Enter to confirm · Esc to go back</div>
        ) : filtered.length ? (
          <ul>
            {filtered.map((c, i) => (
              <li
                key={c.id}
                data-active={i === active || undefined}
                onPointerMove={() => setActive(i)}
                onClick={() => run(c)}
              >
                <span>
                  <span className="group">{c.group}</span>
                  {c.title}
                </span>
                {c.kbd && <kbd>{c.kbd}</kbd>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="hint">No matching commands</div>
        )}
      </div>
    </>
  )
}
