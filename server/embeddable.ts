// Whether a website lets itself be framed (X-Frame-Options / CSP frame-ancestors). Sites that
// refuse get a snapshot instead of a live iframe. Plain fetch, so it also runs as the website's
// function (server/web/embeddable.ts).

export async function checkEmbeddable(url: string): Promise<{ embeddable: boolean; reason?: string }> {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000) })
    r.body?.cancel().catch(() => {})
    const xfo = r.headers.get('x-frame-options')?.toLowerCase()
    if (xfo && (xfo.includes('deny') || xfo.includes('sameorigin'))) return { embeddable: false, reason: `X-Frame-Options: ${xfo}` }
    const csp = r.headers.get('content-security-policy') ?? ''
    const fa = /frame-ancestors\s+([^;]+)/i.exec(csp)?.[1].trim()
    if (fa && !/(^|\s)\*(\s|$)/.test(fa) && !/localhost|127\.0\.0\.1/.test(fa)) {
      return { embeddable: false, reason: `frame-ancestors ${fa}` }
    }
    return { embeddable: true }
  } catch {
    // Can't tell (offline, timeout): try the live iframe.
    return { embeddable: true }
  }
}
