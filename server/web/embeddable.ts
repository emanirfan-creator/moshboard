// Whether a site lets itself be framed (GET ?url=).
import { checkEmbeddable } from '../embeddable.ts'
import { handle, json, publicUrl, query } from './http.ts'

export default handle(async (req, res) => {
  json(res, await checkEmbeddable(publicUrl(query(req, 'url')).href), 200, 'public, s-maxage=86400')
})
