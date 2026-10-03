import { transform } from 'sucrase'
import { FONT_PROBE, SANDBOX_FONT } from '../../shared/font-probe.ts'
import { TW_THEME } from '../../shared/twTheme.ts'
import { buildSnippet, parseSnippet } from '../../shared/snippet.ts'

// Code frames run in a sandboxed iframe (opaque origin). React components get
// an import map (React from esm.sh, any other bare import rewritten to esm.sh),
// Tailwind v4's browser build, a shadcn-style `@/lib/utils`, and the
// `moodboard` module that exposes live params.

const REACT = 'https://esm.sh/react@19.3.0'
const REACT_DOM = 'https://esm.sh/react-dom@19.3.0'
const TAILWIND = 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4'

const WRAPPER = 'moodboard/wrapper'

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

// Registry components are often written for Next.js. Outside a Next app its
// image optimizer (`/_next/image`) and router don't exist, so these stand in:
// images load from their own URL, links are plain anchors.
const NEXT_IMAGE_MODULE = dataModule(`
import { createElement, forwardRef } from "react";
const srcOf = (s) => (s && typeof s === "object" ? s.src : s);
export function getImageProps({ src, fill, priority, loader, quality, placeholder, blurDataURL, unoptimized, ...rest }) {
  return { props: { ...rest, src: srcOf(src), loading: priority ? "eager" : rest.loading } };
}
const Image = forwardRef(function Image({ src, fill, priority, loader, quality, placeholder, blurDataURL, unoptimized, style, ...rest }, ref) {
  const fillStyle = fill ? { position: "absolute", inset: 0, width: "100%", height: "100%" } : null;
  return createElement("img", { ref, ...rest, src: srcOf(src), loading: priority ? "eager" : rest.loading, style: { ...fillStyle, ...style } });
});
export default Image;
`)

const NEXT_LINK_MODULE = dataModule(`
import { createElement, forwardRef } from "react";
const Link = forwardRef(function Link({ href, prefetch, replace, scroll, shallow, passHref, legacyBehavior, locale, ...rest }, ref) {
  return createElement("a", { ref, ...rest, href: typeof href === "object" ? href.pathname ?? "#" : href });
});
export default Link;
`)

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
    'next/image': NEXT_IMAGE_MODULE,
    'next/link': NEXT_LINK_MODULE,
  },
}



const BASE_CSS = `
html, body { margin: 0; height: 100%; }
:root { color-scheme: dark; }
body { background: transparent; color: #f7f8f8; font: 13px/1.5 ${SANDBOX_FONT}; -webkit-font-smoothing: antialiased; }
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
  // Sizing a new frame to what it draws: the box around every visible element, skipping
  // wrappers that only stretch to fill the frame (h-screen centering and the like).
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "mb:fit") return;
    var vw = innerWidth, vh = innerHeight, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    var els = document.body ? document.body.querySelectorAll("*") : [];
    for (var i = 0; i < els.length && i < 3000; i++) {
      var el = els[i];
      if (/^(SCRIPT|STYLE|LINK|META|TEMPLATE)$/.test(el.tagName) || el.closest(".__mb-error")) continue;
      var r = el.getBoundingClientRect();
      var fillsW = r.width >= vw * 0.98, fillsH = r.height >= vh * 0.98;
      // A wrapper stretched across the frame says nothing about size; its children do.
      if (r.width < 1 || r.height < 1 || (fillsW && fillsH) || ((fillsW || fillsH) && el.childElementCount)) continue;
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    parent.postMessage({ type: "mb:size", w: x1 > x0 ? x1 - x0 : 0, h: y1 > y0 ? y1 - y0 : 0 }, "*");
  });
  // Replay without reloading the frame: React frames remount, HTML frames restart their animations.
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "mb:replay") return;
    if (window.__mbRemount) return window.__mbRemount();
    document.getAnimations().forEach(function (a) { a.cancel(); a.play(); });
    measureSoon();
  });
  // Motion measured in the running frame, whatever library wrote it: CSS transitions and
  // animations from computed styles, and Web Animations as they're created. Tuned values
  // come back as "mb:runtime" and are applied on top (a stylesheet for CSS, updateTiming
  // for Web Animations), so the code itself is never touched.
  var tune = {}, cssGroups = {}, waapi = [], live = [];
  function desc(el) {
    var c = Array.prototype.find.call(el.classList, function (x) { return !/\\d/.test(x) && x.length < 40; });
    return "<" + el.tagName.toLowerCase() + (c ? "." + c : "") + ">";
  }
  function sel(el) {
    if (el.classList.length) {
      return el.tagName.toLowerCase() + Array.prototype.map.call(el.classList, function (c) { return "." + CSS.escape(c); }).join("");
    }
    var path = [];
    for (var n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      var i = 1;
      for (var p = n.previousElementSibling; p; p = p.previousElementSibling) i++;
      path.unshift(n.tagName.toLowerCase() + ":nth-child(" + i + ")");
    }
    return "body > " + path.join(" > ");
  }
  function split(v) { return String(v || "").split(/,(?![^(]*\\))/).map(function (x) { return x.trim(); }); }
  function ms(t) { var x = parseFloat(t) || 0; return /ms$/.test(t) ? x : x * 1000; }
  // One item per element and timing: properties that share a duration/delay/easing
  // (a theme's "transition: common 200ms") are tuned together.
  function collect(el, kind, names, durs, delays, eases) {
    var N = split(names), D = split(durs), L = split(delays), E = split(eases), s = null, byTiming = {};
    for (var i = 0; i < N.length; i++) {
      var d = ms(D[i % D.length]), l = ms(L[i % L.length]), e = E[i % E.length];
      if (!d && !l) continue;
      s = s || sel(el);
      var t = d + "|" + l + "|" + e, g = byTiming[t];
      if (g) { g.indices.push(i); g.props += ", " + N[i]; continue; }
      var key = kind + "|" + s + "|" + i;
      if (cssGroups[key]) { cssGroups[key].count++; byTiming[t] = { indices: [], props: "" }; continue; }
      g = byTiming[t] = cssGroups[key] = { key: key, kind: kind, selector: s, indices: [i], desc: desc(el), props: N[i], duration: d,
        delay: l, easing: e, count: 1, list: { n: N.length, durs: D, delays: L, eases: E } };
    }
  }
  function measure() {
    var sheet = document.getElementById("__mb-rt");
    if (sheet) sheet.disabled = true; // measure what the code does, not the tuned values
    cssGroups = {};
    var els = document.body ? document.body.querySelectorAll("*") : [];
    for (var i = 0; i < els.length && i < 1500; i++) {
      var el = els[i];
      if (/^(SCRIPT|STYLE|LINK|META)$/.test(el.tagName)) continue;
      var cs = getComputedStyle(el);
      collect(el, "transition", cs.transitionProperty, cs.transitionDuration, cs.transitionDelay, cs.transitionTimingFunction);
      if (cs.animationName && cs.animationName !== "none")
        collect(el, "animation", cs.animationName, cs.animationDuration, cs.animationDelay, cs.animationTimingFunction);
    }
    if (sheet) sheet.disabled = false;
    applyCss(); // tuning can arrive before the first measurement
    var items = Object.keys(cssGroups).map(function (k) { return cssGroups[k]; }).concat(waapi);
    parent.postMessage({ type: "mb:motion", items: items }, "*");
    // The fonts its text is set in, for suggesting fonts that match the board.
    try { parent.postMessage({ type: "mb:fonts", fonts: ${FONT_PROBE} }, "*"); } catch (e) {}
  }
  function measureSoon() { setTimeout(measure, 300); setTimeout(measure, 1500); }
  function applyCss() {
    var rules = {};
    for (var key in tune) {
      var g = cssGroups[key];
      if (!g) continue;
      var full = function (list) { var out = []; for (var j = 0; j < g.list.n; j++) out.push(list[j % list.length]); return out; };
      var r = rules[g.kind + "|" + g.selector] || (rules[g.kind + "|" + g.selector] = {
        kind: g.kind, selector: g.selector, durs: full(g.list.durs), delays: full(g.list.delays), eases: full(g.list.eases) });
      var t = tune[key];
      g.indices.forEach(function (i) {
        if (t.duration != null) r.durs[i] = t.duration + "ms";
        if (t.delay != null) r.delays[i] = t.delay + "ms";
        if (t.ease) r.eases[i] = t.ease;
      });
    }
    var css = "";
    for (var k in rules) {
      var x = rules[k];
      css += x.selector + " { " + x.kind + "-duration: " + x.durs.join(", ") + " !important; " + x.kind + "-delay: " +
        x.delays.join(", ") + " !important; " + x.kind + "-timing-function: " + x.eases.join(", ") + " !important; }\\n";
    }
    var s = document.getElementById("__mb-rt");
    if (!s) { s = document.createElement("style"); s.id = "__mb-rt"; (document.head || document.documentElement).append(s); }
    s.textContent = css;
  }
  function applyAnim(a, key) {
    var t = tune[key] || {}, o = a.__mbOrig;
    try { a.effect.updateTiming({ duration: t.duration != null ? t.duration : o.duration, delay: t.delay != null ? t.delay : o.delay, easing: t.ease || o.easing }); } catch (e) {}
  }
  var animate = Element.prototype.animate;
  Element.prototype.animate = function (kf, opts) {
    var a = animate.call(this, kf, opts);
    try {
      var tm = a.effect.getTiming(), first = Array.isArray(kf) ? kf[0] || {} : kf || {};
      var props = Object.keys(first).filter(function (k) { return !/^(offset|easing|composite)$/.test(k); }).join(", ");
      var key = "waapi|" + sel(this) + "|" + props;
      a.__mbOrig = { duration: tm.duration, delay: tm.delay || 0, easing: tm.easing || "linear" };
      if (typeof tm.duration === "number" && !waapi.some(function (x) { return x.key === key; }))
        waapi.push({ key: key, kind: "waapi", selector: sel(this), desc: desc(this), props: props, duration: tm.duration,
          delay: tm.delay || 0, easing: tm.easing || "linear", count: 1 });
      if (tune[key]) applyAnim(a, key);
      live.push([a, key]);
      if (live.length > 300) live = live.filter(function (x) { return x[0].playState !== "finished"; });
    } catch (e) {}
    return a;
  };
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "mb:runtime") return;
    tune = e.data.tune || {};
    applyCss();
    live.forEach(function (x) { applyAnim(x[0], x[1]); });
  });
  window.addEventListener("mb:measure", measureSoon);
  // After a successful render, stray runtime errors (e.g. React portal cleanup in 3D libraries)
  // only count if the component actually disappeared.
  function report(m) {
    var root = document.getElementById("root");
    if (window.__mbReady && root && root.childElementCount) { console.warn("[moodboard]", m); return; }
    parent.postMessage({ type: "mb:error", message: String(m) }, "*");
  }
  window.addEventListener("error", function (e) { report(e.message); });
  // HTML frames are ready on load; React frames announce it after their first render.
  window.addEventListener("load", function () { if (!window.__mbReact) { parent.postMessage({ type: "mb:ready" }, "*"); measureSoon(); } });
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
 * Resolve a relative import (`./display.wgsl`) to one of the frame's `@/…` modules.
 * From a module, it's resolved against that module's own path; from the frame
 * source (whose path isn't kept), it matches the one module ending in that path.
 */
function resolveRelative(spec: string, importer: string | undefined, mapped: Set<string>) {
  const clean = spec.replace(/\.(tsx|ts|jsx|js)$/, '')
  if (importer) {
    const parts = importer.split('/').slice(0, -1)
    for (const seg of clean.split('/')) {
      if (seg === '..') parts.pop()
      else if (seg !== '.' && seg) parts.push(seg)
    }
    const joined = parts.join('/')
    if (mapped.has(joined)) return joined
  }
  const tail = '/' + clean.replace(/^(\.\.?\/)+/, '')
  const hits = [...mapped].filter((m) => m.startsWith('@/') && m.endsWith(tail))
  return hits.length === 1 ? hits[0] : undefined
}

/**
 * Bare npm imports go to esm.sh. `@/…` and relative imports must be one of the
 * frame's own modules (or a built-in like `@/lib/utils`); anything else is
 * reported as missing. `importer` is the module's own `@/…` path, if it has one.
 */
function rewriteImports(code: string, mapped: Set<string>, missing: Set<string>, importer?: string) {
  return code
    .replace(/^\s*import\s+['"][^'"]+\.css['"];?\s*$/gm, '')
    .replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g, (m, pre: string, q: string, spec: string) => {
      if (/^\.\.?\//.test(spec)) {
        const local = resolveRelative(spec, importer, mapped)
        if (local) return `${pre}${q}${local}${q}`
        missing.add(spec)
        return m
      }
      if (/^(\/|https?:|data:|blob:)/.test(spec) || mapped.has(spec) || spec.startsWith('three/')) return m
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
  if (named) return `${source.trimEnd()}\n\nexport default ${named}\n`
  const snippet = parseSnippet(source)
  return snippet ? buildSnippet(snippet) : source
}

export function compileTsx(
  source: string,
  mapped: Set<string> = new Set(Object.keys(IMPORT_MAP.imports)),
  missing: Set<string> = new Set(),
  filePath = 'frame.tsx',
  importer?: string,
): string {
  const { code } = transform(source.replace(/^\s*['"]use client['"];?/m, ''), {
    transforms: ['typescript', 'jsx'],
    jsxRuntime: 'automatic',
    production: true,
    filePath,
  })
  return rewriteImports(code, mapped, missing, importer)
}

/** Import map for a frame: the built-ins plus its own modules (from a registry install), compiled. */
function frameImports(modules: Record<string, string>, missing: Set<string>) {
  const imports: Record<string, string> = { ...IMPORT_MAP.imports }
  const mapped = new Set([...Object.keys(imports), ...Object.keys(modules)])
  for (const [spec, src] of Object.entries(modules)) {
    imports[spec] = dataModule(compileTsx(src, mapped, missing, `${spec.slice(2)}.tsx`, spec))
  }
  return { imports, mapped }
}

const missingMessage = (missing: Set<string>) =>
  `This component imports ${[...missing].map((m) => `“${m}”`).join(', ')}, which isn’t part of what was pasted.\n\n` +
  `Paste the install command instead (e.g. npx shadcn@latest add @aceternity/…) to get every file.`

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
  /** source of a wrapper component (providers) the frame renders inside */
  wrapper?: string,
  /** values for the component's own props, set in the side panel (later changes arrive as `mb:props`) */
  props: Record<string, unknown> = {},
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
    if (wrapper) {
      frame.mapped.add(WRAPPER)
      imports[WRAPPER] = dataModule(compileTsx(ensureDefaultExport(wrapper), frame.mapped, missing, 'wrapper.tsx'))
    }
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
  const W = ${wrapper ? `(await import(${JSON.stringify(WRAPPER)})).default` : 'null'};
  // Props set in the side panel; a change re-renders with the new values (no remount).
  let props = ${safeJson(props)};
  // The wrapper (providers) stays mounted; replay remounts only the component.
  const el = (key) => (W ? React.createElement(W, null, React.createElement(C, { ...props, key })) : React.createElement(C, { ...props, key }));
  const root = createRoot(document.getElementById("root"));
  let n = 0;
  window.__mbRemount = () => (root.render(el(++n)), window.dispatchEvent(new Event("mb:measure")));
  root.render(el(n));
  // Re-render (not remount) on param changes, so getParams() reads stay live.
  window.__mb.subscribe(() => root.render(el(n)));
  window.addEventListener("message", (e) => {
    if (!e.data || e.data.type !== "mb:props") return;
    props = e.data.props || {};
    root.render(el(n));
  });
  window.__mbReady = true;
  parent.postMessage({ type: "mb:ready" }, "*");
  window.dispatchEvent(new Event("mb:measure"));
} catch (e) {
  let msg = String(e && e.message || e);
  // The browser hides which import failed behind the blob URL; say something useful.
  if (/dynamically imported module|Importing a module script failed/i.test(msg))
    msg = "A package failed to load from esm.sh. Check your connection, then press R.";
  const el = document.createElement("div");
  el.className = "__mb-error";
  el.textContent = msg;
  document.body.append(el);
  parent.postMessage({ type: "mb:error", message: msg }, "*");
}
</script></body></html>`
}
