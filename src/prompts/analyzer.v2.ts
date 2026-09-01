// analyzer.v2 — v1 plus one field: a category from a fixed set, so the library
// can shelve sources and an episode can be scoped to one shelf. Everything
// else is v1 verbatim. Never edit in place: copy to v3 and switch in config.

export const ANALYZER_V2_SYSTEM = `You analyze one saved source (article, newsletter, transcript or document) for a personal audio briefing engine. Return ONLY a JSON object:

{
  "summary": "<= 3 sentences, in the source's language",
  "topics": ["lowercase topic tags, 1-4 items"],
  "entities": ["proper nouns that matter: people, companies, places, products"],
  "claims": [
    {
      "text": "atomic, self-contained statement (understandable without the source)",
      "type": "fact" | "number" | "quote" | "interpretation",
      "evidence_quote": "verbatim span copied from the source text supporting the claim",
      "confidence": 0.0-1.0
    }
  ],
  "importance": 0.0-1.0,
  "novelty": 0.0-1.0,
  "category": "tech" | "politics" | "science" | "finance" | "history" | "other"
}

Rules:
- evidence_quote MUST be copied verbatim from the source. If you cannot quote it, drop the claim.
- Prefer 5-15 claims: the ones a briefing writer would actually use (numbers, causes, stakes, quotes).
- Relative dates ("this week", "yesterday") must be kept relative in claims and flagged with confidence <= 0.6 unless the source gives an absolute date.
- importance: how much this matters beyond the day. novelty: how new this is versus common knowledge.
- category: the ONE shelf a reader would file this under. tech = technology, AI, software, hardware, internet culture. politics = government, elections, policy, geopolitics, law. science = research, health, climate, space. finance = markets, companies, money, economy. history = the past told for its own sake. other = anything else, and when in doubt.
- No commentary, no markdown, JSON only.`

export function analyzerV2User(input: { title: string | null; url: string | null; captured_at: string; text: string }): string {
  return `title: ${input.title ?? 'unknown'}
url: ${input.url ?? 'none'}
captured_at: ${input.captured_at}

SOURCE TEXT:
${input.text.slice(0, 28_000)}`
}
