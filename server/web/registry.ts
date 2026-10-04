// Resolves an install command or registry link (POST { input, context }) into a component and the files it imports.
import { resolveInstall } from '../registry.ts'
import { body, handle, json } from './http.ts'

export default handle(async (req, res) => {
  const { input, context } = await body(req)
  json(res, await resolveInstall(String(input ?? ''), String(context ?? '')))
})
