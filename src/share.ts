// "Share as a page": the whole canvas as one self-contained HTML file a stakeholder can
// open without Moshboard. Images, clips and snapshots are inlined; components keep
// running (the same sandbox document the canvas uses, with their saved values); sites
// that allow it stay live. It pans and zooms like the canvas, and is read-only.

import { cssVars, defaults, parseParams, runtimeValues } from '../shared/params.ts'
import { fontStack } from '../shared/fonts.ts'
import { presetFor } from '../shared/providers.ts'
import type { BoardComment, Frame } from '../shared/types.ts'
import { pinAt, placed } from './comments/comments'
import { api, mediaUrl } from './api'
import { boardLabel } from './folder/folder'
import { BLOCK_HEAD, BLOCK_PAD, isBlock } from './canvas/blocks'
import { bySize, isSection } from '../shared/sections.ts'
import { buildSrcdoc, loadCompiler } from './frames/sandbox'
import { getState, toast } from './store'
import { parseModules } from './tuning/detection'
import { cue } from './ui/sound'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

async function dataUrl(url: string) {
  const blob = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.blob()
  })
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Notes are short markdown: bold, italic, inline code, lists and paragraphs are enough. */
function markdown(text: string) {
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
  return text
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n')
      if (lines.every((l) => /^\s*(\d+\.|[-*])\s+/.test(l))) {
        const tag = /^\s*\d+\./.test(lines[0]) ? 'ol' : 'ul'
        return `<${tag}>${lines.map((l) => `<li>${inline(l.replace(/^\s*(\d+\.|[-*])\s+/, ''))}</li>`).join('')}</${tag}>`
      }
      return `<p>${lines.map(inline).join('<br>')}</p>`
    })
    .join('')
}

async function codeDoc(f: Frame, board: string) {
  const read = (rel?: string) => (rel ? (getState().files[rel] ?? api.file(board, rel)) : undefined)
  const source = await read(f.file)
  if (!source) return null
  const modules = parseModules(await read(f.modules))
  const wrapper = f.wrapper ? await read(f.wrapper) : presetFor([source, ...Object.values(modules)])?.code
  const params = parseParams(source)
  const values = defaults(params)
  const tw = await api.tailwind([source, ...Object.values(modules), wrapper ?? '']).catch(() => undefined)
  const kind = f.file!.endsWith('.html') ? 'html' : 'tsx'
  await loadCompiler()
  return buildSrcdoc(kind, source, cssVars(params, values), runtimeValues(params, values), modules, tw, wrapper, f.props ?? {})
}

/** The inner content of one frame, sized to `w`×`h`. */
async function content(f: Frame, board: string, w: number, h: number): Promise<string> {
  const media = (rel: string, width?: number) => dataUrl(mediaUrl(board, rel) + (width ? `?w=${width}` : ''))
  // A logical width (e.g. 1280 for a site) scaled down to fit the frame, like on the canvas.
  const scaled = (inner: string) => {
    const vw = f.viewport ?? w
    const k = w / vw
    return `<div class="scaled" style="width:${vw}px;height:${h / k}px;transform:scale(${k})">${inner}</div>`
  }
  switch (f.type) {
    case 'image':
      return f.src ? `<img src="${await media(f.src, 1600)}" alt="${esc(f.label ?? '')}">` : ''
    case 'video':
      return f.src ? `<video src="${await media(f.src)}" autoplay muted loop playsinline></video>` : ''
    case 'url': {
      if (f.embed === 'blocked' && f.snapshot) return `<img class="top" src="${await media(f.snapshot, 1600)}" alt="${esc(f.label ?? '')}">`
      return scaled(`<iframe src="${esc(f.src ?? '')}" loading="lazy" referrerpolicy="no-referrer"></iframe>`)
    }
    case 'code': {
      const doc = await codeDoc(f, board).catch(() => null)
      return doc ? scaled(`<iframe sandbox="allow-scripts" loading="lazy" srcdoc="${esc(doc)}"></iframe>`) : ''
    }
    case 'note':
      return `<div class="note-body">${markdown(f.text ?? '')}</div>`
    case 'text': {
      const family = f.font ? fontStack(f.font, f.fontCategory) : 'inherit'
      return `<div class="text" style="font-size:${f.size ?? 24}px;font-family:${esc(family)};font-weight:${f.weight ?? ((f.size ?? 24) >= 32 ? 600 : 400)};${f.italic ? 'font-style:italic;' : ''}">${esc(f.text ?? '')}</div>`
    }
    case 'swatch':
      if (f.font) {
        return `<div class="font" style="font-family:${esc(fontStack(f.font, f.fontCategory))};font-weight:${f.weight ?? 400};${f.italic ? 'font-style:italic;' : ''}"><span style="font-size:${f.size ?? 40}px">${esc(f.font)}</span><small>${esc(f.label ?? '')}</small></div>`
      }
      return `<div class="swatch" style="background:${esc(f.color ?? '#888')}"><span>${esc(f.label ?? f.color ?? '')}</span></div>`
    case 'section':
      return ''
    case 'palette':
      return `<div class="palette">${(f.colors ?? []).map((c) => `<div style="background:${esc(c.hex)}"><span>${esc(c.hex)}</span></div>`).join('')}</div>`
  }
}

async function frameHtml(f: Frame, board: string) {
  if (f.type === 'section') {
    const desc = f.text ? `<span class="desc">${esc(f.text)}</span>` : ''
    return `<div class="frame section" style="left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px"><header><b>${esc(f.label || 'Section')}</b>${desc}</header></div>`
  }
  const block = isBlock(f)
  const inner = block ? { w: f.w - BLOCK_PAD * 2, h: f.h - BLOCK_HEAD - BLOCK_PAD } : { w: f.w, h: f.h }
  let body = ''
  try {
    body = await content(f, board, inner.w, inner.h)
  } catch {
    body = '<div class="missing">Couldn’t include this</div>'
  }
  const style = `left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px`
  if (!block) return `<div class="frame ${f.type}" style="${style}">${body}</div>`
  const kind = { code: 'Component', url: 'Website', image: 'Image', video: 'Video', palette: 'Palette' }[f.type as string] ?? ''
  const link = f.type === 'url' && f.src ? `<a href="${esc(f.src)}" target="_blank" rel="noreferrer">Open ↗</a>` : ''
  return `<div class="frame block" style="${style}"><header><span class="dot"></span><span class="title">${esc(f.label || kind)}</span>${link}<span class="kind">${kind}</span></header><div class="body">${body}</div></div>`
}

/** Open comments as keycap pins; hovering one shows its thread. */
function commentsHtml(comments: BoardComment[], frames: Frame[]) {
  return comments
    .map((c) => {
      const at = pinAt(c, frames)
      if (!at) return ''
      const msgs = c.messages.map((m) => `<p>${esc(m.text)}</p>`).join('')
      return `<div class="pin" style="left:${at.x}px;top:${at.y}px"><span class="key">${String(c.n).padStart(2, '0')}</span><div class="thread">${msgs}</div></div>`
    })
    .join('\n')
}

function page(title: string, frames: string[], fontLinks: string[], bounds: { x0: number; y0: number; x1: number; y1: number }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">
${fontLinks.map((h) => `<link rel="stylesheet" href="${esc(h)}">`).join('\n')}
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; background: #0f1012; color: #d0d6e0; font: 13px/1.45 Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
#view { position: fixed; inset: 0; cursor: grab; touch-action: none; }
#view.drag { cursor: grabbing; }
#world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.frame { position: absolute; }
.section { border: 1px solid rgba(255,255,255,.06); border-radius: 28px; background: rgba(0,0,0,.24); box-shadow: inset 0 1px 12px rgba(0,0,0,.25); }
.section header { position: absolute; left: 4px; bottom: 100%; padding-bottom: 10px; display: flex; gap: 8px; align-items: baseline; white-space: nowrap; font-size: 15px; }
.section header b { color: #f7f8f8; font-weight: 600; }
.section header .desc { color: #8a8f98; font-size: 13px; }
.block { background: #151618; border: 1px solid rgba(255,255,255,.06); border-radius: 18px; }
.block header { position: absolute; left: 0; right: 0; top: 0; height: ${BLOCK_HEAD}px; display: flex; align-items: center; gap: 10px; padding: 0 16px; font-size: 13px; }
.block .dot { width: 7px; height: 7px; border-radius: 50%; background: #d0d6e0; flex: none; }
.block .title { color: #f7f8f8; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.block .kind { margin-left: auto; color: #62666d; font-size: 12px; flex: none; }
.block header a { color: #8a8f98; font-size: 12px; text-decoration: none; flex: none; }
.block header a:hover { color: #f7f8f8; }
.block .body { position: absolute; left: ${BLOCK_PAD}px; right: ${BLOCK_PAD}px; top: ${BLOCK_HEAD}px; bottom: ${BLOCK_PAD}px; overflow: hidden; border-radius: 12px; background: #1b1c1f; }
.body img, .body video { width: 100%; height: 100%; object-fit: cover; display: block; }
.body img.top { object-position: top; }
.scaled { transform-origin: 0 0; }
.scaled iframe { width: 100%; height: 100%; border: 0; display: block; background: #1b1c1f; }
.note-body { height: 100%; padding: 14px 16px; overflow: auto; background: #1b1c1f; border-radius: 12px; color: #d0d6e0; }
.note-body p { margin: 0 0 8px; } .note-body ol, .note-body ul { margin: 0 0 8px; padding-left: 18px; } .note-body b { color: #f7f8f8; }
.note-body code { font: 12px ui-monospace, Menlo, monospace; }
.text { color: #f7f8f8; white-space: pre-wrap; line-height: 1.2; }
.font { height: 100%; display: flex; flex-direction: column; justify-content: center; color: #f7f8f8; }
.font small { color: #62666d; font: 12px Inter, sans-serif; margin-top: 6px; }
.swatch { height: 100%; border-radius: 12px; display: flex; align-items: flex-end; padding: 10px; }
.swatch span, .palette span { font: 11px ui-monospace, Menlo, monospace; color: #fff; mix-blend-mode: difference; }
.palette { height: 100%; display: flex; border-radius: 12px; overflow: hidden; }
.palette div { flex: 1; display: flex; align-items: flex-end; padding: 10px; }
.missing { height: 100%; display: grid; place-items: center; color: #62666d; }
.pin { position: absolute; width: 0; height: 0; z-index: 10; transform: scale(var(--inv, 1)); transform-origin: 0 0; }
.pin .key { position: absolute; left: -12px; top: -12px; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; background: #ececec; color: #111214; font: 600 10px ui-monospace, Menlo, monospace; box-shadow: 0 3px 0 #8c8e92, 0 5px 9px rgba(0,0,0,.5); cursor: default; }
.pin .thread { position: absolute; left: 22px; top: -18px; width: 240px; padding: 8px 12px; border-radius: 12px; background: #151618; border: 1px solid rgba(255,255,255,.1); box-shadow: 0 16px 40px rgba(0,0,0,.5); opacity: 0; pointer-events: none; transition: opacity .15s; }
.pin .thread p { margin: 4px 0; color: #f7f8f8; white-space: pre-wrap; }
.pin .thread p + p { color: #d0d6e0; padding-left: 10px; border-left: 1px solid rgba(255,255,255,.1); }
.pin:hover .thread { opacity: 1; }
#bar { position: fixed; left: 50%; bottom: 16px; translate: -50% 0; display: flex; gap: 12px; align-items: center; padding: 8px 14px; border-radius: 12px; background: #0a0a0b; border: 1px solid rgba(255,255,255,.1); color: #8a8f98; font-size: 12px; }
#bar b { color: #f7f8f8; font-weight: 500; }
#bar button { background: none; border: 0; color: #d0d6e0; font: inherit; cursor: pointer; padding: 0; }
#bar button:hover { color: #fff; }
</style>
</head>
<body>
<div id="view"><div id="world" style="width:1px;height:1px">
${frames.join('\n')}
</div></div>
<div id="bar"><b>${esc(title)}</b><span>Drag to pan · scroll or pinch to zoom</span><button id="fit">Fit</button></div>
<script>
const view = document.getElementById("view"), world = document.getElementById("world");
const B = ${JSON.stringify(bounds)};
let cam = { x: 0, y: 0, z: 1 };
const apply = () => {
  world.style.transform = "translate(" + cam.x + "px," + cam.y + "px) scale(" + cam.z + ")";
  world.style.setProperty("--inv", String(1 / cam.z));
};
const fit = () => {
  const pad = 64, w = B.x1 - B.x0, h = B.y1 - B.y0;
  const z = Math.min(1, (innerWidth - pad * 2) / w, (innerHeight - pad * 2) / h);
  cam = { z, x: innerWidth / 2 - (B.x0 + w / 2) * z, y: innerHeight / 2 - (B.y0 + h / 2) * z };
  apply();
};
document.getElementById("fit").onclick = fit;
addEventListener("resize", fit);
view.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const k = Math.exp(-e.deltaY * 0.01), nz = Math.min(4, Math.max(0.05, cam.z * k));
    cam = { z: nz, x: e.clientX - (e.clientX - cam.x) * (nz / cam.z), y: e.clientY - (e.clientY - cam.y) * (nz / cam.z) };
  } else { cam.x -= e.deltaX; cam.y -= e.deltaY; }
  apply();
}, { passive: false });
let drag = null;
view.addEventListener("pointerdown", (e) => { if (e.target.closest("a, iframe, video")) return; drag = { x: e.clientX - cam.x, y: e.clientY - cam.y }; view.classList.add("drag"); view.setPointerCapture(e.pointerId); });
view.addEventListener("pointermove", (e) => { if (!drag) return; cam.x = e.clientX - drag.x; cam.y = e.clientY - drag.y; apply(); });
view.addEventListener("pointerup", () => { drag = null; view.classList.remove("drag"); });
fit();
</script>
</body>
</html>
`
}

/** Builds the share page, saves it to the board's export folder and downloads it. */
export async function shareBoard({ comments = false }: { comments?: boolean } = {}) {
  const s = getState()
  const frames = s.board?.frames ?? []
  if (!s.board || !frames.length) return toast('Nothing on this canvas to share yet', true)
  toast('Building the share page…')
  try {
    // Sections first (biggest at the back), so they sit behind their blocks.
    const ordered = [...frames.filter(isSection).sort(bySize), ...frames.filter((f) => !isSection(f))]
    const parts = await Promise.all(ordered.map((f) => frameHtml(f, s.boardName)))
    if (comments) parts.push(commentsHtml(placed(s).filter((c) => !c.resolved), frames))
    const fontLinks = [...new Set(frames.map((f) => f.fontHref).filter((h): h is string => !!h))]
    const bounds = {
      x0: Math.min(...frames.map((f) => f.x)),
      y0: Math.min(...frames.map((f) => f.y)),
      x1: Math.max(...frames.map((f) => f.x + f.w)),
      y1: Math.max(...frames.map((f) => f.y + f.h)),
    }
    const html = page(s.board.name || s.boardName, parts, fontLinks, bounds)
    const name = `${s.boardName}.html`
    await api.writeFile(s.boardName, `export/${name}`, html)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10000)
    const mb = html.length / 1e6
    toast(`Saved ${boardLabel(s.boardName)}/export/${name} (${mb < 1 ? '<1' : Math.round(mb)} MB) and downloaded it`)
    cue('ready')
  } catch (e) {
    toast(`Couldn’t build the share page: ${(e as Error).message}`, true)
  }
}
