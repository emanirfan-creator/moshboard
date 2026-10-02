// Links that point at one piece of media (download it) rather than a site (embed it).

export const MEDIA_EXT = /\.(mp4|webm|mov|m4v|gif|png|jpe?g|webp|avif)(\?|$)/i
/** Hosts whose links point at a single piece of media rather than a site to embed. */
export const MEDIA_HOSTS = /(^|\.)(cosmos\.so|dribbble\.com|are\.na|pinterest\.[a-z.]+|pin\.it|savee\.it|mobbin\.com|me\.muz\.li)$/i

export function isMediaLink(url: string) {
  try {
    const u = new URL(url)
    return MEDIA_EXT.test(u.pathname) || MEDIA_HOSTS.test(u.hostname)
  } catch {
    return false
  }
}

