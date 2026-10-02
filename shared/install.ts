/** A shadcn-style install line, registry item ref, or registry URL (instead of component code). */
export function looksLikeInstall(input: string) {
  const t = input.trim()
  if (t.includes('\n')) return false
  return (
    /(?:npx|pnpm\s+dlx|bunx|yarn\s+dlx)\s+shadcn/i.test(t) ||
    /^@[\w-]+\/[\w./-]+$/.test(t) ||
    /^https?:\/\/\S+\/r\/\S+$/.test(t) ||
    /^https?:\/\/\S+\/registry\/\S+\.json$/.test(t)
  )
}
