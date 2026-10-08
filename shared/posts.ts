// Instagram and LinkedIn posts: shown in the site's own embed (the page each one makes for other
// sites to show), never downloaded. Their terms allow the embed; taking the video or images out
// of it isn't allowed, so a post block keeps only its link.

export type PostProvider = 'instagram' | 'linkedin'

export interface PostLink {
  provider: PostProvider
  /** what to call it: "Instagram reel", "LinkedIn post" */
  name: string
  /** the post's own address, without tracking parameters */
  url: string
  /** the page to frame */
  embed: string
}

export const POST_SITE: Record<PostProvider, string> = { instagram: 'Instagram', linkedin: 'LinkedIn' }

/** Each embed at the width it's made for. Instagram's height follows the post once it loads; LinkedIn's scrolls. */
export const POST_SIZE: Record<PostProvider, { w: number; h: number }> = {
  instagram: { w: 400, h: 720 },
  linkedin: { w: 504, h: 600 },
}

// instagram.com/p/<code>, /reel/<code>, /reels/<code>, /tv/<code>, also with the account first (/<user>/p/<code>).
const INSTAGRAM = /^\/(?:[\w.]+\/)?(p|reels?|tv)\/(?!audio\/)([\w-]+)/
// linkedin.com/posts/<user>_<slug>-activity-<id>-<x>, /feed/update/urn:li:activity:<id>, and its embed page.
const LINKEDIN_URN = /urn:li:(activity|share|ugcPost):(\d+)/
const LINKEDIN_POST = /^\/posts\/(?:.*[-_])?(activity|share|ugcPost)-(\d{10,})/

/** An Instagram or LinkedIn post link, or null for anything else. */
export function postLink(href: string): PostLink | null {
  let u: URL
  try {
    u = new URL(href)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    const m = INSTAGRAM.exec(u.pathname)
    if (!m) return null
    const kind = m[1] === 'p' || m[1] === 'tv' ? 'p' : 'reel'
    return {
      provider: 'instagram',
      name: kind === 'reel' ? 'Instagram reel' : 'Instagram post',
      url: `https://www.instagram.com/${kind}/${m[2]}/`,
      embed: `https://www.instagram.com/${kind}/${m[2]}/embed/`,
    }
  }
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    const path = decodeURIComponent(u.pathname)
    const m = LINKEDIN_URN.exec(path) ?? LINKEDIN_POST.exec(path)
    if (!m) return null
    const urn = `urn:li:${m[1]}:${m[2]}`
    return {
      provider: 'linkedin',
      name: 'LinkedIn post',
      url: `https://www.linkedin.com/feed/update/${urn}/`,
      embed: `https://www.linkedin.com/embed/feed/update/${urn}`,
    }
  }
  return null
}
