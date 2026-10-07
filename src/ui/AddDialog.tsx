import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { looksLikeInstall } from '../../shared/install.ts'
import { addCode, addFrame, addFromRegistry, addLink, addPalette, addNote, addSection, addText, looksLikeCode, recordSounds, uploadFiles } from '../actions'
import { setState, useStore, viewportCenter, type AddKind } from '../store'
import { DEFAULT_FONT, fontStack, SWATCH_SIZE, swatchBox, swatchFont, type FontFamily } from '../../shared/fonts.ts'
import { hasColors } from '../boardColors'
import { loadFont, useFontList } from '../fonts'
import { suggestFonts, type FontSuggestion } from '../fontSuggest'
import { ColorPicker } from './ColorPicker'
import { FontPicker } from './FontPicker'
import { Segmented } from './Segmented'
import { CloseIcon, CodeIcon, LinkIcon, MediaIcon, SoundIcon, NoteIcon, SectionIcon, SwatchIcon, TextIcon, FontIcon } from './icons'

const OPTIONS: { kind: AddKind; title: string; hint: string; icon: ReactNode }[] = [
  { kind: 'media', title: 'Image or video', hint: 'Screenshots, clips, recordings', icon: <MediaIcon /> },
  { kind: 'sound', title: 'Sound', hint: 'A file, Spotify, or a tab’s sounds', icon: <SoundIcon /> },
  { kind: 'code', title: 'Component', hint: 'Install command or pasted code', icon: <CodeIcon /> },
  { kind: 'url', title: 'Link', hint: 'Pinterest, Cosmos or any site', icon: <LinkIcon /> },
  { kind: 'text', title: 'Text', hint: 'Type on the canvas (T)', icon: <TextIcon /> },
  { kind: 'note', title: 'Note', hint: 'Intent, constraints, what to keep', icon: <NoteIcon /> },
  { kind: 'section', title: 'Section', hint: 'Group blocks under a title (S)', icon: <SectionIcon /> },
  { kind: 'color', title: 'Color', hint: 'Palette or single swatch', icon: <SwatchIcon /> },
  { kind: 'font', title: 'Font', hint: 'Typeface sample', icon: <FontIcon /> },
]

const close = () => setState({ add: null })

export function AddDialog() {
  const kind = useStore((s) => s.add)
  if (!kind) return null
  return <Dialog kind={kind} />
}

function Dialog({ kind }: { kind: AddKind }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <div className="palette-scrim" onPointerDown={close} />
      <div className="dialog" role="dialog" aria-label="Add to canvas" onPaste={(e) => e.stopPropagation()}>
        <div className="dialog-nav">
          <div className="dialog-title">Add to canvas</div>
          {OPTIONS.map((o) => (
            <button
              key={o.kind}
              className="dialog-opt"
              data-active={o.kind === kind || undefined}
              // Text and sections go straight onto the canvas: nothing to fill in first.
              onClick={() =>
                o.kind === 'text' ? (close(), addText()) : o.kind === 'section' ? (close(), addSection()) : setState({ add: o.kind })
              }
            >
              {o.icon}
              <span>
                {o.title}
                <small>{o.hint}</small>
              </span>
            </button>
          ))}
        </div>
        <button className="icon-btn dialog-close" onClick={close} title="Close  Esc" aria-label="Close">
          <CloseIcon />
        </button>
        <div className="dialog-body">
          {kind === 'media' && <MediaForm />}
          {kind === 'sound' && <SoundForm />}
          {kind === 'code' && <CodeForm />}
          {kind === 'url' && <UrlForm />}
          {kind === 'note' && <NoteForm />}
          {kind === 'color' && <ColorForm />}
          {kind === 'font' && <FontForm />}
        </div>
      </div>
    </>
  )
}

function Footer({ tip, children }: { tip?: ReactNode; children: ReactNode }) {
  return (
    <div className="dialog-foot">
      <span className="dialog-tip">{tip}</span>
      <button className="btn" onClick={close}>
        Cancel
      </button>
      {children}
    </div>
  )
}

/** ⌘↵ submits from anywhere in a form. */
const submitKeys = (submit: () => void) => (e: React.KeyboardEvent) => {
  e.stopPropagation()
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    submit()
  }
}

function MediaForm() {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const take = (files: File[]) => {
    if (!files.length) return
    close()
    uploadFiles(files)
  }
  return (
    <>
      <h2>Image or video</h2>
      <p>
        Videos loop. Mark a segment to measure its motion.
      </p>
      <div
        className="dropzone"
        data-over={over || undefined}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          take([...e.dataTransfer.files])
        }}
      >
        <MediaIcon />
        <b>Drop files or click to browse</b>
        <span>PNG, JPG, GIF, WebP, MP4, MOV, WebM</span>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/*,video/*"
          hidden
          onChange={(e) => take([...(e.target.files ?? [])])}
        />
      </div>
      <Footer
        tip={
          <>
            Or drop or <kbd>⌘V</kbd> onto the canvas.
          </>
        }
      >
        {null}
      </Footer>
    </>
  )
}

/** A sound: drop a file, paste a Spotify or sound link, or record what a tab plays. */
function SoundForm() {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [url, setUrl] = useState('')
  const canRecord = 'getDisplayMedia' in (navigator.mediaDevices ?? {})
  const take = (files: File[]) => {
    if (!files.length) return
    close()
    uploadFiles(files)
  }
  const submit = () => {
    if (!url.trim()) return
    close()
    addLink(url.trim())
  }
  return (
    <div className="dialog-form" onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && submit())}>
      <h2>Sound</h2>
      <div
        className="dropzone"
        data-over={over || undefined}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          take([...e.dataTransfer.files])
        }}
      >
        <SoundIcon />
        <b>Drop a sound or click to browse</b>
        <span>MP3, WAV, M4A, OGG, FLAC</span>
        <input ref={input} type="file" multiple accept="audio/*" hidden onChange={(e) => take([...(e.target.files ?? [])])} />
      </div>
      <label>
        Or a link
        <input value={url} placeholder="https://open.spotify.com/track/… or a .mp3 link" onChange={(e) => setUrl(e.target.value)} />
      </label>
      <Footer
        tip={
          canRecord && (
            <button className="btn btn-ghost" onClick={() => (close(), recordSounds())} title="Pick a tab, use it, then Stop: each sound becomes a pad">
              Record from a tab
            </button>
          )
        }
      >
        <button className="btn btn-primary" disabled={!url.trim()} onClick={submit}>
          Add link <kbd>↵</kbd>
        </button>
      </Footer>
    </div>
  )
}

function CodeForm() {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const kind = /(^|\n)\s*(import|export)\s|className=/.test(code) || !/^\s*</.test(code) ? 'React' : 'HTML'
  const detected = /export\s+(?:default\s+)?(?:function|const)\s+([A-Z]\w*)/.exec(code)?.[1]
  const install = looksLikeInstall(code)
  const submit = async () => {
    if (!code.trim()) return
    close()
    if (install) await addFromRegistry(code)
    else await addCode(kind === 'React' ? 'tsx' : 'html', code, { label: name.trim() || detected || 'Component' })
  }
  return (
    <div className="dialog-form" onKeyDown={submitKeys(submit)}>
      <h2>Component</h2>
      <p>
        An <b>install command</b> (<span className="mono">npx shadcn@latest add …</span>) or one React or HTML file.
      </p>
      <label>
        Name
        <input value={name} placeholder={detected ?? 'e.g. Hover card'} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="grow">
        <span className="label-row">
          Code
          {code.trim() && (
            <small>
              {install
                ? 'Install command'
                : looksLikeCode(code)
                  ? `Looks like ${kind}`
                  : 'Not code'}
            </small>
          )}
        </span>
        <textarea
          autoFocus
          spellCheck={false}
          value={code}
          placeholder={'npx shadcn@latest add @aceternity/3d-globe-demo-3\n\nor paste the component code'}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      <Footer
        tip={
          <button className="link" onClick={() => (close(), addCode('tsx'))}>
            Start from a blank component
          </button>
        }
      >
        <button className="btn btn-primary" disabled={!code.trim()} onClick={submit}>
          {install ? 'Fetch component' : 'Add component'} <kbd>⌘↵</kbd>
        </button>
      </Footer>
    </div>
  )
}

function UrlForm() {
  const [url, setUrl] = useState('')
  const submit = () => {
    if (!url.trim()) return
    close()
    addLink(url.trim())
  }
  return (
    <div className="dialog-form" onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && submit())}>
      <h2>Add a link</h2>
      <p>
        <b>Pinterest</b>, <b>Cosmos</b>, <b>Muzli</b>, Are.na and media links download. <b>Spotify</b> plays in its own player. Other sites stay live.
      </p>
      <label>
        URL
        <input autoFocus value={url} placeholder="https://pin.it/… or https://linear.app" onChange={(e) => setUrl(e.target.value)} />
      </label>
      <Footer>
        <button className="btn btn-primary" disabled={!url.trim()} onClick={submit}>
          Add link <kbd>↵</kbd>
        </button>
      </Footer>
    </div>
  )
}

function NoteForm() {
  const [text, setText] = useState('')
  const submit = () => {
    close()
    addNote(undefined, text.trim() || '# Note')
  }
  return (
    <div className="dialog-form" onKeyDown={submitKeys(submit)}>
      <h2>Note</h2>
      <p>
        Goes into design.md. Link it to a reference with ⌘K → Link.
      </p>
      <label className="grow">
        Text
        <textarea
          autoFocus
          value={text}
          placeholder={'# Feel\nQuick and quiet, nothing bounces.'}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <Footer>
        <button className="btn btn-primary" onClick={submit}>
          Add note <kbd>⌘↵</kbd>
        </button>
      </Footer>
    </div>
  )
}

function ColorForm() {
  const [mode, setMode] = useState<'palette' | 'single'>('palette')
  return mode === 'palette' ? <PaletteForm onMode={setMode} /> : <SingleColorForm onMode={setMode} />
}

function ModeSwitch({ mode, onMode }: { mode: 'palette' | 'single'; onMode: (m: 'palette' | 'single') => void }) {
  return (
    <Segmented
      options={[
        { id: 'palette', label: 'Palette' },
        { id: 'single', label: 'Single color' },
      ]}
      value={mode}
      onChange={onMode}
      remember="add-color-mode"
      style={{ maxWidth: 260 }}
    />
  )
}

function PaletteForm({ onMode }: { onMode: (m: 'palette' | 'single') => void }) {
  // Same rule as the palette itself: the selected references if any have colors, else the whole board.
  const from = useStore((s) => {
    const frames = s.board?.frames ?? []
    if (frames.some((f) => s.selected.includes(f.id) && hasColors(f, true))) return 'selection'
    return frames.some((f) => hasColors(f, false)) ? 'board' : 'none'
  })
  const submit = () => {
    close()
    addPalette(undefined, undefined, 'Palette')
  }
  return (
    <div className="dialog-form" onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && submit())}>
      <h2>Color</h2>
      <ModeSwitch mode="palette" onMode={onMode} />
      <p>
        {from === 'selection'
          ? 'From your selected references.'
          : from === 'board'
            ? 'From this board’s references.'
            : 'A fresh scheme. Add references and it matches them.'}{' '}
        Lock what you like, <b>Generate</b> the rest.
      </p>
      <Footer>
        <button autoFocus className="btn btn-primary" onClick={submit}>
          Add palette <kbd>↵</kbd>
        </button>
      </Footer>
    </div>
  )
}

function SingleColorForm({ onMode }: { onMode: (m: 'palette' | 'single') => void }) {
  const [color, setColor] = useState('#d0d6e0')
  const [name, setName] = useState('')
  const submit = () => {
    close()
    const at = viewportCenter()
    addFrame({
      type: 'swatch',
      color,
      label: name.trim() || color,
      x: Math.round(at.x - 60),
      y: Math.round(at.y - 60),
      w: 120,
      h: 120,
    })
  }
  return (
    <div className="dialog-form" onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && submit())}>
      <h2>Color</h2>
      <ModeSwitch mode="single" onMode={onMode} />
      <p>To make a palette, select swatches and ⌘K → Combine.</p>
      <div className="color-form">
        <ColorPicker value={color} onChange={setColor} />
        <label>
          Name
          <input autoFocus value={name} placeholder="e.g. Accent" onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <Footer>
        <button className="btn btn-primary" onClick={submit}>
          Add color <kbd>↵</kbd>
        </button>
      </Footer>
    </div>
  )
}

function FontForm() {
  const [font, setFont] = useState<FontFamily>(DEFAULT_FONT)
  const [name, setName] = useState('')
  const [suggested, setSuggested] = useState<FontSuggestion[]>([])
  const picked = useRef(false)
  const fonts = useFontList()
  useEffect(() => loadFont(font.href), [font])
  // Start on the font that best matches the board, unless one was already picked by hand.
  useEffect(() => {
    if (!fonts) return
    let live = true
    suggestFonts(fonts).then((s) => {
      if (!live) return
      setSuggested(s)
      if (s[0] && !picked.current) setFont(s[0].font)
    })
    return () => void (live = false)
  }, [fonts])
  const suggestedFonts = useMemo(() => suggested.map((s) => s.font), [suggested])
  const pick = (f: FontFamily) => {
    picked.current = true
    setFont(f)
  }
  const submit = () => {
    close()
    const at = viewportCenter()
    const box = swatchBox(SWATCH_SIZE, font.family)
    // A suggested family comes in at the weight the board uses it at.
    const weight = suggested.find((s) => s.font.family === font.family && s.font.source === font.source)?.weight
    addFrame({
      type: 'swatch',
      ...swatchFont(font),
      weight: weight && weight !== 400 ? weight : undefined,
      label: name.trim() || 'Font',
      x: Math.round(at.x - box.w / 2),
      y: Math.round(at.y - box.h / 2),
      ...box,
    })
  }
  return (
    <div className="dialog-form" onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && submit())}>
      <h2>Font</h2>
      <p>Installed on this Mac or from Google Fonts.</p>
      <div className="font-pick-row">
        <FontPicker autoFocus value={font} onPick={pick} suggested={suggestedFonts} suggestedLabel="Matches your references" />
        <div className="font-preview" style={{ fontFamily: fontStack(font.family, font.category) }}>
          {font.family}
          <small>{font.source === 'google' ? 'Google Fonts' : 'On this Mac'}</small>
        </div>
      </div>
      <label>
        Role
        <input value={name} placeholder="e.g. Headings" onChange={(e) => setName(e.target.value)} />
      </label>
      <Footer>
        <button className="btn btn-primary" onClick={submit}>
          Add font <kbd>↵</kbd>
        </button>
      </Footer>
    </div>
  )
}
