import type { SVGProps } from 'react'

// 16px line icons, 1.5 stroke, currentColor.
const Icon = ({ children, ...p }: SVGProps<SVGSVGElement>) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    {...p}
  >
    {children}
  </svg>
)

export const PlusIcon = () => (
  <Icon>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
)
export const MinusIcon = () => (
  <Icon>
    <path d="M3.5 8h9" />
  </Icon>
)
export const MediaIcon = () => (
  <Icon>
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
    <path d="m2.5 11 3-3 2.5 2.5L10 8.5l3.5 3.5" />
    <circle cx="10.5" cy="6" r="1" />
  </Icon>
)
export const SoundIcon = () => (
  <Icon>
    <path d="M3 7v2M5.5 5v6M8 2.5v11M10.5 5v6M13 7v2" />
  </Icon>
)
export const CodeIcon = () => (
  <Icon>
    <path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
  </Icon>
)
export const GlobeIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M2.5 8h11M8 2.5c1.6 1.6 2.3 3.4 2.3 5.5S9.6 11.9 8 13.5C6.4 11.9 5.7 10.1 5.7 8S6.4 4.1 8 2.5Z" />
  </Icon>
)
export const LinkIcon = () => (
  <Icon>
    <path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.1-2.1a2.6 2.6 0 0 0-3.7-3.7l-.8.8" />
    <path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.4 8.9a2.6 2.6 0 0 0 3.7 3.7l.8-.8" />
  </Icon>
)
export const NoteIcon = () => (
  <Icon>
    <path d="M3.5 2.5h9v11h-9zM5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
  </Icon>
)
export const SectionIcon = () => (
  <Icon>
    <path d="M2.5 3h4" />
    <rect x="2.5" y="5.5" width="11" height="8" rx="1.5" />
  </Icon>
)
export const CaretIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m2.5 4 2.5 2.5L7.5 4" />
  </svg>
)
export const SwatchIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 2.5v11" />
  </Icon>
)
/** "Aa": a typeface, kept apart from the Text tool's T. */
export const FontIcon = () => (
  <Icon>
    <path d="M2 12.5 5.25 3.5l3.25 9M3.2 9.5h4.1" />
    <circle cx="11.5" cy="10.25" r="2.25" />
    <path d="M13.75 7.5v5" />
  </Icon>
)
/** `open`: the sidebar is showing (the button hides it), so the side column is filled and the arrow points in. */
export const SidebarIcon = ({ open }: { open?: boolean }) => (
  <Icon>
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
    <path d="M6.5 3v10" />
    {open && <path d="M6.5 3H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13h2.5z" fill="currentColor" />}
    <path d={open ? 'M10.75 6.25 9 8l1.75 1.75' : 'M9.25 6.25 11 8l-1.75 1.75'} />
  </Icon>
)
export const ExportIcon = () => (
  <Icon>
    <path d="M8 2.5v7M5 5.5l3-3 3 3M3.5 9.5v3h9v-3" />
  </Icon>
)
export const MoreIcon = () => (
  <Icon>
    <circle cx="4" cy="8" r=".6" fill="currentColor" />
    <circle cx="8" cy="8" r=".6" fill="currentColor" />
    <circle cx="12" cy="8" r=".6" fill="currentColor" />
  </Icon>
)
export const CanvasIcon = () => (
  <Icon>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="2.5" width="4.5" height="7" rx="1" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
  </Icon>
)
/** An easing curve: saved animations. */
export const CurveIcon = () => (
  <Icon>
    <path d="M2 13C5 13 6 3 14 3" />
  </Icon>
)

export const KeyboardIcon = () => (
  <Icon>
    <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
    <path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M5 9.5h6" />
  </Icon>
)
export const TextIcon = () => (
  <Icon>
    <path d="M3 4V3h10v1M8 3v10M6.5 13h3" />
    <path d="M11.5 9.5h3M13 9.5v3.5" opacity=".6" />
  </Icon>
)
export const ChevronIcon = () => (
  <Icon>
    <path d="m6 4.5 3.5 3.5L6 11.5" />
  </Icon>
)
export const CloseIcon = () => (
  <Icon>
    <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
  </Icon>
)
export const PointerIcon = () => (
  <Icon>
    <path d="M3.5 2.5 12.5 7 8.5 8.5 7 12.5Z" />
  </Icon>
)
export const CommandIcon = () => (
  <Icon>
    <path d="M6 6V4.5a1.5 1.5 0 1 0-1.5 1.5H6Zm0 0h4m-4 0v4m4-4V4.5A1.5 1.5 0 1 1 11.5 6H10Zm0 0v4m0 0h1.5a1.5 1.5 0 1 1-1.5 1.5V10Zm0 0H6m0 0v1.5A1.5 1.5 0 1 1 4.5 10H6Z" />
  </Icon>
)
/** App mark: a dial with a pointer, the detent idea behind Moshboard's tuning controls. */
export const HandIcon = () => (
  <Icon>
    <path d="M5.5 8V3.8a1 1 0 0 1 2 0V7.5M7.5 7V3a1 1 0 0 1 2 0v4M9.5 7.2V3.8a1 1 0 0 1 2 0V8.5M11.5 6.5a1 1 0 0 1 2 0V10a4 4 0 0 1-4 4H9a4 4 0 0 1-3.2-1.6L3.2 9a1 1 0 0 1 1.5-1.3L5.5 8.6" />
  </Icon>
)
export const FolderIcon = () => (
  <Icon>
    <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
  </Icon>
)
export const CheckIcon = () => (
  <Icon>
    <path d="m3.5 8.5 3 3 6-7" />
  </Icon>
)
export const CommentIcon = () => (
  <Icon>
    <path d="M8 2.75c3.04 0 5.5 2.13 5.5 4.75S11.04 12.25 8 12.25c-.6 0-1.17-.08-1.7-.23L3 13.25l.86-2.58C3.02 9.84 2.5 8.72 2.5 7.5c0-2.62 2.46-4.75 5.5-4.75Z" />
  </Icon>
)
export const ReopenIcon = () => (
  <Icon>
    <path d="M4.5 6.5h5.25a3 3 0 0 1 0 6H7M4.5 6.5 7 4M4.5 6.5 7 9" />
  </Icon>
)
export const TrashIcon = () => (
  <Icon>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Icon>
)
export const SendIcon = () => (
  <Icon>
    <path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" />
  </Icon>
)
export const CopyIcon = () => (
  <Icon>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
  </Icon>
)
