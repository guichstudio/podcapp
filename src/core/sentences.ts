// Sentence splitting for the grounding stage. Abbreviations and decimal numbers
// must not split a sentence (FR "M." "Mme" "etc.", "1,8 milliard", "40 %").
const ABBREVIATIONS = /\b(M|MM|Mme|Mlle|Dr|Pr|St|Ste|etc|cf|env|art|no|nº|vs|Inc|Ltd|Corp|Jr|Sr|U\.S|U\.K)\.$/i

export function splitSentences(text: string): string[] {
  const out: string[] = []
  let current = ''
  const parts = text.split(/(?<=[.!?…])\s+/)
  for (const part of parts) {
    current = current ? `${current} ${part}` : part
    const trimmed = current.trimEnd()
    if (ABBREVIATIONS.test(trimmed)) continue
    if (/\d[.,]$/.test(trimmed)) continue
    out.push(current.trim())
    current = ''
  }
  if (current.trim()) out.push(current.trim())
  return out.filter((s) => s.length > 0)
}

// Only sentences carrying checkable content reach the grounding model: digits,
// quotes, percentages, or a known entity from the story.
export function isCheckable(sentence: string, entities: string[]): boolean {
  if (/\d/.test(sentence)) return true
  if (/[«»"“”]/.test(sentence)) return true
  if (/\bpour cent\b|%/.test(sentence)) return true
  const lower = sentence.toLowerCase()
  return entities.some((e) => e.length > 3 && lower.includes(e.toLowerCase()))
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
