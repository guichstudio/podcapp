// 0..1 heuristic over extracted markdown/plain text: enough substance, not
// dominated by links or repeated boilerplate lines.
export function scoreExtraction(text: string): number {
  const clean = text.trim()
  if (clean.length < 200) return 0.1

  const lengthScore = Math.min(clean.length / 2500, 1)

  const linkMatches = clean.match(/\[[^\]]*\]\([^)]*\)|https?:\/\/\S+/g) ?? []
  const linkChars = linkMatches.reduce((n, m) => n + m.length, 0)
  const linkDensity = linkChars / clean.length
  const linkScore = linkDensity > 0.5 ? 0.1 : 1 - linkDensity

  const lines = clean.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  const uniqueLines = new Set(lines)
  const boilerplateScore = lines.length === 0 ? 0 : uniqueLines.size / lines.length

  return Math.round((0.45 * lengthScore + 0.3 * linkScore + 0.25 * boilerplateScore) * 100) / 100
}
