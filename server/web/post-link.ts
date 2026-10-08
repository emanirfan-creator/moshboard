// The post an Instagram share link (instagram.com/share/…) stands for (GET ?url=). The app's share
// sheet copies these; their token isn't the post's code, so the link is followed to the real one.
import { UA } from '../media-find.ts'
import { postLink, isShareLink } from '../../shared/posts.ts'
import { handle, json, publicUrl, query } from './http.ts'

export default handle(async (req, res) => {
  const link = publicUrl(query(req, 'url')).href
  if (!isShareLink(link)) throw new Error('Not a share link')
  const r = await fetch(link, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(15000) })
  // Redirected to the post, or a page that names it (canonical / og:url).
  const html = postLink(r.url) ? '' : await r.text()
  const named = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i.exec(html)?.[1] ?? /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)/i.exec(html)?.[1]
  const post = postLink(r.url) ?? (named ? postLink(named) : null)
  if (!post || isShareLink(post.url)) throw new Error('Couldn’t find the post behind that link')
  json(res, { url: post.url }, 200, 'public, s-maxage=86400')
})
