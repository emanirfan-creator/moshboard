import { useEffect, useState } from 'react'
import { RecordingBar } from './frames/RecordingBar'
import {
  copySelection,
  pasteFrames,
  readClip,
  addNote,
  addSection,
  addText,
  deleteSelected,
  duplicateSelected,
  fitBoard,
  loadBoard,
  refreshCanvases,
  openSample,
  loadFile,
  lockParams,
  markSegment,
  pasteText,
  replay,
  uploadFiles,
} from './actions'
import { Canvas } from './canvas/Canvas'
import { CommandPalette } from './palette/CommandPalette'
import { frameById, getState, redo, setState, SIDEBAR_W, sidebarShown, toast, togglePins, toggleSidebar, undo, useStore } from './store'
import { arrangeAgain, canCrop, moveTile, startCrop } from './arrange'
import { jumpAlongLinks, jumpBack } from './canvas/follow'
import { Inspector } from './tuning/Inspector'
import { AddDialog } from './ui/AddDialog'
import { Chrome, Shortcuts } from './ui/Chrome'
import { ExportDialog } from './ui/ExportDialog'
import { CapturePicker } from './ui/CapturePicker'
import { Sidebar } from './ui/Sidebar'
import { FOLDER_ONLY, onFolderChange, startFolder } from './folder/folder'
import { ClaudeTask } from './folder/ClaudeTask'
import { Onboarding } from './folder/Onboarding'
import { Loader } from './ui/Loader'
import { CompareBar } from './ui/CompareBar'
import { exitCompare, startCompare } from './canvas/compare'
import { setCommenting, stepComment } from './comments/comments'

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

function useHotkeys() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const s = getState()
      // ⌘S / Ctrl+S saves tuned values to the code, even from a text field, and never opens the browser's Save dialog.
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (s.selected.length === 1 && s.overrides[s.selected[0]]) lockParams()
        return
      }
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setState({ palette: !s.palette })
        return
      }
      if (s.palette || s.add || s.shortcuts || s.exported || s.picking || isTyping(e.target)) return
      // ⌘Z / ⌘⇧Z (and ⌘Y) for the canvas; text fields keep their own undo.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
        e.preventDefault()
        const ok = e.shiftKey || e.key === 'y' ? redo() : undo()
        if (!ok) toast(e.shiftKey || e.key === 'y' ? 'Nothing to redo' : 'Nothing to undo')
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (e.key === ' ') {
        e.preventDefault()
        if (!s.space) setState({ space: true })
      } else if (e.key === 'Escape') {
        if (s.regionPick) setState({ regionPick: null })
        else if (s.thread || s.draft) setState({ thread: null, draft: null })
        else if (s.commenting) setCommenting(false)
        else if (s.crop) setState({ crop: null })
        else if (s.interact) setState({ interact: null })
        else if (s.selected.length) setState({ selected: [] })
        else exitCompare()
      }
      else if (mod && e.key === '0') {
        e.preventDefault()
        fitBoard()
      } else if (mod && e.key === 'd') {
        e.preventDefault()
        duplicateSelected()
      } else if (e.ctrlKey && e.altKey && e.code === 'KeyT') {
        e.preventDefault()
        arrangeAgain()
      } else if (mod && (e.key === 'c' || e.key === 'x') && s.selected.length && !window.getSelection()?.toString()) {
        e.preventDefault()
        copySelection(e.key === 'x')
      } else if (mod && e.key === 'a') {
        e.preventDefault()
        // A selected text block or note: edit it and select all of its text, not every frame.
        const only = s.selected.length === 1 ? s.board?.frames.find((f) => f.id === s.selected[0]) : undefined
        if (only && (only.type === 'text' || only.type === 'note')) {
          setState({ interact: only.id, selectAllIn: only.id })
        } else setState({ selected: s.board?.frames.map((f) => f.id) ?? [] })
      } else if (mod) return
      else if (e.key === 'Backspace' || e.key === 'Delete') deleteSelected()
      else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        jumpBack()
      } else if (e.code === 'KeyL') jumpAlongLinks()
      else if (e.key === 'Tab' && s.commenting) {
        e.preventDefault()
        stepComment(e.shiftKey ? -1 : 1)
      } else if (e.key.startsWith('Arrow') && !s.crop) {
        // A block in a layout trades places with its neighbor.
        const dir = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const)[e.key as 'ArrowLeft']
        if (dir && moveTile(dir)) e.preventDefault()
      } else if (e.key === 'Enter' && s.selected.length === 1 && canCrop(frameById(s.selected[0]))) {
        e.preventDefault()
        startCrop(s.selected[0])
      }
      else if (e.key === 'r') replay()
      else if (e.key === 'i') markSegment('in')
      else if (e.key === 'o') markSegment('out')
      else if (e.key === 'v') {
        setCommenting(false)
        setState({ interact: null, hand: false })
      } else if (e.key === 'h') {
        setCommenting(false)
        setState({ hand: !s.hand })
      }
      else if (e.key === 'a') setState({ add: 'media' })
      else if (e.key === 'n') {
        // Without this the key also lands in the new note's focused editor.
        e.preventDefault()
        addNote()
      }
      else if (e.code === 'KeyC') (e.shiftKey ? togglePins() : setCommenting())
      else if (e.key === 'x') (s.compare ? exitCompare() : startCompare())
      else if (e.key === 's') {
        e.preventDefault()
        addSection()
      } else if (e.key === 't') {
        e.preventDefault()
        addText()
      } else if (e.key === '[') toggleSidebar()
      else if (e.key === '?') setState({ shortcuts: true })
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setState({ space: false })
    }
    const blur = () => setState({ space: false })
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
}

function usePaste() {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const st = getState()
      if (st.palette || st.add || st.picking || isTyping(e.target) || !e.clipboardData) return
      const files = [...e.clipboardData.files]
      const text = e.clipboardData.getData('text/plain')
      e.preventDefault()
      const frames = readClip(text)
      if (frames) pasteFrames(frames)
      else if (files.length) uploadFiles(files)
      else if (text.trim()) pasteText(text)
      else pasteFrames() // clipboard unavailable: use what was copied in this tab
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
}

/** Claude Code (or anyone) editing board files on disk shows up live. */
function useLiveFiles() {
  useEffect(() => {
    const on = ({ board, file }: { board: string; file: string }) => {
      const s = getState()
      // Any canvas's name can change on disk, so the sidebar list follows board.json edits.
      if (file === 'board.json') refreshCanvases()
      if (board !== s.boardName) return
      if (file === 'board.json') loadBoard(board)
      else if (file in s.files) loadFile(file)
    }
    // A connected folder reports its own changes; the local server sends them over Vite's socket.
    const offFolder = onFolderChange(on)
    const hot = import.meta.hot
    const onHot = (c: { board: string; file: string }) => !FOLDER_ONLY && on(c)
    hot?.on('mb:change', onHot)
    return () => {
      offFolder()
      hot?.off?.('mb:change', onHot)
    }
  }, [])
}

export function App() {
  // A block still on its way (a link downloading, a clip copying in) counts: the canvas isn't empty anymore.
  const empty = useStore((s) => s.board !== null && s.board.frames.length === 0 && s.pending.length === 0)
  const toast = useStore((s) => s.toast)
  // Center in the visible canvas, not the window (the sidebar covers the left).
  const emptyLeft = useStore((s) => (sidebarShown(s) ? SIDEBAR_W : 0))
  const inFolder = useStore((s) => !!s.folder)
  // Opening the first board (or finding the folder) takes a moment: the loader covers it if it's a real wait.
  const waiting = useStore((s) => s.board === null && s.onboarding === null)
  const hasBoard = useStore((s) => s.board !== null)
  // The board fades in when it first arrives, instead of popping in.
  const [boardIn, setBoardIn] = useState(false)
  useEffect(() => {
    if (!hasBoard) return
    setBoardIn(true)
    const t = setTimeout(() => setBoardIn(false), 400)
    return () => clearTimeout(t)
  }, [hasBoard])

  useEffect(() => {
    startFolder().then((ready) => {
      if (ready) loadBoard(decodeURIComponent(location.hash.slice(1)) || 'default')
    })
    const onHash = () => {
      const name = decodeURIComponent(location.hash.slice(1))
      if (name && name !== getState().boardName) loadBoard(name)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useHotkeys()
  usePaste()
  useLiveFiles()

  return (
    <>
      <div className="board-layer" data-in={boardIn || undefined}>
        <Canvas />
      </div>
      {waiting && <Loader />}
      {empty && (
        <div className="empty" style={{ left: emptyLeft }}>
          <div>
            <b>This canvas is empty</b>
            <p>Collect screenshots, clips, live sites and components.</p>
            <button className="btn btn-primary" onClick={() => setState({ add: 'media' })}>
              Add to canvas <kbd>A</kbd>
            </button>
            <p className="empty-tip">
              Or paste (<kbd>⌘V</kbd>) or drop anything here.
            </p>
            {!inFolder && (
              <button className="btn btn-ghost empty-sample" onClick={openSample}>
                See an example board
              </button>
            )}
          </div>
        </div>
      )}
      <Inspector />
      <CompareBar />
      <Chrome />
      <Sidebar />
      <CommandPalette />
      <AddDialog />
      <Shortcuts />
      <ExportDialog />
      <CapturePicker />
      <Onboarding />
      <ClaudeTask />
      <RecordingBar />
      {toast && (
        <div className="toast" data-error={toast.error || undefined}>
          {toast.text}
        </div>
      )}
    </>
  )
}
