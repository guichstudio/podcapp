// One frontier pass over the whole script: rhythm and repetition only. The
// regex blocklist runs before this, in code, for free.

export const EDIT_V1_SYSTEM = `You are the final editor of a briefing script that will be read aloud. You improve how it sounds. You do not change what it says.

ABSOLUTE RULE: every number, proper noun, quote, attribution and hedge stays byte-identical. If you cannot improve a sentence without touching a fact, leave it exactly as it is.

What to fix:
- Repetition: the same word, construction or transition reused across chapters.
- Rhythm: sentences too uniform in length, or too long to say in one breath.
- Transitions between chapters: they should follow, not announce ("Passons maintenant à").
- Filler and AI tells: rhetorical questions, "il est important de noter", "véritable révolution", "force est de constater", "dans un monde en constante évolution", "plongeons", "en bref", "au final".
- Anything unpronounceable: symbols, markdown, abbreviations a voice would stumble on, em dashes.

Return ONLY: {"chapters": [{"title": "<unchanged>", "text": "<edited prose>"}]}
Return every chapter you receive, in the same order, with the same titles.`

export function editV1User(input: { language: string; chapters: { title: string; text: string }[] }): string {
  return `language: ${input.language}

SCRIPT:
${JSON.stringify(input.chapters, null, 1)}`
}

// EN + FR, two groups with different powers.

// Whole filler clauses, deleted in code before the model pass: they carry no
// meaning, so the editor can smooth what is left without knowing what was cut.
export const BLOCKLIST_STRIP: RegExp[] = [
  /let'?s dive in/gi,
  /it'?s important to note/gi,
  /in today'?s fast-paced world/gi,
  /here'?s the thing/gi,
  /buckle up/gi,
  /il est important de noter/gi,
  /dans un monde en constante évolution/gi,
  /force est de constater/gi,
  /sans plus attendre/gi,
]

// Counted but never deleted: these are single words (or a content-bearing noun
// phrase) sitting inside a clause, so excising them leaves a sentence the model
// cannot repair, since it only ever sees the mutilated version. Rewriting them
// is the model editor's job; here they only feed the metric.
export const BLOCKLIST_FLAG: RegExp[] = [
  /game-changer/gi,
  /fascinating/gi,
  /plongeons/gi,
  /véritable révolution/gi,
  /accrochez-vous/gi,
  /décryptage/gi,
]

// Every banned formula, stripped or not: the metric stays honest about what
// actually survived into the script.
export const BLOCKLIST: RegExp[] = [...BLOCKLIST_STRIP, ...BLOCKLIST_FLAG]

export function blocklistHits(text: string): string[] {
  const hits: string[] = []
  for (const re of BLOCKLIST) {
    const found = text.match(re)
    if (found) hits.push(...found)
  }
  return hits
}
