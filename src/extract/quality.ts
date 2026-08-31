// 0..1 heuristic over extracted markdown/plain text. It answers one question:
// is this a piece of writing, or the furniture of a website?
// Getting it wrong is expensive in both directions: a listing page that passes
// becomes a fabricated story in the briefing, and a real article that fails is
// content the user saved and never hears about.

// Markdown links count as their visible text: a link inside a sentence is prose,
// a line that is only a link is navigation.
function stripLinks(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' ')
}

// A line reads as prose when it is long enough to be a paragraph and actually
// ends thoughts. Menus, breadcrumbs and card titles do neither.
function isProse(line: string): boolean {
  if (line.length < 80) return false
  const words = line.split(/\s+/).filter(Boolean).length
  if (words < 15) return false
  return /[.!?…](\s|$)/.test(line)
}

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

  const stripped = stripLinks(clean)
  const proseChars = stripped
    .split('\n')
    .map((l) => l.trim())
    .filter(isProse)
    .reduce((n, l) => n + l.length, 0)
  const proseScore = Math.min(proseChars / Math.max(stripped.length, 1), 1)

  const score = 0.25 * lengthScore + 0.2 * linkScore + 0.15 * boilerplateScore + 0.4 * proseScore

  // A page can be long, varied and link-light and still be a section index. Almost
  // no continuous prose is the one signal that no amount of the others redeems.
  const capped = proseScore < 0.1 ? Math.min(score, 0.2) : score
  return Math.round(capped * 100) / 100
}
