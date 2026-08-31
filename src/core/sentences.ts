// Sentence splitting for the grounding stage. Abbreviations and decimal numbers
// must not split a sentence (FR "M." "Mme" "etc.", "1,8 milliard", "40 %").
const ABBREVIATIONS = /\b(M|MM|Mme|Mlle|Dr|Pr|St|Ste|etc|cf|env|art|no|nº|vs|Inc|Ltd|Corp|Jr|Sr|U\.S|U\.K)\.$/i

export function splitSentences(text: string): string[] {
  const out: string[] = []
  let current = ''
  const parts = text.split(/(?<=[.!?…])\s+/)
  for (const [i, part] of parts.entries()) {
    current = current ? `${current} ${part}` : part
    const trimmed = current.trimEnd()
    if (ABBREVIATIONS.test(trimmed)) continue
    // A digit before the break only continues a number when a digit follows it;
    // otherwise the sentence genuinely ends there ("...la levée de 2024. Depuis...").
    if (/\d[.,]$/.test(trimmed) && /^\d/.test(parts[i + 1] ?? '')) continue
    out.push(current.trim())
    current = ''
  }
  if (current.trim()) out.push(current.trim())
  return out.filter((s) => s.length > 0)
}

// Grammar capitalizes the first word of every sentence, so that one capital says
// nothing about names. These are the ordinary openers that would otherwise send
// every sentence to the grounder; any other word in first position is read as a
// name, and so is every capital further in.
const SENTENCE_OPENERS = new Set([
  // FR
  'le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux',
  'ce', 'cet', 'cette', 'ces', 'celui', 'celle', 'ceux', 'celles', 'cela', 'ça', 'ca', 'c',
  'il', 'elle', 'ils', 'elles', 'on', 'nous', 'vous', 'je', 'tu', 'y',
  'son', 'sa', 'ses', 'leur', 'leurs', 'notre', 'nos', 'votre', 'vos', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes',
  'en', 'dans', 'pour', 'par', 'sur', 'sous', 'avec', 'sans', 'mais', 'et', 'ou', 'où', 'donc', 'car', 'ni', 'si',
  'quand', 'lorsque', 'comme', 'puis', 'ensuite', 'enfin', 'alors', 'ainsi', 'aussi',
  'depuis', 'après', 'apres', 'avant', 'pendant', 'malgré', 'malgre', 'contre', 'entre', 'vers', 'chez', 'selon',
  'que', 'qui', 'quoi', 'dont', 'tout', 'tous', 'toute', 'toutes', 'chaque', 'chacun',
  'plusieurs', 'certains', 'certaines', 'beaucoup', 'peu', 'plus', 'moins', 'autre', 'autres', 'même', 'meme',
  'encore', 'déjà', 'deja', 'pourtant', 'cependant', 'toutefois', 'néanmoins', 'neanmoins',
  'désormais', 'desormais', 'aujourd', 'hier', 'demain', 'ici', 'là', 'voici', 'voilà', 'voila',
  'rien', 'personne', 'jamais', 'toujours', 'souvent', 'parfois', 'sinon', 'or',
  // EN
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its', 'they', 'their', 'them', 'there',
  'he', 'she', 'we', 'you', 'i', 'his', 'her', 'our', 'your', 'my',
  'in', 'on', 'at', 'for', 'with', 'from', 'by', 'to', 'but', 'and', 'so', 'because', 'if', 'when', 'as',
  'after', 'before', 'during', 'since', 'while', 'however', 'meanwhile', 'also', 'then', 'thus', 'now',
  'today', 'yesterday', 'tomorrow', 'most', 'many', 'some', 'few', 'all', 'each', 'every', 'no', 'not',
  'both', 'more', 'less', 'other', 'another', 'what', 'which', 'who', 'whose', 'according', 'still', 'yet',
  'even', 'only', 'just', 'once', 'again', 'here',
])

// One word. An apostrophe ends it, so "L'Europe" yields "Europe" as its own
// token; a hyphen stays inside it ("États-Unis", "GPT-5").
const WORD = /\p{L}[\p{L}\p{M}\p{N}]*(?:-[\p{L}\p{M}\p{N}]+)*/gu

// The capitalized words of a text that name something. Whether the name appears
// in the evidence is deliberately not consulted: a name the evidence never
// mentions is the most dangerous sentence there is, so shape alone decides.
export function entityTokens(text: string): string[] {
  const out: string[] = []
  for (const sentence of splitSentences(text)) {
    const words = sentence.match(WORD) ?? []
    words.forEach((word, i) => {
      if (!/^\p{Lu}/u.test(word)) return
      if (i === 0 && SENTENCE_OPENERS.has(word.toLowerCase())) return
      out.push(word)
    })
  }
  return out
}

// Only sentences carrying checkable content reach the grounding model: digits,
// quotes, percentages, a name, or a known entity of the story written in
// lowercase (which no capital would reveal).
export function isCheckable(sentence: string, entities: string[]): boolean {
  if (/\d/.test(sentence)) return true
  if (/[«»"“”]/.test(sentence)) return true
  if (/\bpour cent\b|%/.test(sentence)) return true
  if (entityTokens(sentence).length > 0) return true
  const lower = sentence.toLowerCase()
  return entities.some((e) => e.length > 3 && lower.includes(e.toLowerCase()))
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
