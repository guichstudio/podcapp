import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { INTRO_OUTRO_SEC, PROMPT_VERSIONS, WORDS_PER_MINUTE } from '../config.js'
import { countWords, entityTokens, isCheckable, splitSentences } from '../core/sentences.js'
import { OutlineSchema, type Claim, type Outline, type Script } from '../core/types.js'
import type { Db } from '../db/client.js'
import { episodes, explainedConcepts, sources, stories } from '../db/schema.js'
import { callStructured, type CostLedger } from '../llm/index.js'
import { logger } from '../log.js'
import { BLOCKLIST_STRIP, EDIT_V1_SYSTEM, blocklistHits, editV1User } from '../prompts/edit.v1.js'
import { EDITORIAL_V1_SYSTEM, editorialV1User, type EditorialStoryDigest } from '../prompts/editorial.v1.js'
import { GROUNDING_V1_SYSTEM, groundingV1User } from '../prompts/grounding.v1.js'
import { INTRO_OUTRO_V1_SYSTEM, WRITER_V1_SYSTEM, introOutroV1User, writerV1User } from '../prompts/writer.v1.js'
import type { Storage } from '../storage/index.js'
import { persistRunArtifacts } from './runArtifacts.js'

const TextSchema = z.object({ text: z.string().min(1) })
const GroundingSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int(),
      supported: z.boolean(),
      claim_refs: z.array(z.string()).default([]),
      fix: z.string().optional(),
    }),
  ),
})
const EditSchema = z.object({ chapters: z.array(z.object({ title: z.string(), text: z.string() })) })

// Only the fields the rebuild reads, so a verdict from either grounding call
// (first pass or retry) fits without depending on zod's default-widened shape.
type GroundingVerdict = { index: number; supported: boolean; fix?: string | undefined }

export interface GroundingEntry {
  chapter: string
  sentence: string
  supported: boolean
  // 'dropped_no_verdict': the grounding model never judged it, even on retry.
  action: 'kept' | 'fixed' | 'dropped' | 'dropped_no_verdict'
  fix?: string
}

export interface EpisodeArtifacts {
  outline: Outline
  drafts: { title: string; text: string }[]
  grounding: GroundingEntry[]
  script: Script
  metrics: {
    target_sec: number
    estimated_sec: number
    words: number
    sentences_checked: number
    unsupported_found: number
    unsupported_shipped: number
    edits_rejected: number
    blocklist_hits: string[]
    cost: CostLedger
    // Set only when the run threw: these artifacts are then a partial record.
    error?: string
  }
}

// Only whole filler clauses are cut here; single words (BLOCKLIST_FLAG) are left
// to the model editor, which needs the original sentence to repair one. Cutting a
// clause leaves debris: the subordinating conjunction it introduced ("il est
// important de noter QUE le marché a doublé"), or a dangling comma. A speech
// engine reads out loud whatever is left, so the conjunction goes with the clause
// and the seam is repaired here.
const STRIP_CLAUSE = BLOCKLIST_STRIP.map(
  (re) => new RegExp(`(?:${re.source})[\\s,;:]*(?:qu['’]|que\\b|that\\b)?`, re.flags),
)
// Below this, what survived the cut is a fragment, not a sentence, and it is
// dropped rather than spoken.
const MIN_SENTENCE_WORDS = 3

function repairSeam(text: string): string {
  const cleaned = text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?…»])/g, '$1')
    .replace(/([,;:])(\s*[.!?…])/g, '$2')
    .replace(/^[\s,;:.!?…]+/, '')
    .trim()
  return cleaned.replace(/^\p{Ll}/u, (c) => c.toUpperCase())
}

export function stripBlocklist(text: string): string {
  const kept: string[] = []
  for (const sentence of splitSentences(text)) {
    let stripped = sentence
    for (const re of STRIP_CLAUSE) stripped = stripped.replace(re, ' ')
    if (stripped === sentence) {
      kept.push(sentence)
      continue
    }
    const repaired = repairSeam(stripped)
    if (countWords(repaired) < MIN_SENTENCE_WORDS) continue
    kept.push(repaired)
  }
  return kept.join(' ')
}

// --- Edit guard -------------------------------------------------------------
// The editor is told to keep every fact byte-identical and nothing checked that
// it did, so "environ 100 millions" could quietly become "100 millions". Running
// the grounder again on the edited text would re-litigate settled sentences, so
// the check is deterministic instead: during the edit the facts of a chapter may
// disappear, never appear.

const NUMBER_WORD =
  'zéro|zero|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|trente|quarante|cinquante|soixante|cents?|milliers?|mille|millions?|milliards?|demi|moitié|moitie|tiers|quart|double|triple|two|three|four|five|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|billions?|trillions?|half'
const NUMBER_UNIT =
  'pour cent|pourcent|per cent|percent|millions?|milliards?|milliers?|billions?|trillions?|thousands?|euros?|dollars?|points?|années?|annees?|ans?|mois|semaines?|jours?|heures?|minutes?|secondes?|fois|years?|months?|weeks?|days?|hours?|times'
const NUMBER_RUN = new RegExp(
  `(?:\\d+(?:[.,\\u202f\\u00a0 ]\\d+)*|\\b(?:${NUMBER_WORD})\\b)` +
    `(?:[\\s-]+(?:\\b(?:${NUMBER_WORD})\\b|\\d+))*` +
    `(?:\\s*%|\\s+(?:${NUMBER_UNIT})(?![\\p{L}]))?`,
  'giu',
)
const QUOTED = /«([^»]{2,})»|“([^”]{2,})”|"([^"]{2,})"/g
// A number stated with a hedge and repeated without one is a fact the listener
// would hear as harder than the evidence makes it.
const HEDGE =
  /(?:environ|pres de|plus de|moins de|quelque|quelques|autour de|presque|a peu pres|jusqu a|au moins|au plus|about|around|roughly|nearly|almost|more than|less than|over|under|up to|at least|some)\s*$/

function deburr(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function normalizeWords(text: string): string {
  return deburr(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Accents, case, punctuation and plurals drift when prose is reworked; the fact
// underneath does not. Only for comparing facts: stripping plurals also strips
// the "s" of "plus", which is why the hedge context is matched unstemmed.
function normalizeFact(text: string): string {
  return normalizeWords(text)
    .split(' ')
    .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
    .join(' ')
}

export interface FactSet {
  entities: string[]
  numbers: string[]
  hedged: string[]
  quotes: string[]
}

export function factsOf(text: string): FactSet {
  const numbers: string[] = []
  const hedged: string[] = []
  for (const match of text.matchAll(NUMBER_RUN)) {
    const value = match[0].trim()
    if (!value) continue
    numbers.push(value)
    if (HEDGE.test(normalizeWords(text.slice(0, match.index ?? 0)))) hedged.push(value)
  }
  // FR quotes carry inner spaces («  » ), which are typography, not content.
  const quotes = [...text.matchAll(QUOTED)].map((m) => (m[1] ?? m[2] ?? m[3] ?? '').trim()).filter(Boolean)
  return { entities: entityTokens(text), numbers, hedged, quotes }
}

// Returns why the edit must be rejected, or null when it only changed the prose.
export function editDrift(preEdit: string, edited: string): string | null {
  const before = factsOf(preEdit)
  const after = factsOf(edited)
  const keys = (values: string[]): Set<string> => new Set(values.map(normalizeFact))
  const reasons: string[] = []
  // Names and quotes are checked against the whole pre-edit text, not against
  // its own name list: splitting a sentence promotes an ordinary word to first
  // position, where it looks like a name without being new.
  const source = ` ${normalizeFact(preEdit)} `
  const absent = (values: string[], label: string): void => {
    for (const value of values) {
      if (!source.includes(` ${normalizeFact(value)} `)) reasons.push(`${label} "${value}"`)
    }
  }
  absent(after.entities, 'name')
  absent(after.quotes, 'quote')
  const beforeNumbers = keys(before.numbers)
  for (const value of after.numbers) {
    if (!beforeNumbers.has(normalizeFact(value))) reasons.push(`number "${value}"`)
  }
  const afterNumbers = keys(after.numbers)
  const afterHedged = keys(after.hedged)
  for (const number of before.hedged) {
    const key = normalizeFact(number)
    if (afterNumbers.has(key) && !afterHedged.has(key)) reasons.push(`hedge dropped on "${number}"`)
  }
  return reasons.length > 0 ? [...new Set(reasons)].slice(0, 5).join(', ') : null
}

// Titles are not identifiers: two sections can share one, and the editor
// sometimes rewrites them. Position is the only reliable link back.
export function mergeEditedChapters(
  preEdit: readonly { title: string; text: string }[],
  edited: readonly { title: string; text: string }[],
): { texts: string[]; rejected: number } {
  if (edited.length !== preEdit.length) {
    throw new Error(`edit pass returned ${edited.length} chapters for ${preEdit.length} sent`)
  }
  let rejected = 0
  const texts = preEdit.map((chapter, i) => {
    const editedChapter = edited[i]
    if (editedChapter && editedChapter.title !== chapter.title) {
      logger.warn(
        { index: i, sent: chapter.title, returned: editedChapter.title },
        'edit pass renamed a chapter, matching by position',
      )
    }
    const text = editedChapter?.text.trim()
    if (!text) return chapter.text
    const drift = editDrift(chapter.text, text)
    if (drift) {
      rejected++
      logger.warn({ chapter: chapter.title, drift }, 'edit pass changed the facts, keeping the grounded text')
      return chapter.text
    }
    return text
  })
  return { texts, rejected }
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// The accuracy gate, measured on what is actually about to be spoken. A
// checkable sentence ships verified only when the grounder explicitly supported
// it: either in its own words, or through the fix it wrote to replace them. The
// editor is allowed to reword, so a final sentence also passes when every fact
// it carries comes from that supported set. Everything else counts here: a
// sentence the editor invented, one that never got a verdict, an intro line no
// evidence backs.
export function countUnsupportedShipped(
  entries: readonly GroundingEntry[],
  chapters: readonly { text: string; entities: string[] }[],
): number {
  const supported: string[] = []
  for (const entry of entries) {
    if (entry.action === 'kept') supported.push(entry.sentence)
    else if (entry.action === 'fixed' && entry.fix) supported.push(entry.fix)
  }
  const haystack = ` ${supported.map(normalizeForMatch).join(' ')} `
  let shipped = 0
  for (const chapter of chapters) {
    for (const sentence of splitSentences(chapter.text)) {
      if (!isCheckable(sentence, chapter.entities)) continue
      const needle = normalizeForMatch(sentence)
      if (needle && haystack.includes(` ${needle} `)) continue
      const facts = factsOf(sentence)
      const carried = [...facts.numbers, ...facts.quotes, ...facts.entities].map(normalizeForMatch).filter(Boolean)
      if (carried.length > 0 && carried.every((fact) => haystack.includes(` ${fact} `))) continue
      shipped++
    }
  }
  return shipped
}

const EMPTY_OUTLINE: Outline = { intro: '', sections: [], discarded: [], outro: '' }

// Everything the run has produced so far. Kept outside the stages so a throw can
// still persist it: the expensive failures are the late ones.
interface RunState {
  outline?: Outline
  drafts: { title: string; text: string }[]
  grounding: GroundingEntry[]
  script?: Script
  sentencesChecked: number
  unsupportedFound: number
  unsupportedShipped: number
  editsRejected: number
}

function artifactsFrom(run: RunState, targetSec: number, ledger: CostLedger, error?: string): EpisodeArtifacts {
  const script = run.script ?? { chapters: [] }
  const fullText = script.chapters.map((c) => c.text).join('\n\n')
  const words = countWords(fullText)
  return {
    outline: run.outline ?? EMPTY_OUTLINE,
    drafts: run.drafts,
    grounding: run.grounding,
    script,
    metrics: {
      target_sec: targetSec,
      estimated_sec: Math.round((words / WORDS_PER_MINUTE) * 60),
      words,
      sentences_checked: run.sentencesChecked,
      unsupported_found: run.unsupportedFound,
      unsupported_shipped: run.unsupportedShipped,
      edits_rejected: run.editsRejected,
      blocklist_hits: blocklistHits(fullText),
      cost: ledger,
      ...(error ? { error } : {}),
    },
  }
}

// select+outline -> write per section -> ground -> edit.
// Pure-ish: reads the DB, writes artifacts back to the episode row, returns
// everything the debug endpoint and the eval runner need.
export async function generateEpisode(
  db: Db,
  opts: { userId: string; targetSec: number; language?: string; episodeId?: string; storage?: Storage },
  ledger: CostLedger = {},
): Promise<EpisodeArtifacts> {
  const run: RunState = {
    drafts: [],
    grounding: [],
    sentencesChecked: 0,
    unsupportedFound: 0,
    unsupportedShipped: 0,
    editsRejected: 0,
  }
  try {
    return await runEpisode(db, opts, ledger, run)
  } catch (err) {
    // A late throw (the chapter-count mismatch fires after the outline, the
    // writing, the grounding and the edit pass have all been paid for) would
    // otherwise lose the only record of the most expensive failures.
    if (opts.episodeId && opts.storage) {
      try {
        await persistRunArtifacts(opts.storage, opts.episodeId, artifactsFrom(run, opts.targetSec, ledger, String(err)))
      } catch (persistErr) {
        logger.error({ episodeId: opts.episodeId, err: String(persistErr) }, 'could not persist a failed run')
      }
    }
    throw err
  }
}

async function runEpisode(
  db: Db,
  opts: { userId: string; targetSec: number; language?: string; episodeId?: string; storage?: Storage },
  ledger: CostLedger,
  run: RunState,
): Promise<EpisodeArtifacts> {
  const language = opts.language ?? 'fr'
  const open = await db
    .select()
    .from(stories)
    .where(and(eq(stories.userId, opts.userId), eq(stories.status, 'open')))
    .orderBy(desc(stories.lastSeenAt))
  if (open.length === 0) throw new Error('no open stories to build an episode from')

  const recent = await db
    .select({ title: episodes.title })
    .from(episodes)
    .where(and(eq(episodes.userId, opts.userId), eq(episodes.status, 'ready')))
    .orderBy(desc(episodes.createdAt))
    .limit(5)
  const explained = await db
    .select({ concept: explainedConcepts.concept })
    .from(explainedConcepts)
    .where(eq(explainedConcepts.userId, opts.userId))

  // 1. select + outline
  const digests: EditorialStoryDigest[] = open.map((s) => {
    const claims = s.claims as Claim[]
    return {
      story_id: s.id,
      headline: s.headline,
      topic: s.topic,
      source_count: s.sourceIds.length,
      claim_count: claims.length,
      top_claims: claims.slice(0, 6).map((c) => c.text),
      captured: s.lastSeenAt.toISOString().slice(0, 10),
    }
  })
  const outline = await callStructured(
    'editorial',
    OutlineSchema,
    {
      // Reasoning stage: thinking tokens come out of the same budget as the answer.
      maxTokens: 32_000,
      system: EDITORIAL_V1_SYSTEM,
      user: editorialV1User({
        target_sec: opts.targetSec,
        language,
        stories: digests,
        recent_episodes: recent.map((r) => r.title ?? '').filter(Boolean),
        explained_concepts: explained.map((e) => e.concept),
      }),
    },
    ledger,
  )
  run.outline = outline
  const byId = new Map(open.map((s) => [s.id, s]))
  const sections = outline.sections.filter((s) => byId.has(s.story_id))
  if (sections.length === 0) {
    logger.error(
      {
        returnedSections: outline.sections.map((s) => ({ id: s.story_id, title: s.title })),
        discarded: outline.discarded.length,
        knownIds: open.slice(0, 3).map((s) => s.id),
      },
      'outline selected no known story',
    )
    throw new Error(
      `outline selected no known story (${outline.sections.length} sections returned, ${outline.discarded.length} discarded)`,
    )
  }
  logger.info({ sections: sections.length, discarded: outline.discarded.length }, 'outline ready')

  // 2. write, per section, evidence-scoped
  const drafts: { title: string; text: string; storyId: string }[] = []
  for (const section of sections) {
    const story = byId.get(section.story_id)
    if (!story) continue
    const claims = story.claims as Claim[]
    const written = await callStructured(
      'write',
      TextSchema,
      {
        maxTokens: 4096,
        system: WRITER_V1_SYSTEM,
        user: writerV1User({
          language,
          angle: section.angle,
          why_it_matters: section.why_it_matters,
          new_information: section.new_information,
          transition_hint: section.transition_hint,
          airtime_sec: section.airtime_sec,
          evidence: claims.map((c) => ({
            text: c.text,
            type: c.type,
            evidence_quote: c.evidence_quote,
            confidence: c.confidence,
          })),
          already_explained: explained.map((e) => e.concept),
        }),
      },
      ledger,
    )
    drafts.push({ title: section.title, text: written.text, storyId: story.id })
    run.drafts.push({ title: section.title, text: written.text })
  }

  // 3. ground each chapter against its own evidence. Every chapter goes through
  // this, intro and outro included: what is never checked is what ships wrong.
  const groundChapter = async (
    chapter: string,
    text: string,
    evidence: { text: string; evidence_quote: string }[],
    entities: string[],
  ): Promise<string> => {
    const allSentences = splitSentences(text)
    const checkable = allSentences
      .map((sentence, index) => ({ index, text: sentence }))
      .filter((s) => isCheckable(s.text, entities))
    if (checkable.length === 0) return text
    const byIndex = new Map<number, GroundingVerdict>()
    const ground = async (sentences: { index: number; text: string }[]): Promise<void> => {
      const verdicts = await callStructured(
        'ground',
        GroundingSchema,
        { maxTokens: 8192, system: GROUNDING_V1_SYSTEM, user: groundingV1User({ sentences, evidence }) },
        ledger,
      )
      for (const verdict of verdicts.results) {
        if (!byIndex.has(verdict.index)) byIndex.set(verdict.index, verdict)
      }
    }
    await ground(checkable)
    // The model can return fewer verdicts than the sentences it was sent. Those
    // sentences are unverified, never silently supported: retry them once, then
    // drop whatever is still unjudged.
    const missing = checkable.filter((s) => !byIndex.has(s.index))
    if (missing.length > 0) {
      logger.warn(
        { chapter, sent: checkable.length, missing: missing.length },
        'grounding returned no verdict for some sentences, retrying the missing ones',
      )
      await ground(missing)
    }
    const checkableIndexes = new Set(checkable.map((s) => s.index))
    const rebuilt: string[] = []
    allSentences.forEach((sentence, index) => {
      if (!checkableIndexes.has(index)) {
        rebuilt.push(sentence)
        return
      }
      const verdict = byIndex.get(index)
      if (!verdict) {
        run.unsupportedFound++
        logger.warn({ chapter, sentence }, 'no grounding verdict after retry, dropping the sentence')
        run.grounding.push({ chapter, sentence, supported: false, action: 'dropped_no_verdict' })
        return
      }
      run.sentencesChecked++
      if (verdict.supported) {
        run.grounding.push({ chapter, sentence, supported: true, action: 'kept' })
        rebuilt.push(sentence)
        return
      }
      run.unsupportedFound++
      const fix = verdict.fix?.trim()
      if (fix) {
        run.grounding.push({ chapter, sentence, supported: false, action: 'fixed', fix })
        rebuilt.push(fix)
      } else {
        run.grounding.push({ chapter, sentence, supported: false, action: 'dropped' })
      }
    })
    return rebuilt.join(' ')
  }

  const claimsOf = (storyId: string): Claim[] => (byId.get(storyId)?.claims ?? []) as Claim[]
  const evidenceOf = (claims: Claim[]): { text: string; evidence_quote: string }[] =>
    claims.map((c) => ({ text: c.text, evidence_quote: c.evidence_quote }))
  // The names the analyzer left inside the claims, for the sentences that use
  // one without a capital.
  const entitiesOf = (claims: Claim[]): string[] => claims.flatMap((c) => entityTokens(c.text))

  const groundedDrafts: typeof drafts = []
  for (const draft of drafts) {
    const claims = claimsOf(draft.storyId)
    const text = await groundChapter(draft.title, draft.text, evidenceOf(claims), entitiesOf(claims))
    groundedDrafts.push({ ...draft, text })
  }
  const noVerdict = run.grounding.filter((g) => g.action === 'dropped_no_verdict').length
  logger.info(
    { sentencesChecked: run.sentencesChecked, unsupportedFound: run.unsupportedFound, noVerdict },
    'grounding done',
  )

  // 4. intro + outro (written after the body: they describe what actually aired)
  const usedSources = await db
    .select({ title: sources.title, url: sources.url, publisher: sources.publisher })
    .from(sources)
    .where(inArray(sources.id, groundedDrafts.flatMap((d) => byId.get(d.storyId)?.sourceIds ?? [])))
  const failed = await db
    .select({ title: sources.title, url: sources.url, status: sources.status })
    .from(sources)
    .where(and(eq(sources.userId, opts.userId), inArray(sources.status, ['extraction_failed', 'low_quality', 'unsupported'])))

  // The outro names publications, not article headlines: prefer an explicit
  // publisher, else the domain, which is what a listener recognizes.
  const sourceNames = usedSources
    .map((s) => {
      if (s.publisher) return s.publisher
      if (s.url) {
        try {
          return new URL(s.url).hostname.replace(/^www\./, '')
        } catch {
          /* fall through to the title */
        }
      }
      return s.title ?? ''
    })
    .filter(Boolean)
  const failedNames = failed.map((s) => s.title ?? s.url ?? '').filter(Boolean)
  const uniqueSourceNames = [...new Set(sourceNames)]
  const shownFailedNames = failedNames.slice(0, 5)
  const today = new Date().toISOString().slice(0, 10)

  const [intro, outro] = await Promise.all([
    callStructured(
      'write',
      TextSchema,
      {
        maxTokens: 1024,
        system: INTRO_OUTRO_V1_SYSTEM,
        user: introOutroV1User({
          kind: 'intro',
          language,
          date: today,
          guidance: outline.intro,
          sections: sections.map((s) => s.title),
          sources: sourceNames,
          failed_sources: [],
        }),
      },
      ledger,
    ),
    callStructured(
      'write',
      TextSchema,
      {
        maxTokens: 1024,
        system: INTRO_OUTRO_V1_SYSTEM,
        user: introOutroV1User({
          kind: 'outro',
          language,
          date: today,
          guidance: outline.outro,
          sections: sections.map((s) => s.title),
          sources: uniqueSourceNames,
          failed_sources: shownFailedNames,
        }),
      },
      ledger,
    ),
  ])

  // The intro is where a framing number gets invented, so it is grounded like
  // any other chapter. Its evidence is what it was written from: the claims that
  // actually aired, plus the facts the pipeline itself knows (the date, the
  // running order, the source names). A sentence no evidence backs does not survive.
  const airedClaims = groundedDrafts.flatMap((d) => claimsOf(d.storyId))
  const airedEvidence = evidenceOf(airedClaims)
  const runEvidence = [
    { text: `episode date: ${today}`, evidence_quote: today },
    ...sections.map((s) => ({ text: `topic in the running order: ${s.title}`, evidence_quote: s.title })),
    ...uniqueSourceNames.map((name) => ({ text: `source used in this episode: ${name}`, evidence_quote: name })),
  ]
  const failedEvidence = shownFailedNames.map((name) => ({
    text: `source discarded, extraction failed: ${name}`,
    evidence_quote: name,
  }))
  const frameEntities = [...entitiesOf(airedClaims), ...uniqueSourceNames, ...shownFailedNames]
  const [groundedIntro, groundedOutro] = await Promise.all([
    groundChapter('Intro', intro.text, [...airedEvidence, ...runEvidence], frameEntities),
    groundChapter('Outro', outro.text, [...airedEvidence, ...runEvidence, ...failedEvidence], frameEntities),
  ])

  // 5. edit: regex blocklist first (free), then one full-script model pass
  const preEdit = [
    { title: 'Intro', text: stripBlocklist(groundedIntro), storyId: null as string | null },
    ...groundedDrafts.map((d) => ({ title: d.title, text: stripBlocklist(d.text), storyId: d.storyId as string | null })),
    { title: 'Outro', text: stripBlocklist(groundedOutro), storyId: null as string | null },
  ].filter((chapter) => chapter.text.trim().length > 0)
  if (preEdit.length === 0) throw new Error('nothing survived grounding: no chapter left to edit')

  const edited = await callStructured(
    'edit',
    EditSchema,
    {
      maxTokens: 16_000,
      system: EDIT_V1_SYSTEM,
      user: editV1User({ language, chapters: preEdit.map((c) => ({ title: c.title, text: c.text })) }),
    },
    ledger,
  )
  const { texts, rejected } = mergeEditedChapters(preEdit, edited.chapters)
  run.editsRejected = rejected

  const script: Script = {
    chapters: preEdit.map((chapter, i) => ({
      story_id: chapter.storyId,
      title: chapter.title,
      text: texts[i] ?? chapter.text,
      source_ids: chapter.storyId ? (byId.get(chapter.storyId)?.sourceIds ?? []) : [],
    })),
  }
  run.script = script

  // Measured with the entity list each chapter was grounded against, so the
  // final check asks exactly the question the grounding stage asked.
  run.unsupportedShipped = countUnsupportedShipped(
    run.grounding,
    script.chapters.map((chapter) => ({
      text: chapter.text,
      entities: chapter.story_id ? entitiesOf(claimsOf(chapter.story_id)) : frameEntities,
    })),
  )
  const artifacts = artifactsFrom(run, opts.targetSec, ledger)

  // Feeds show it, and the editorial stage reads recent titles to avoid serving
  // the same angle twice, so it has to say what this episode actually covered.
  const title = `${today} : ${sections.map((s) => s.title).slice(0, 3).join(', ')}`.slice(0, 140)

  if (opts.episodeId) {
    // Stops at 'editing': publishEpisode owns 'ready', the measured actualSec and
    // the stories it consumed, so a TTS failure never burns them.
    await db
      .update(episodes)
      .set({
        outline,
        script,
        title,
        status: 'editing',
        storyIds: sections.map((s) => s.story_id),
        cost: ledger,
        promptVersions: { ...PROMPT_VERSIONS, editorial: 'v1', writer: 'v1', grounding: 'v1', edit: 'v1' },
      })
      .where(eq(episodes.id, opts.episodeId))
    if (opts.storage) await persistRunArtifacts(opts.storage, opts.episodeId, artifacts)
  }

  logger.info(
    {
      words: artifacts.metrics.words,
      estimated_sec: artifacts.metrics.estimated_sec,
      target: opts.targetSec,
      intro_outro_budget: INTRO_OUTRO_SEC,
      unsupported_shipped: run.unsupportedShipped,
      edits_rejected: run.editsRejected,
    },
    'episode script ready',
  )
  return artifacts
}
