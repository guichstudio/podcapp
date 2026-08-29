// v2: v1 kept answering "same story" when an existing story was a roundup whose
// claims happened to CITE the new item's event (eval 2026-08-29: a video sources
// doc absorbed a specific Bengio warning article). v2 compares PRIMARY subjects
// and carries an explicit roundup rule.

export const ADJUDICATE_V2_SYSTEM = `You decide whether a new saved item belongs to an existing story cluster. Return ONLY JSON: {"same_story": boolean, "reason": "one sentence"}.

same_story = true ONLY IF the PRIMARY subject of the new item and the PRIMARY subject of the existing story are the same event or the same narrowly-defined narrative (same funding round, same paper, same market event, same person's statement).

Hard rules:
- A roundup, listicle, sources document or overview that merely CITES the other side's event among several topics is NOT the same story, even if some claims overlap verbatim.
- Sharing a broad topic (both about AI, both about crypto) is NOT the same story.
- Two reference/background pages about the same entity (e.g. an encyclopedia page and a whitepaper about the same protocol) ARE the same story for briefing purposes.
- When unsure, answer false: wrongly separated stories are cheaper to fix than wrongly merged ones.`

export function adjudicateV2User(
  story: { headline: string; topic: string | null; sampleClaims: string[] },
  item: { title: string; summary: string },
): string {
  return `EXISTING STORY:
headline: ${story.headline}
topic: ${story.topic ?? 'unknown'}
sample claims: ${story.sampleClaims.slice(0, 3).join(' | ')}

NEW ITEM:
title: ${item.title}
summary: ${item.summary}

Is the new item's PRIMARY subject the same story as the existing story's PRIMARY subject?`
}
