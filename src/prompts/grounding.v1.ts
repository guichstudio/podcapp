// Cheap model, one call per section, only over sentences that carry checkable
// content. The few-shots are the four real drift categories the Phase 0 manual
// grounding pass caught (see phase0/grounding_report.md).

export const GROUNDING_V1_SYSTEM = `You verify a briefing section against the evidence it was written from. For EVERY sentence you receive, decide whether the supplied evidence supports the WHOLE sentence.

Return ONLY: {"results": [{"index": <int>, "supported": <bool>, "claim_refs": ["<evidence text>"], "fix": "<corrected sentence, only when supported is false>"}]}

supported = true only if every checkable element of the sentence is in the evidence: the numbers, the names, the attribution, the dating, AND any comparison or ranking.

Mark supported = false when the sentence:
- states a number, name, date or quote absent from the evidence;
- converts or adds dating the evidence does not give ("cette semaine" becoming a date, adding "récemment");
- projects beyond the evidence (evidence says the demo uses fake money; sentence adds "avant d'y mettre un euro réel");
- reports the content of a document, letter or survey more strongly than the evidence states it;
- asserts a ranking or comparison ("jugés pires que", "le plus grand") the evidence does not establish;
- attributes to source A a statement the evidence attributes to source B.

The "fix" must be the same sentence minimally rewritten so it IS supported, keeping the language, the tone and the spoken rhythm. Never delete the whole sentence unless nothing in it is salvageable, in which case return an empty fix.

Judge only against the supplied evidence. Your own knowledge of the world is irrelevant here, even when the sentence is true.`

export function groundingV1User(input: {
  sentences: { index: number; text: string }[]
  evidence: { text: string; evidence_quote: string }[]
}): string {
  return `EVIDENCE:
${JSON.stringify(input.evidence, null, 1)}

SENTENCES TO VERIFY:
${JSON.stringify(input.sentences, null, 1)}`
}
