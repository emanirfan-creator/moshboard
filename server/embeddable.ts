// Whether a website lets itself be framed (X-Frame-Options / CSP frame-ancestors). Sites that
// refuse get a snapshot instead of a live iframe. Plain fetch, so it also runs as the website's
// function (server/web/embeddable.ts).

/** `here`: the app's own origins, which a site's frame-ancestors may list (the local app: localhost). */
export async function checkEmbeddable(
  url: string,
  here = /localhost|127\.0\.0\.1/,
): Promise<{ embeddable: boolean; reason?: string; guessed?: boolean }> {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000) })
    r.body?.cancel().catch(() => {})
    const xfo = r.headers.get('x-frame-options')?.toLowerCase()
    if (xfo && (xfo.includes('deny') || xfo.includes('sameorigin'))) return { embeddable: false, reason: `X-Frame-Options: ${xfo}` }
    const csp = r.headers.get('content-security-policy') ?? ''
    const fa = /frame-ancestors\s+([^;]+)/i.exec(csp)?.[1].trim()
    if (fa && !/(^|\s)\*(\s|$)/.test(fa) && !here.test(fa)) {
      return { embeddable: false, reason: `frame-ancestors ${fa}` }
    }
    return { embeddable: true }
  } catch {
    // Can't tell (offline, timeout): try the live iframe.
    return { embeddable: true, guessed: true }
  }
}
