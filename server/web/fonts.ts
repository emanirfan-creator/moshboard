// The Google Fonts catalog for the font picker. (Fonts installed on the visitor's computer can't be listed from a server.)
import { listFonts } from '../fonts.ts'
import { handle, json } from './http.ts'

export default handle(async (_req, res) => {
  const { google } = await listFonts()
  json(res, { mac: [], google }, 200, google.length ? 'public, s-maxage=86400, stale-while-revalidate=604800' : undefined)
})
