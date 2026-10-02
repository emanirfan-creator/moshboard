import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { looksLikeInstall } from '../../shared/install.ts'
import { addCode, addFrame, addFromRegistry, addLink, addPalette, addNote, addText, looksLikeCode, uploadFiles } from '../actions'
import { setState, useStore, viewportCenter, type AddKind } from '../store'
import { DEFAULT_FONT, fontStack, SWATCH_SIZE, swatchBox, swatchFont, type FontFamily } from '../../shared/fonts.ts'
import { hasColors } from '../boardColors'
import { loadFont, useFontList } from '../fonts'
import { suggestFonts, type FontSuggestion } from '../fontSuggest'
import { ColorPicker } from './ColorPicker'
import { FontPicker } from './FontPicker'
import { CloseIcon, CodeIcon, LinkIcon, MediaIcon, NoteIcon, SwatchIcon, TextIcon, TypeIcon } from './icons'

const OPTIONS: { kind: AddKind; title: string; hint: string; icon: ReactNode }[] = [
  { kind: 'media', title: 'Image or video', hint: 'Screenshots, clips, recordings', icon: <MediaIcon /> },
  { kind: 'code', title: 'Component', hint: 'Install command or pasted code', icon: <CodeIcon /> },
  { kind: 'url', title: 'Link', hint: 'Pinterest, Cosmos or any site', icon: <LinkIcon /> },
  { kind: 'text', title: 'Text', hint: 'Type on the canvas (T)', icon: <TextIcon /> },
  { kind: 'note', title: 'Note', hint: 'Intent, constraints, what to keep', icon: <NoteIcon /> },
  { kind: 'color', title: 'Color', hint: 'Palette or single swatch', icon: <SwatchIcon /> },
  { kind: 'font', title: 'Font', hint: 'Typeface sample', icon: <TypeIcon /> },
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
              onClick={() => (o.kind === 'text' ? (close(), addText()) : setState({ add: o.kind }))}
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
        Videos loop on the canvas. Mark a segment on one to measure its motion.
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
            You can also drop files or press <kbd>⌘V</kbd> straight onto the canvas.
          </>
        }
      >
        {null}
      </Footer>
    </>
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
        Paste an <b>install command</b> (<span className="mono">npx shadcn@latest add …</span>) to fetch the component
        with all its files, or paste a single React or HTML file.
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
                ? 'Install command, fetches all its files'
                : looksLikeCode(code)
                  ? `Looks like ${kind}`
                  : 'This doesn’t look like code'}
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
        <b>Pinterest</b>, <b>Cosmos</b>, <b>Muzli</b> and Are.na links, or direct .mp4/.jpg files, download as videos or
        images. Other sites stay live: double-click one to use it.
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
        Notes export to design.md. To attach one to a reference, select both and use ⌘K → Link.
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
    <div className="segmented" style={{ maxWidth: 260 }}>
      <button data-active={mode === 'palette' || undefined} onClick={() => onMode('palette')}>
        Palette
      </button>
      <button data-active={mode === 'single' || undefined} onClick={() => onMode('single')}>
        Single color
      </button>
    </div>
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
          ? 'The colors are picked from the references you’ve selected, so the palette matches them.'
          : from === 'board'
            ? 'The colors are picked from the images, videos and sites on this board, so the palette matches them.'
            : 'Your board has no images, videos or sites yet, so this starts from a fresh color scheme. Once it has some, new palettes match their colors.'}{' '}
        Lock the colors you like and <b>Generate</b> the rest. Exports as named tokens.
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
      <p>To make a palette later, select several swatches and use ⌘K → Combine.</p>
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
      <p>Any font installed on this Mac, or anything from Google Fonts.</p>
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
