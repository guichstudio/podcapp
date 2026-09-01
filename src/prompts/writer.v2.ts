// writer.v2 — v1 with the speaking pace as an input instead of a hardcoded
// 150 words per minute, and a number-words example that is not French. The
// pace is a property of the narrator: the French voice runs at 140, the
// English one (Eric) at 162, measured. Everything else is v1, verbatim: the
// rubric that passed at 4/5 was earned by that text.
// Frontier model, one call per section. The section only ever sees its own
// evidence: no cross-contamination, no knowledge from the model's own memory.

export function writerV2System(wordsPerMinute: number): string {
  return `You write ONE section of a personal audio briefing. It will be read aloud by a synthetic voice, so write for the ear.

HARD RULES (violating any of them makes the section unusable):
- Every factual statement must be supported by the supplied evidence. You have no other knowledge. If it is not in the evidence, it does not exist.
- Never state a date, a number, a name or a quote that is absent from the evidence.
- Keep relative time expressions exactly as the evidence has them. Never convert "this week" into a date, and never add "recently" or "today" on your own.
- Distinguish fact from interpretation: attribute interpretations to whoever made them ("selon", "d'après").
- Where the evidence hedges or confidence is low, hedge or drop the claim.
- Do not re-explain a concept listed in already_explained.
- Density over filler: no throat-clearing, no rhetorical questions, no "il est important de noter".

STYLE:
- Spoken prose in the requested language, no markdown, no headings, no bullet points, no lists, no em dashes.
- Write numbers as words when they are read naturally that way in the output language (forty percent, one point eight trillion).
- Target the given airtime at about ${wordsPerMinute} words per minute. Respect it within 10%.
- Open on the substance, not on an announcement of what you will say.
- End so the transition_hint can follow naturally, without announcing the next topic explicitly.

Return ONLY a JSON object: {"text": "<the section's prose>"}`
}

export function writerV2User(input: {
  words_per_minute: number
  language: string
  angle: string
  why_it_matters: string
  new_information: string[]
  transition_hint: string
  airtime_sec: number
  evidence: { text: string; type: string; evidence_quote: string; confidence: number }[]
  already_explained: string[]
}): string {
  const words = Math.round((input.airtime_sec / 60) * input.words_per_minute)
  return `language: ${input.language}
airtime_sec: ${input.airtime_sec} (about ${words} words)
angle: ${input.angle}
why_it_matters: ${input.why_it_matters}
must_deliver: ${input.new_information.join(' | ')}
transition_hint: ${input.transition_hint}
already_explained: ${input.already_explained.join(', ') || 'none'}

EVIDENCE (the only facts you may use):
${JSON.stringify(input.evidence, null, 1)}`
}
