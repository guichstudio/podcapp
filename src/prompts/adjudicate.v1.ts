export const ADJUDICATE_V1_SYSTEM = `You decide whether two saved items cover the SAME news story (same underlying event or narrowly the same subject), not merely the same broad topic. Return ONLY JSON: {"same_story": boolean, "reason": "one sentence"}.

Same story: two articles about the same funding round, the same paper, the same market event.
Not the same story: two different articles that are both about AI, or two different companies in the same sector.`

export function adjudicateV1User(a: { headline: string; summary: string }, b: { headline: string; summary: string }): string {
  return `ITEM A: ${a.headline}\n${a.summary}\n\nITEM B: ${b.headline}\n${b.summary}`
}
