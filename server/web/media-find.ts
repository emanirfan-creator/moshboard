// What a pasted link points to (GET ?url=). The browser then saves the files into the user's folder.
import { findMediaLink } from '../media-find.ts'
import { handle, json, publicUrl, query } from './http.ts'

export default handle(async (req, res) => {
  json(res, await findMediaLink(publicUrl(query(req, 'url')).href))
})
