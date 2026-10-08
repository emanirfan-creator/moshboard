// What a pasted link points to (GET ?url=). The browser then saves the files into the user's folder.
import { findMediaLink } from '../media-find.ts'
import { handle, json, publicUrl, query } from './http.ts'

export default handle(async (req, res) => {
  // The same link pasted again (or by someone else) is answered by Vercel's cache, not a new page
  // fetch; kept short since media addresses on some sites eventually change.
  json(res, await findMediaLink(publicUrl(query(req, 'url')).href), 200, 'public, s-maxage=600, stale-while-revalidate=3600')
})
