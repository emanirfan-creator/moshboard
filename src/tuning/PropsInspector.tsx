import { useMemo, useState } from 'react'
import type { Param } from '../../shared/params.ts'
import { colorFromCss, colorToCss, detectProps, PROP_PREFIX, sections, type PropDef } from '../../shared/props.ts'
import type { Frame } from '../../shared/types.ts'
import { setParam } from '../actions'
import { useStore } from '../store'
import { ChevronIcon } from '../ui/icons'
import { ChoiceCtl, ColorCtl, NumberCtl, TextCtl, ToggleCtl } from './controls'
import { parseModules } from './detection'

const EMPTY = {}
/** Past this many settings the panel gets a filter, and only the first sections start open. */
const MANY = 12
/** Sections the user opened or closed, per frame, for this session. */
const folded = new Map<string, boolean>()

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The component's own props from its code, as labeled controls in sections. */
export function useComponentProps(frame: Frame): PropDef[] {
  const source = useStore((s) => (frame.file ? s.files[frame.file] : undefined))
  const modulesRaw = useStore((s) => (frame.modules ? s.files[frame.modules] : undefined))
  return useMemo(
    () => (source && frame.file?.endsWith('.tsx') ? detectProps(source, parseModules(modulesRaw)) : []),
    [source, modulesRaw, frame.file],
  )
}

export function PropsSections({ frame, props }: { frame: Frame; props: PropDef[] }) {
  const overrides = useStore((s) => s.overrides[frame.id] ?? EMPTY) as Record<string, unknown>
  const [query, setQuery] = useState('')
  const [, refold] = useState(0)
  const many = props.length > MANY

  // What the component shows now: an unsaved tweak, else the saved value, else its own default.
  const valueOf = (p: PropDef) => {
    const k = PROP_PREFIX + p.name
    if (k in overrides) return overrides[k]
    if (frame.props && p.name in frame.props) return frame.props[p.name]
    return p.value
  }
  const changed = (p: PropDef) => !same(valueOf(p), p.value)
  const set = (p: PropDef, v: unknown) => setParam(frame.id, PROP_PREFIX + p.name, v as never)

  const q = query.trim().toLowerCase()
  const shown = q
    ? props.filter((p) => `${p.label} ${p.group} ${p.help ?? ''} ${p.name}`.toLowerCase().includes(q))
    : props
  const groups = sections(shown)

  return (
    <>
      {many && (
        <div className="props-filter">
          <input
            value={query}
            placeholder={`Filter ${props.length} settings`}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') setQuery('')
            }}
          />
        </div>
      )}
      {groups.map((g, i) => {
        const key = `${frame.id}:${g.title}`
        const open = q ? true : (folded.get(key) ?? (!many || i < 2))
        const edited = g.props.filter(changed)
        return (
          <PropSection
            key={g.title}
            title={g.title}
            count={g.props.length}
            edited={edited.length}
            open={open}
            onToggle={() => {
              folded.set(key, !open)
              refold((n) => n + 1)
            }}
            onReset={() => edited.forEach((p) => set(p, p.value))}
          >
            {g.props.map((p) => (
              <PropControl key={p.name} p={p} value={valueOf(p)} modified={changed(p)} onChange={(v) => set(p, v)} />
            ))}
          </PropSection>
        )
      })}
      {q && !groups.length && (
        <section className="insp-section">
          <p className="ctl-help">No match for “{query.trim()}”.</p>
        </section>
      )}
    </>
  )
}

function PropSection({
  title,
  count,
  edited,
  open,
  onToggle,
  onReset,
  children,
}: {
  title: string
  count: number
  edited: number
  open: boolean
  onToggle: () => void
  onReset: () => void
  children: React.ReactNode
}) {
  return (
    <section className="insp-section prop-section" data-open={open || undefined}>
      <header className="prop-head">
        <button className="prop-toggle" aria-expanded={open} onClick={onToggle}>
          <ChevronIcon />
          <h3>{title}</h3>
          <span className="prop-count">{edited ? `${edited} changed` : count}</span>
        </button>
        {edited > 0 && (
          <button className="prop-reset" onClick={onReset} title="Back to defaults">
            Reset
          </button>
        )}
      </header>
      {open && <div className="insp-stack">{children}</div>}
    </section>
  )
}

function PropControl({
  p,
  value,
  modified,
  onChange,
}: {
  p: PropDef
  value: unknown
  modified: boolean
  onChange: (v: unknown) => void
}) {
  const control = (() => {
    switch (p.kind) {
      case 'number': {
        const param: Param = {
          name: p.name,
          label: p.label,
          kind: 'number',
          value: p.value as number,
          unit: '',
          min: p.min,
          max: p.max,
          step: p.step,
          soft: true,
          start: 0,
          end: 0,
        }
        return <NumberCtl p={param} value={value as number} modified={modified} onChange={onChange} />
      }
      case 'boolean':
        return <ToggleCtl name={p.label} value={!!value} modified={modified} onChange={onChange} />
      case 'choice':
        return (
          <ChoiceCtl
            name={p.label}
            options={p.options!}
            value={value === undefined ? undefined : String(value)}
            modified={modified}
            onChange={(o) => onChange(p.numeric ? Number(o) : o)}
          />
        )
      case 'text':
        return <TextCtl name={p.label} value={String(value ?? '')} modified={modified} onChange={onChange} />
      case 'color': {
        const param = { name: p.name, label: p.label } as Param
        return <ColorCtl p={param} value={colorToCss(p, value)} onChange={(css) => onChange(colorFromCss(p, css, value))} />
      }
    }
  })()
  return (
    <div className="prop" data-mod={modified || undefined}>
      {control}
      {p.help && <p className="ctl-help prop-help">{p.help}</p>}
    </div>
  )
}
