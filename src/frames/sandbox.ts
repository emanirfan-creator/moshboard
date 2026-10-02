import { transform } from 'sucrase'
import { TW_THEME } from '../../shared/twTheme.ts'

// Code frames run in a sandboxed iframe (opaque origin). React components get
// an import map (React from esm.sh, any other bare import rewritten to esm.sh),
// Tailwind v4's browser build, a shadcn-style `@/lib/utils`, and the
// `moodboard` module that exposes live params.

const REACT = 'https://esm.sh/react@19.1.0'
const REACT_DOM = 'https://esm.sh/react-dom@19.1.0'
const TAILWIND = 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4'

const dataModule = (code: string) => `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`

const MOODBOARD_MODULE = dataModule(`
import { useSyncExternalStore } from "react";
const mb = window.__mb;
export function useParams() { return useSyncExternalStore(mb.subscribe, mb.get); }
export function getParams() { return mb.get(); }
`)

const UTILS_MODULE = dataModule(`
import { clsx } from "https://esm.sh/clsx@2";
import { twMerge } from "https://esm.sh/tailwind-merge@3";
export function cn(...inputs) { return twMerge(clsx(inputs)); }
`)

// Packages that must exist exactly once per frame (React, three.js and the
// R3F reconciler break when a dependency pulls in its own copy). Every esm.sh
// import treats them as external and the import map points them at one URL.
const SHARED = ['react', 'react-dom', 'three', '@react-three/fiber']
const EXTERNAL = SHARED.join(',')

const IMPORT_MAP = {
  imports: {
    three: 'https://esm.sh/three',
    'three/': 'https://esm.sh/three/',
    '@react-three/fiber': `https://esm.sh/@react-three/fiber?external=${EXTERNAL}`,
    react: REACT,
    'react/jsx-runtime': `${REACT}/jsx-runtime`,
    'react-dom': `${REACT_DOM}?external=react`,
    'react-dom/client': `${REACT_DOM}/client?external=react`,
    // Built with react-dom external, the server entry imports `react-dom/cjs/…` bare.
    'react-dom/server': `${REACT_DOM}/server?external=react`,
    'react-dom/server.browser': `${REACT_DOM}/server.browser?external=react`,
    moodboard: MOODBOARD_MODULE,
    '@/lib/utils': UTILS_MODULE,
  },
}



const BASE_CSS = `
html, body { margin: 0; height: 100%; }
:root { color-scheme: dark; }
body { background: transparent; color: #f7f8f8; font: 13px/1.5 Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
#root { min-height: 100%; display: grid; place-items: center; }
.__mb-error { font: 11px/1.4 ui-monospace, Menlo, monospace; color: #eb5757; padding: 12px; white-space: pre-wrap; }
`

// Runs before anything else in the frame: live params + error reporting.
const runtime = (values: Record<string, unknown>) => `
(function () {
  var v = ${safeJson(values)}, subs = new Set();
  window.__mb = {
    get: function () { return v; },
    subscribe: function (f) { subs.add(f); return function () { subs.delete(f); }; },
    set: function (n) { v = n; subs.forEach(function (f) { f(); }); }
  };
  // Detected motion values (see shared/detect-motion.ts): the preview copy of the code
  // reads them through __mbP, falling back to the literal as written until it's tuned.
  function bez(b) {
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var lo = 0, hi = 1, t = x;
      for (var i = 0; i < 22; i++) {
        t = (lo + hi) / 2;
        var cx = 3 * b[0] * t * (1 - t) * (1 - t) + 3 * b[2] * t * t * (1 - t) + t * t * t;
        if (cx < x) lo = t; else hi = t;
      }
      return 3 * b[1] * t * (1 - t) * (1 - t) + 3 * b[3] * t * t * (1 - t) + t * t * t;
    };
  }
  window.__mbP = function (name, fallback, fmt, part) {
    var x = v[name];
    if (x === undefined || x === null) return fallback;
    if (fmt === "s") return x / 1000;
    if (fmt === "spring") return x[part];
    if (fmt === "gsap-ease") return bez(x);
    if (fmt === "css-ease-js") return "cubic-bezier(" + x.join(", ") + ")";
    return x;
  };
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.type !== "mb:params") return;
    // Replace the whole set, so a discarded value falls back to what the code says.
    var vars = document.getElementById("__mb-vars");
    var decl = "";
    for (var k in d.css) decl += k + ": " + d.css[k] + "; ";
    if (vars) vars.textContent = ":root { " + decl + "}";
    else { var s = document.documentElement.style; for (var k2 in d.css) s.setProperty(k2, d.css[k2]); }
    window.__mb.set(d.values);
    window.dispatchEvent(new CustomEvent("mb:params", { detail: d.values }));
  });
  // Replay without reloading the frame: React frames remount, HTML frames restart their animations.
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "mb:replay") return;
    if (window.__mbRemount) return window.__mbRemount();
    document.getAnimations().forEach(function (a) { a.cancel(); a.play(); });
  });
  // After a successful render, stray runtime errors (e.g. React portal cleanup in 3D libraries)
  // only count if the component actually disappeared.
  function report(m) {
    var root = document.getElementById("root");
    if (window.__mbReady && root && root.childElementCount) { console.warn("[moodboard]", m); return; }
    parent.postMessage({ type: "mb:error", message: String(m) }, "*");
  }
  window.addEventListener("error", function (e) { report(e.message); });
  // HTML frames are ready on load; React frames announce it after their first render.
  window.addEventListener("load", function () { if (!window.__mbReact) parent.postMessage({ type: "mb:ready" }, "*"); });
  window.addEventListener("unhandledrejection", function (e) { report(e.reason && e.reason.message || e.reason); });
})();`

function safeJson(v: unknown) {
  return JSON.stringify(v).replace(/</g, '\\u003c')
}

function rootVars(css: Record<string, string>) {
  return `:root { ${Object.entries(css)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')} }`
}

/**
 * Bare npm imports go to esm.sh. `@/…` imports must be one of the frame's own
 * modules (or a built-in like `@/lib/utils`); anything else is reported as missing.
 */
function rewriteImports(code: string, mapped: Set<string>, missing: Set<string>) {
  return code
    .replace(/^\s*import\s+['"][^'"]+\.css['"];?\s*$/gm, '')
    .replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g, (m, pre: string, q: string, spec: string) => {
      if (/^(\.|\/|https?:|data:|blob:)/.test(spec) || mapped.has(spec) || spec.startsWith('three/')) return m
      if (spec.startsWith('@/')) {
        missing.add(spec)
        return m
      }
      return `${pre}${q}https://esm.sh/${spec}?external=${EXTERNAL}${q}`
    })
}

/** Give pasted components a default export if they only have named ones. */
export function ensureDefaultExport(source: string) {
  if (/export\s+default\b/.test(source)) return source
  const named =
    /export\s+(?:function|const|let|class)\s+([A-Z]\w*)/.exec(source)?.[1] ??
    /export\s*\{\s*([A-Z]\w*)/.exec(source)?.[1] ??
    /(?:function|const)\s+([A-Z]\w*)/.exec(source)?.[1]
  return named ? `${source.trimEnd()}\n\nexport default ${named}\n` : source
}

export function compileTsx(
  source: string,
  mapped: Set<string> = new Set(Object.keys(IMPORT_MAP.imports)),
  missing: Set<string> = new Set(),
  filePath = 'frame.tsx',
): string {
  const { code } = transform(source.replace(/^\s*['"]use client['"];?/m, ''), {
    transforms: ['typescript', 'jsx'],
    jsxRuntime: 'automatic',
    production: true,
    filePath,
  })
  return rewriteImports(code, mapped, missing)
}

/** Import map for a frame: the built-ins plus its own modules (from a registry install), compiled. */
function frameImports(modules: Record<string, string>, missing: Set<string>) {
  const imports: Record<string, string> = { ...IMPORT_MAP.imports }
  const mapped = new Set([...Object.keys(imports), ...Object.keys(modules)])
  for (const [spec, src] of Object.entries(modules)) {
    imports[spec] = dataModule(compileTsx(src, mapped, missing, `${spec.slice(2)}.tsx`))
  }
  return { imports, mapped }
}

const missingMessage = (missing: Set<string>) =>
  `This component imports ${[...missing].map((m) => `“${m}”`).join(', ')}, which isn’t part of what was pasted.\n\n` +
  `Paste the library’s install command instead (e.g. npx shadcn@latest add @aceternity/…). Roto fetches the component with every file it needs.`

// Painted before any script loads, so a frame is never a white box while
// Tailwind or esm.sh are still downloading.
/**
 * `twCss`: Tailwind compiled on the server for this frame (fast, static). Without
 * it the frame falls back to Tailwind's in-browser compiler.
 */
const head = (
  css: Record<string, string>,
  values: Record<string, unknown>,
  imports: Record<string, string> = IMPORT_MAP.imports,
  twCss?: string,
) => `
<meta charset="utf-8">
<meta name="color-scheme" content="dark">
<style>html { background: #1b1c1f; color-scheme: dark; }</style>
<script>${runtime(values)}</script>
<script type="importmap">${safeJson({ imports })}</script>
${twCss !== undefined ? `<style>${twCss.replace(/<\/style/gi, '<\\/style')}</style>` : `<script src="${TAILWIND}"></script>\n<style type="text/tailwindcss">${TW_THEME}</style>`}
<style>${BASE_CSS}</style>
<style id="__mb-vars">${rootVars(css)}</style>`

function errorDoc(css: Record<string, string>, values: Record<string, unknown>, msg: string) {
  return `<!doctype html><html><head>${head(css, values)}</head><body><div class="__mb-error"></div>
<script>window.__mbReact = true; document.querySelector(".__mb-error").textContent = ${safeJson(msg)}; parent.postMessage({ type: "mb:error", message: ${safeJson(msg)} }, "*");</script></body></html>`
}

export function buildSrcdoc(
  kind: 'tsx' | 'html',
  source: string,
  css: Record<string, string>,
  values: Record<string, unknown>,
  modules: Record<string, string> = {},
  twCss?: string,
): string {
  if (kind === 'html') {
    const h = head(css, values, IMPORT_MAP.imports, twCss)
    if (/<head[^>]*>/i.test(source)) return source.replace(/<head[^>]*>/i, (m) => m + h)
    return `<!doctype html><html class="dark"><head>${h}</head><body>${source}</body></html>`
  }

  let compiled: string
  let imports: Record<string, string>
  const missing = new Set<string>()
  try {
    const frame = frameImports(modules, missing)
    imports = frame.imports
    compiled = compileTsx(ensureDefaultExport(source), frame.mapped, missing)
  } catch (e) {
    return errorDoc(css, values, e instanceof Error ? e.message : String(e))
  }
  if (missing.size) return errorDoc(css, values, missingMessage(missing))

  return `<!doctype html><html class="dark"><head>${head(css, values, imports, twCss)}</head><body><div id="root"></div>
<script>window.__mbReact = true;</script>
<script type="module">
import React from "react";
import { createRoot } from "react-dom/client";
const code = ${safeJson(compiled)};
const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
try {
  const mod = await import(url);
  const C = mod.default;
  if (!C) throw new Error("Frame has no default export to render");
  const root = createRoot(document.getElementById("root"));
  let n = 0;
  window.__mbRemount = () => root.render(React.createElement(C, { key: ++n }));
  root.render(React.createElement(C, { key: n }));
  // Re-render (not remount) on param changes, so getParams() reads stay live.
  window.__mb.subscribe(() => root.render(React.createElement(C, { key: n })));
  window.__mbReady = true;
  parent.postMessage({ type: "mb:ready" }, "*");
} catch (e) {
  let msg = String(e && e.message || e);
  // The browser hides which import failed behind the blob URL; say something useful.
  if (/dynamically imported module|Importing a module script failed/i.test(msg))
    msg = "One of this component’s packages failed to load from esm.sh. Check your connection, then press R to retry.";
  const el = document.createElement("div");
  el.className = "__mb-error";
  el.textContent = msg;
  document.body.append(el);
  parent.postMessage({ type: "mb:error", message: msg }, "*");
}
</script></body></html>`
}
