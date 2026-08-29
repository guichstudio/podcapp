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

// EN + FR. Deterministic, free, and run before the model pass so the editor
// never has to spend attention on them.
export const BLOCKLIST: RegExp[] = [
  /let'?s dive in/gi,
  /it'?s important to note/gi,
  /in today'?s fast-paced world/gi,
  /here'?s the thing/gi,
  /game-changer/gi,
  /fascinating/gi,
  /buckle up/gi,
  /plongeons/gi,
  /il est important de noter/gi,
  /dans un monde en constante évolution/gi,
  /force est de constater/gi,
  /véritable révolution/gi,
  /sans plus attendre/gi,
  /accrochez-vous/gi,
  /décryptage/gi,
]

export function blocklistHits(text: string): string[] {
  const hits: string[] = []
  for (const re of BLOCKLIST) {
    const found = text.match(re)
    if (found) hits.push(...found)
  }
  return hits
}
