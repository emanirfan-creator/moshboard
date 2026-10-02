// Which fonts a page actually sets its text in, read in the page itself: by the
// sandbox for components, and by headless Chrome for websites.

export interface UsedFont {
  /** the computed font-family stack, e.g. `"Söhne", Helvetica, sans-serif` */
  stack: string
  weight: number
  /** how much text uses it: characters × font size */
  score: number
}

/** The font stack code frames inherit when the component sets none (not a choice worth suggesting). */
export const SANDBOX_FONT = 'Inter, system-ui, sans-serif'

/** An ES5 expression that evaluates to the page's UsedFont[], most-used first. */
export const FONT_PROBE = `(function () {
  var scores = {};
  var els = document.body ? document.body.querySelectorAll("*") : [];
  for (var i = 0; i < els.length && i < 4000; i++) {
    var el = els[i];
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|svg)$/i.test(el.tagName) || (el.closest && el.closest(".__mb-error"))) continue;
    var text = "";
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) text += c.nodeValue;
    text = text.trim();
    if (!text) continue;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    var cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;
    var key = cs.fontFamily + "|" + cs.fontWeight;
    scores[key] = (scores[key] || 0) + Math.min(text.length, 200) * (parseFloat(cs.fontSize) || 16);
  }
  return Object.keys(scores)
    .map(function (k) { var p = k.split("|"); return { stack: p[0], weight: Number(p[1]) || 400, score: scores[k] }; })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, 8);
})()`
