import { and, eq, inArray, ne } from 'drizzle-orm'
import { TTS_USD_PER_1K_CHARS } from '../config.js'
import { assemble } from '../audio/assemble.js'
import { entityTokens } from '../core/sentences.js'
import { ScriptSchema } from '../core/types.js'
import type { Db } from '../db/client.js'
import { episodes, explainedConcepts, stories, users } from '../db/schema.js'
import { logger } from '../log.js'
import { DEFAULT_TTS_MODEL, elevenlabs } from '../speech/elevenlabs.js'
import type { Storage } from '../storage/index.js'

// Chapters keep their own object so a single bad chapter can be re-synthesized
// without paying for the whole episode again (ARCHITECTURE §5.8).
export function chapterKey(episodeId: string, index: number): string {
  return `episodes/${episodeId}/chapters/${String(index).padStart(2, '0')}.mp3`
}

export function episodeAudioKey(episodeId: string): string {
  return `episodes/${episodeId}/episode.mp3`
}

// The LLM ledger is stored flat on episodes.cost, one entry per stage. Anything
// carrying a numeric usd is a stage; the tts_* keys added below are not.
function llmUsd(cost: Record<string, unknown>): number {
  let sum = 0
  for (const entry of Object.values(cost)) {
    if (entry && typeof entry === 'object' && 'usd' in entry) {
      const usd = (entry as { usd: unknown }).usd
      if (typeof usd === 'number') sum += usd
    }
  }
  return sum
}

function existingCost(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

// stories.claims is jsonb: the shape is whatever an older run wrote, so the
// texts are picked out rather than cast into.
function claimTexts(claims: unknown): string[] {
  if (!Array.isArray(claims)) return []
  const out: string[] = []
  for (const claim of claims) {
    if (claim && typeof claim === 'object' && typeof (claim as { text?: unknown }).text === 'string') {
      out.push((claim as { text: string }).text)
    }
  }
  return out
}

const MAX_CONCEPTS = 12
// An initial from an abbreviation ("M.", "J.") is capitalised and named-shaped
// but is not a concept; nothing shorter carries one either.
const MIN_CONCEPT_LENGTH = 3

// Anti-repetition memory for the next episode (ARCHITECTURE §5.7), derived from
// the evidence the episode was built on with no extra model call. What counts as
// a name is the grounder's own rule, so the two never drift apart. The list is a
// hint to the writer, so a stray word costs nothing and a missed one costs little.
export function conceptsFromClaims(texts: readonly string[]): string[] {
  const seen = new Map<string, { concept: string; count: number }>()
  for (const text of texts) {
    for (const concept of entityTokens(text)) {
      if (concept.length < MIN_CONCEPT_LENGTH) continue
      const key = concept.toLowerCase()
      const hit = seen.get(key)
      if (hit) hit.count++
      else seen.set(key, { concept, count: 1 })
    }
  }
  // Bounded on purpose: this list is pasted into two prompts, and a long tail of
  // one-off names would crowd out what the episode really explained. Sort is
  // stable, so equal counts keep first-seen order.
  return [...seen.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_CONCEPTS)
    .map((e) => e.concept)
}

// Once the row says ready the episode is produced and stored, so nothing left to
// do may fail it. Each bookkeeping step is guarded on its own and only logged.
async function afterReady(episodeId: string, step: string, work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (err) {
    logger.error({ episodeId, step, err }, 'episode published but post-publish step failed')
  }
}

// tts (per chapter) -> assemble -> ready (ARCHITECTURE §5.8-5.9). Reads the
// script written by generateEpisode; all IO lives here, none in the stages.
export async function publishEpisode(
  db: Db,
  storage: Storage,
  episodeId: string,
): Promise<{ audioUrl: string; durationSec: number; chars: number }> {
  // 'publish' covers the pre-flight reads: they happen inside the try so a
  // publish-time refusal is recorded as one instead of being attributed to
  // whatever the caller assumes failed.
  let stage: 'publish' | 'tts' | 'assembling' = 'publish'
  try {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId))
    if (!episode) throw new Error(`episode ${episodeId} not found`)
    if (!episode.script) throw new Error(`episode ${episodeId} has no script: run generateEpisode first`)
    const parsed = ScriptSchema.safeParse(episode.script)
    if (!parsed.success) {
      throw new Error(`episode ${episodeId} has an unusable script: ${parsed.error.message.slice(0, 300)}`)
    }

    stage = 'tts'
    const [user] = await db
      .select({ voiceId: users.voiceId })
      .from(users)
      .where(eq(users.id, episode.userId))
    const voiceId = user?.voiceId ?? process.env.ELEVENLABS_VOICE_ID
    if (!voiceId) {
      throw new Error(`no voice for episode ${episodeId}: set users.voice_id or ELEVENLABS_VOICE_ID`)
    }

    // Empty chapters are refused rather than skipped: a chapter's index is its
    // storage key, so dropping one would silently renumber the rest.
    const chapters = parsed.data.chapters.map((c) => ({ title: c.title, text: c.text.trim() }))
    if (chapters.length === 0) throw new Error(`episode ${episodeId} has an empty script`)
    const blank = chapters.find((c) => c.text.length === 0)
    if (blank) throw new Error(`episode ${episodeId}: chapter "${blank.title}" has no text to synthesize`)

    await db.update(episodes).set({ status: 'tts' }).where(eq(episodes.id, episodeId))
    const rendered = await elevenlabs.synthesize(chapters, { voiceId, modelId: DEFAULT_TTS_MODEL })
    for (const chapter of rendered) {
      await storage.put(chapterKey(episodeId, chapter.index), chapter.audio, 'audio/mpeg')
    }
    const chars = rendered.reduce((n, c) => n + c.chars, 0)

    stage = 'assembling'
    await db.update(episodes).set({ status: 'assembling' }).where(eq(episodes.id, episodeId))
    const { audio, durationSec, method } = assemble(rendered.map((c) => c.audio))
    const key = episodeAudioKey(episodeId)
    await storage.put(key, audio, 'audio/mpeg')
    const audioUrl = storage.publicUrl(key)

    const previous = existingCost(episode.cost)
    const ttsUsd = (chars / 1000) * TTS_USD_PER_1K_CHARS
    const cost = {
      ...previous,
      tts_chars: chars,
      tts_usd: ttsUsd,
      total_usd: llmUsd(previous) + ttsUsd,
    }
    await db
      .update(episodes)
      .set({ status: 'ready', audioUrl, actualSec: durationSec, audioBytes: audio.length, cost, error: null })
      .where(eq(episodes.id, episodeId))

    // Stories are consumed only once the audio exists: a TTS or assembly failure
    // must leave them available for the next episode instead of burning them.
    const storyIds = episode.storyIds
    if (storyIds.length > 0) {
      await afterReady(episodeId, 'stories aired', async () => {
        await db.update(stories).set({ status: 'aired' }).where(inArray(stories.id, storyIds))
      })
      await afterReady(episodeId, 'explained concepts', async () => {
        const aired = await db
          .select({ claims: stories.claims })
          .from(stories)
          .where(inArray(stories.id, storyIds))
        const concepts = conceptsFromClaims(aired.flatMap((s) => claimTexts(s.claims)))
        if (concepts.length === 0) return
        const lastExplainedAt = new Date()
        await db
          .insert(explainedConcepts)
          .values(concepts.map((concept) => ({ userId: episode.userId, concept, lastExplainedAt, episodeId })))
          .onConflictDoUpdate({
            target: [explainedConcepts.userId, explainedConcepts.concept],
            set: { lastExplainedAt, episodeId },
          })
      })
    }

    logger.info(
      { episodeId, chapters: rendered.length, chars, durationSec, method, voiceId, model: DEFAULT_TTS_MODEL },
      'episode published',
    )
    return { audioUrl, durationSec, chars }
  } catch (err) {
    // ne(ready) is the last guard on the same promise as afterReady: an episode
    // whose audio is stored and served must never be walked back to failed.
    await db
      .update(episodes)
      .set({ status: 'failed', failedStage: stage, error: err instanceof Error ? err.message : String(err) })
      .where(and(eq(episodes.id, episodeId), ne(episodes.status, 'ready')))
    // The Error object (not its string) so pino serializes the stack.
    logger.error({ episodeId, stage, err }, 'publishEpisode failed')
    throw err
  }
}
