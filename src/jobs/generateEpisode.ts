import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { INTRO_OUTRO_SEC, PROMPT_VERSIONS, WORDS_PER_MINUTE } from '../config.js'
import { countWords, isCheckable, splitSentences } from '../core/sentences.js'
import { OutlineSchema, type Claim, type Outline, type Script } from '../core/types.js'
import type { Db } from '../db/client.js'
import { episodes, explainedConcepts, sources, stories } from '../db/schema.js'
import { callStructured, type CostLedger } from '../llm/index.js'
import { logger } from '../log.js'
import { BLOCKLIST, EDIT_V1_SYSTEM, blocklistHits, editV1User } from '../prompts/edit.v1.js'
import { EDITORIAL_V1_SYSTEM, editorialV1User, type EditorialStoryDigest } from '../prompts/editorial.v1.js'
import { GROUNDING_V1_SYSTEM, groundingV1User } from '../prompts/grounding.v1.js'
import { INTRO_OUTRO_V1_SYSTEM, WRITER_V1_SYSTEM, introOutroV1User, writerV1User } from '../prompts/writer.v1.js'

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

export interface GroundingEntry {
  chapter: string
  sentence: string
  supported: boolean
  action: 'kept' | 'fixed' | 'dropped'
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
    blocklist_hits: string[]
    cost: CostLedger
  }
}

function stripBlocklist(text: string): string {
  let out = text
  for (const re of BLOCKLIST) out = out.replace(re, '')
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim()
}

// select+outline -> write per section -> ground -> edit.
// Pure-ish: reads the DB, writes artifacts back to the episode row, returns
// everything the debug endpoint and the eval runner need.
export async function generateEpisode(
  db: Db,
  opts: { userId: string; targetSec: number; language?: string; episodeId?: string },
  ledger: CostLedger = {},
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
  }

  // 3. ground each section against its own evidence
  const grounding: GroundingEntry[] = []
  let sentencesChecked = 0
  let unsupportedFound = 0
  const groundedDrafts: typeof drafts = []
  for (const draft of drafts) {
    const story = byId.get(draft.storyId)
    const claims = (story?.claims ?? []) as Claim[]
    const analysisEntities = claims.flatMap((c) => c.text.match(/\b[A-ZÉÈÀÇ][\wÀ-ÿ'-]{2,}\b/g) ?? [])
    const allSentences = splitSentences(draft.text)
    const checkable = allSentences
      .map((text, index) => ({ index, text }))
      .filter((s) => isCheckable(s.text, analysisEntities))
    if (checkable.length === 0) {
      groundedDrafts.push(draft)
      continue
    }
    sentencesChecked += checkable.length
    const verdicts = await callStructured(
      'ground',
      GroundingSchema,
      {
        maxTokens: 8192,
        system: GROUNDING_V1_SYSTEM,
        user: groundingV1User({
          sentences: checkable,
          evidence: claims.map((c) => ({ text: c.text, evidence_quote: c.evidence_quote })),
        }),
      },
      ledger,
    )
    const byIndex = new Map(verdicts.results.map((r) => [r.index, r]))
    const rebuilt: string[] = []
    allSentences.forEach((sentence, index) => {
      const verdict = byIndex.get(index)
      if (!verdict || verdict.supported) {
        if (verdict) grounding.push({ chapter: draft.title, sentence, supported: true, action: 'kept' })
        rebuilt.push(sentence)
        return
      }
      unsupportedFound++
      const fix = verdict.fix?.trim()
      if (fix) {
        grounding.push({ chapter: draft.title, sentence, supported: false, action: 'fixed', fix })
        rebuilt.push(fix)
      } else {
        grounding.push({ chapter: draft.title, sentence, supported: false, action: 'dropped' })
      }
    })
    groundedDrafts.push({ ...draft, text: rebuilt.join(' ') })
  }
  logger.info({ sentencesChecked, unsupportedFound }, 'grounding done')

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
          sources: [...new Set(sourceNames)],
          failed_sources: failedNames.slice(0, 5),
        }),
      },
      ledger,
    ),
  ])

  // 5. edit: regex blocklist first (free), then one full-script model pass
  const preEdit = [
    { title: 'Intro', text: stripBlocklist(intro.text) },
    ...groundedDrafts.map((d) => ({ title: d.title, text: stripBlocklist(d.text) })),
    { title: 'Outro', text: stripBlocklist(outro.text) },
  ]
  const edited = await callStructured(
    'edit',
    EditSchema,
    { maxTokens: 16_000, system: EDIT_V1_SYSTEM, user: editV1User({ language, chapters: preEdit }) },
    ledger,
  )
  const editedByTitle = new Map(edited.chapters.map((c) => [c.title, c.text]))

  const script: Script = {
    chapters: preEdit.map((chapter, i) => {
      const isBody = i > 0 && i < preEdit.length - 1
      const draft = isBody ? groundedDrafts[i - 1] : undefined
      return {
        story_id: draft?.storyId ?? null,
        title: chapter.title,
        text: editedByTitle.get(chapter.title) ?? chapter.text,
        source_ids: draft ? (byId.get(draft.storyId)?.sourceIds ?? []) : [],
      }
    }),
  }

  const fullText = script.chapters.map((c) => c.text).join('\n\n')
  const words = countWords(fullText)
  const artifacts: EpisodeArtifacts = {
    outline,
    drafts: drafts.map((d) => ({ title: d.title, text: d.text })),
    grounding,
    script,
    metrics: {
      target_sec: opts.targetSec,
      estimated_sec: Math.round((words / WORDS_PER_MINUTE) * 60),
      words,
      sentences_checked: sentencesChecked,
      unsupported_found: unsupportedFound,
      unsupported_shipped: 0,
      blocklist_hits: blocklistHits(fullText),
      cost: ledger,
    },
  }

  if (opts.episodeId) {
    await db
      .update(episodes)
      .set({
        outline,
        script,
        status: 'ready',
        storyIds: sections.map((s) => s.story_id),
        cost: ledger,
        promptVersions: { ...PROMPT_VERSIONS, editorial: 'v1', writer: 'v1', grounding: 'v1', edit: 'v1' },
        actualSec: artifacts.metrics.estimated_sec,
      })
      .where(eq(episodes.id, opts.episodeId))
    await db.update(stories).set({ status: 'aired' }).where(inArray(stories.id, sections.map((s) => s.story_id)))
  }

  logger.info(
    { words, estimated_sec: artifacts.metrics.estimated_sec, target: opts.targetSec, intro_outro_budget: INTRO_OUTRO_SEC },
    'episode script ready',
  )
  return artifacts
}
