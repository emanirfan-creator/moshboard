// Whether a site lets itself be framed (GET ?url=).
import { checkEmbeddable } from '../embeddable.ts'
import { handle, json, publicUrl, query } from './http.ts'

export default handle(async (req, res) => {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const result = await checkEmbeddable(publicUrl(query(req, 'url')).href, new RegExp(host || '(?!)'))
  // A guess (the site was slow or refused us) isn't kept for everyone for a day.
  json(res, result, 200, result.guessed ? 'public, s-maxage=60' : 'public, s-maxage=86400')
})
