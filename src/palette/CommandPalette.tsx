import { useEffect, useMemo, useRef, useState } from 'react'
import { arrange, arrangeable, arrangeAgain, canCrop, freeLayout, isTile, startCrop, takeOut } from '../arrange'
import { askClaude } from '../folder/ClaudeTask'
import { chooseFolder, FOLDER_ONLY, folderSupported, switchFolder } from '../folder/folder'
import { hasColors } from '../boardColors'
import { canCompare, exitCompare, startCompare } from '../canvas/compare'
import { clearResolved, setCommenting, stepComment } from '../comments/comments'
import { playSound, stopRecording } from '../frames/audio'
import {
  addNote,
  assetUrl,
  recordSounds,
  splitSounds,
  combineSounds,
  addPalette,
  combineSwatches,
  regeneratePalette,
  randomizePalette,
  splitPalette,
  addText,
  addSwatch,
  analyzeSelected,
  copyRecreate,
  deleteSelected,
  duplicateSelected,
  stackSelected,
  exportBoard,
  fitBoard,
  linkSelected,
  canLinkSelected,
  joinableLinks,
  joinLink,
  linkReference,
  selectLink,
  isLinked,
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
  duplicateCanvas,
  openSample,
  unlinkSelected,
  addSection,
  fitSection,
  ungroupSection,
  focusFrame,
  pickSection,
  fileAspect,
  setView,
} from '../actions'
import { isTunable } from '../../shared/autoParams.ts'
import { linkNumbers } from '../../shared/frame-links.ts'
import { shareBoard } from '../share'
import { POST_SITE } from '../../shared/posts.ts'
import { beginCrop } from '../frames/ViewPicker'
import { setSounds, soundsOn } from '../ui/sound'
import { frameById, getState, setState, togglePins, toggleSidebar, updateFrame, useStore } from '../store'

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
    if ((one?.type === 'image' || one?.type === 'video') && one.src) {
      const group = one.type === 'image' ? 'Picture' : 'Video'
      add(group, 'Crop…', () => beginCrop(one.id))
      add(group, 'Crop with Claude…', () => askClaude('crop', one.id))
      if (one.view) add(group, 'Show all of it', () => fileAspect(one).then((a) => setView(one.id, null, a)))
    }
    if (one?.type === 'video') {
      add('Video', 'Analyze motion', analyzeSelected)
      add('Video', 'Mark segment start', () => markSegment('in'), 'I')
      add('Video', 'Mark segment end', () => markSegment('out'), 'O')
      if (one.segment) add('Video', 'Clear segment', () => updateFrame(one.id, { segment: undefined }))
      add('Video', 'Copy /recreate command', copyRecreate)
      add('Video', 'Replay with linked copy', () => replay(), 'R')
    }
    if (one?.type === 'audio' && one.src && !one.music) {
      const src = one.src
      add('Sound', 'Play', () => playSound(one.id, assetUrl(src)))
    }
    if (one?.type === 'audio' && !one.music) add('Sound', s.recording ? 'Stop recording' : 'Record more from a tab…', () => recordSounds(undefined, one.id))
    if (one?.clips) add('Sound', 'Split into separate sounds', () => splitSounds(one.id))
    if (sel.filter((f) => f!.type === 'audio' && !f!.music).length >= 2) add('Sound', 'Merge into pads', combineSounds)
    if (one?.type === 'url' && one.post) {
      const src = one.src
      add('Post', `Open on ${POST_SITE[one.post.provider]}`, () => window.open(src, '_blank', 'noopener'))
    } else if (one?.type === 'url' && FOLDER_ONLY) {
      // The website can't drive a browser: these go to the user's Claude.
      add('Site', 'Capture motion with Claude…', () => askClaude('capture', one.id))
      if (one.embed === 'blocked') add('Site', 'Snapshot with Claude…', () => askClaude('snapshot', one.id))
      add('Site', 'Read fonts with Claude…', () => askClaude('fonts', one.id))
      add('Site', 'Copy /recreate command', copyRecreate)
    } else if (one?.type === 'url') {
      add('Site', 'Capture motion…', () => setState({ picking: one.id }))
      add('Site', 'Copy /recreate command', copyRecreate)
    }
    if (one?.type === 'code' || (one?.type === 'url' && !one.post)) {
      for (const w of [375, 768, 1280]) add('Frame', `Render at ${w}px wide`, () => setViewport(w))
      if (one.viewport) add('Frame', 'Render at frame size', () => setViewport(undefined))
    }
    if (one?.type === 'palette') {
      add('Palette', 'Generate colors from the board', () => regeneratePalette())
      add('Palette', 'Random colors', () => randomizePalette())
      add('Palette', 'Split into swatches', () => splitPalette())
    }
    if (sel.filter((f) => f!.type === 'swatch' || f!.type === 'palette').length >= 2)
      add('Palette', 'Merge into one palette', combineSwatches)
    if (sel.length >= 2) {
      if (!arrangeable().why) {
        add('Arrange', 'Arrange as grid', () => arrange(null, 'grid', 0), '⌃⌥T')
        add('Arrange', 'Arrange in columns', () => arrange(null, 'columns', 3))
        add('Arrange', 'Arrange in rows', () => arrange(null, 'rows', 240))
      }
    }
    if (s.compare) add('Section', 'Stop comparing', exitCompare, 'Esc')
    else if (canCompare()) add('Section', sel.filter((f) => f!.type === 'section').length >= 2 ? 'Compare side by side' : 'Compare all sections side by side', startCompare, 'X')
    if (one?.type === 'section') {
      if (one.layout) {
        add('Section', 'Next layout shape', arrangeAgain, '⌃⌥T')
        add('Section', 'Free layout (keep positions)', () => freeLayout(one.id))
      } else {
        add('Section', 'Arrange as grid', () => arrange(one.id, 'grid', 0), '⌃⌥T')
        add('Section', 'Arrange in columns', () => arrange(one.id, 'columns', 3))
        add('Section', 'Arrange in rows', () => arrange(one.id, 'rows', 240))
      }
      add('Section', one.chosen ? 'Unapprove this section' : 'Approve this section', () => pickSection())
      add('Section', 'Fit to contents', () => fitSection())
      add('Section', 'Remove section, keep contents', () => ungroupSection())
    }
    if (one && isTile(one.id)) {
      add('Layout', 'Take out of the layout', () => takeOut(one.id))
      if (canCrop(one)) add('Layout', 'Pan & zoom', () => startCrop(one.id), '↵')
    }
    if (canLinkSelected()) {
      add('Link', 'Link together', () => linkSelected('together'))
      const ref = linkReference()
      if (sel.length > 2 && ref) add('Link', `Link each to ${ref.label ?? ref.type}`, () => linkSelected('each'))
    }
    for (const n of joinableLinks()) add('Link', `Add to link ${n}`, () => joinLink(n))
    if (sel.some((f) => isLinked(f!))) add('Link', 'Unlink', () => unlinkSelected())
    if (one)
      for (const n of linkNumbers(one.id, s.board?.frames ?? [])) {
        add('Link', `Select link ${n}`, () => selectLink(n))
        if (linkNumbers(one.id, s.board?.frames ?? []).length > 1) add('Link', `Leave link ${n}`, () => unlinkSelected(n))
      }
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
      add('Frame', 'Bring to front', () => stackSelected('front'), '⌘]')
      add('Frame', 'Send to back', () => stackSelected('back'), '⌘[')
      add('Frame', 'Delete', deleteSelected, '⌫')
    }

    add('Add', 'Image or video…', () => setState({ add: 'media' }))
    add('Add', 'Sound…', () => setState({ add: 'sound' }))
    if (s.recording) add('Add', 'Stop recording', () => stopRecording())
    else if ('getDisplayMedia' in (navigator.mediaDevices ?? {})) add('Add', 'Record sounds from a tab…', () => recordSounds())
    add('Add', 'Component (install command or code)…', () => setState({ add: 'code' }))
    add('Add', 'Link (Pinterest, Cosmos, Spotify, website)…', () => setState({ add: 'url' }))
    add('Add', sel.length ? 'Section around selection' : 'Section', () => addSection(), 'S')
    add('Add', 'Text', () => addText(), 'T')
    add('Add', 'Note', () => addNote())
    add('Add', sel.some((f) => hasColors(f!, true)) ? 'Palette from selection' : 'Palette', () => addPalette())
    add('Add', 'Color swatch', () => addSwatch('color'))
    add('Add', 'Font swatch', () => addSwatch('font'))

    add('Comments', s.commenting ? 'Stop commenting' : 'Comment', () => setCommenting(), 'C')
    add('Comments', s.pins ? 'Hide comments' : 'Show comments', () => togglePins(), '⇧C')
    if (s.board?.comments?.some((c) => c.resolved)) add('Comments', 'Delete resolved comments', clearResolved)
    if (s.commenting) {
      add('Comments', 'Next comment', () => stepComment(1), 'Tab')
      add('Comments', 'Previous comment', () => stepComment(-1), '⇧Tab')
    }

    add('Canvas', 'Fit to screen', fitBoard, '⌘0')
    add('Canvas', soundsOn() ? 'Turn control sounds off' : 'Turn control sounds on', () => setSounds(!soundsOn()))
    add('Canvas', 'Export spec (design.md, motion.md)', exportBoard)
    add('Canvas', 'Share as a page (one HTML file)', () => shareBoard())
    add('Canvas', 'New canvas…', ask({ placeholder: 'Canvas name', submit: (v) => createCanvas(v) }))
    add(
      'Canvas',
      'Rename canvas…',
      ask({ placeholder: 'Canvas name', initial: s.board?.name, submit: (v) => renameCanvas(v) }),
    )
    add('Canvas', 'Duplicate canvas', () => duplicateCanvas(s.boardName))
    if (!s.folder) add('Canvas', 'Open the example board', openSample)
    if (FOLDER_ONLY && folderSupported()) add('Folder', 'Open folder…', chooseFolder)
    for (const f of s.folders) if (f.id !== s.folderId && !f.missing) add('Folder', `Switch to ${f.name}`, () => switchFolder(f.id))
    if (s.folder) add('Folder', 'Use Claude with this folder', () => setState({ palette: false, onboarding: 'claude' }))
    add('Canvas', s.sidebar ? 'Hide sidebar' : 'Show sidebar', () => toggleSidebar(), '[')
    add('Help', 'Keyboard shortcuts', () => setState({ shortcuts: true }), '?')
    for (const f of s.board?.frames ?? []) if (f.type === 'section') add('Go to', f.label || 'Section', () => focusFrame(f.id))
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
