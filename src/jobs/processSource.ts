import { and, eq, ne, sql } from 'drizzle-orm'
import { MODELS, PROMPT_VERSIONS, SIMILARITY_MERGE, SIMILARITY_REVIEW } from '../config.js'
import { AdjudicationSchema, SourceAnalysisSchema, type Claim, type ExtractResult, type SourceAnalysis } from '../core/types.js'
import type { Db } from '../db/client.js'
import { sources, stories } from '../db/schema.js'
import { canonicalizeUrl, sourceHash } from '../extract/canonical.js'
import { extractEmail } from '../extract/email.js'
import { extractText } from '../extract/text.js'
import { extractWeb } from '../extract/web.js'
import { addCost, callStructured, embed, type CostLedger } from '../llm/index.js'
import { logger } from '../log.js'
import { ADJUDICATE_V1_SYSTEM, adjudicateV1User } from '../prompts/adjudicate.v1.js'
import { ANALYZER_V1_SYSTEM, analyzerV1User } from '../prompts/analyzer.v1.js'

type SourceRow = typeof sources.$inferSelect

async function setStatus(db: Db, id: string, status: string, error?: string): Promise<void> {
  await db.update(sources).set({ status, error: error ?? null }).where(eq(sources.id, id))
}

async function runExtract(row: SourceRow): Promise<ExtractResult> {
  // Eval path: clean_text pre-filled from the cached dataset, extraction already done.
  if (row.cleanText) {
    return { ok: true, extraction: { clean_text: row.cleanText, quality: row.extractionQuality ?? 0.8, raw: row.raw } }
  }
  if (row.type === 'web') {
    if (!row.url) return { ok: false, status: 'extraction_failed', error: 'web source without url' }
    return extractWeb(row.url)
  }
  if (row.type === 'email') {
    const raw = (row.raw ?? {}) as { html?: string; subject?: string }
    if (!raw.html) return { ok: false, status: 'extraction_failed', error: 'email source without html payload' }
    return extractEmail(raw.html, raw.subject)
  }
  const raw = (row.raw ?? {}) as { text?: string }
  return extractText(raw.text ?? '')
}

function mergeClaims(existing: Claim[], incoming: Claim[]): Claim[] {
  const seen = new Set(existing.map((c) => c.text.toLowerCase()))
  return [...existing, ...incoming.filter((c) => !seen.has(c.text.toLowerCase()))]
}

function centroid(vectors: number[][]): number[] {
  const first = vectors[0]
  if (!first) return []
  const acc = new Array<number>(first.length).fill(0)
  for (const v of vectors) for (let i = 0; i < v.length; i++) acc[i] = (acc[i] ?? 0) + (v[i] ?? 0)
  return acc.map((x) => x / vectors.length)
}

async function similarOpenStories(
  db: Db,
  userId: string,
  embedding: number[],
): Promise<{ id: string; similarity: number }[]> {
  const vec = `[${embedding.join(',')}]`
  const res = await db.execute(sql`
    SELECT id, 1 - (embedding <=> ${vec}::vector) AS similarity
    FROM stories
    WHERE user_id = ${userId} AND status = 'open' AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vec}::vector
    LIMIT 5`)
  return res.rows.map((r) => ({ id: String(r.id), similarity: Number(r.similarity) }))
}

async function attachToStory(db: Db, storyId: string, row: SourceRow, analysis: SourceAnalysis, embedding: number[]): Promise<void> {
  const [story] = await db.select().from(stories).where(eq(stories.id, storyId))
  if (!story) throw new Error(`story ${storyId} disappeared`)
  const memberIds = [...story.sourceIds, row.id]
  const members = await db.select({ embedding: sources.embedding }).from(sources).where(sql`id = ANY(${memberIds})`)
  const vectors = members.map((m) => m.embedding).filter((v): v is number[] => Array.isArray(v))
  vectors.push(embedding)
  await db
    .update(stories)
    .set({
      sourceIds: memberIds,
      claims: mergeClaims(story.claims as Claim[], analysis.claims),
      embedding: centroid(vectors),
      lastSeenAt: new Date(),
    })
    .where(eq(stories.id, storyId))
}

async function createStory(db: Db, row: SourceRow, analysis: SourceAnalysis, embedding: number[]): Promise<string> {
  const headline = row.title?.trim() || analysis.summary.split(/(?<=[.!?])\s/)[0] || 'untitled'
  const [created] = await db
    .insert(stories)
    .values({
      userId: row.userId,
      headline,
      topic: analysis.topics[0] ?? null,
      sourceIds: [row.id],
      claims: analysis.claims,
      embedding,
      firstSeenAt: row.capturedAt,
      lastSeenAt: row.capturedAt,
    })
    .returning({ id: stories.id })
  if (!created) throw new Error('story insert returned nothing')
  return created.id
}

export interface ProcessResult {
  sourceId: string
  status: string
  storyId?: string
  clustering?: 'exact_duplicate' | 'merged' | 'adjudicated_merge' | 'adjudicated_new' | 'new'
  error?: string
}

// extract -> analyze -> embed -> dedupe/cluster -> ready.
// Idempotent: every step re-checks state; safe to re-run on any status.
export async function processSource(db: Db, sourceId: string, ledger: CostLedger = {}): Promise<ProcessResult> {
  const [row] = await db.select().from(sources).where(eq(sources.id, sourceId))
  if (!row) throw new Error(`source ${sourceId} not found`)

  // 1. extract
  await setStatus(db, row.id, 'extracting')
  const extracted = await runExtract(row)
  if (!extracted.ok) {
    await setStatus(db, row.id, extracted.status, extracted.error)
    logger.warn({ sourceId, status: extracted.status, error: extracted.error }, 'extraction failed')
    return { sourceId, status: extracted.status, error: extracted.error }
  }
  const ext = extracted.extraction
  const canonical = row.url ? canonicalizeUrl(row.url) : null
  const hash = sourceHash(canonical, ext.clean_text)

  // 2. exact dedupe on (user_id, source_hash)
  const [dupe] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.userId, row.userId), eq(sources.sourceHash, hash), ne(sources.id, row.id)))
  if (dupe) {
    await db.update(sources).set({ status: 'duplicate', sourceHash: hash, error: `duplicate of ${dupe.id}` }).where(eq(sources.id, row.id))
    return { sourceId, status: 'duplicate', clustering: 'exact_duplicate' }
  }

  await db
    .update(sources)
    .set({
      cleanText: ext.clean_text,
      title: row.title ?? ext.title ?? null,
      canonicalUrl: canonical,
      sourceHash: hash,
      extractionQuality: ext.quality,
      lang: row.lang ?? ext.lang ?? null,
      publishedAt: row.publishedAt ?? (ext.published_at ? new Date(ext.published_at) : null),
      raw: row.raw ?? ext.raw ?? null,
    })
    .where(eq(sources.id, row.id))

  // 3. analyze
  const analysis = await callStructured(
    'analyze',
    SourceAnalysisSchema,
    {
      system: ANALYZER_V1_SYSTEM,
      user: analyzerV1User({
        title: row.title ?? ext.title ?? null,
        url: row.url,
        captured_at: row.capturedAt.toISOString(),
        text: ext.clean_text,
      }),
    },
    ledger,
  )
  await db.update(sources).set({ analysis, status: 'analyzed' }).where(eq(sources.id, row.id))

  // 4. embed (summary + topics + head of text: what clustering should compare)
  const embedInput = `${analysis.summary}\ntopics: ${analysis.topics.join(', ')}\n${ext.clean_text.slice(0, 4000)}`
  const { embedding, tokens } = await embed(embedInput)
  addCost(ledger, 'embed', MODELS.embed.model, tokens, 0)
  await db.update(sources).set({ embedding }).where(eq(sources.id, row.id))

  // 5. cluster
  const fresh = { ...row, title: row.title ?? ext.title ?? null }
  const candidates = await similarOpenStories(db, row.userId, embedding)
  const best = candidates[0]
  let storyId: string
  let clustering: ProcessResult['clustering']
  if (best && best.similarity >= SIMILARITY_MERGE) {
    await attachToStory(db, best.id, fresh, analysis, embedding)
    storyId = best.id
    clustering = 'merged'
  } else if (best && best.similarity >= SIMILARITY_REVIEW) {
    const [candidate] = await db.select().from(stories).where(eq(stories.id, best.id))
    const verdict = await callStructured(
      'adjudicate',
      AdjudicationSchema,
      {
        system: ADJUDICATE_V1_SYSTEM,
        user: adjudicateV1User(
          { headline: candidate?.headline ?? '', summary: JSON.stringify((candidate?.claims as Claim[]).slice(0, 5).map((c) => c.text)) },
          { headline: fresh.title ?? '', summary: analysis.summary },
        ),
      },
      ledger,
    )
    if (verdict.same_story) {
      await attachToStory(db, best.id, fresh, analysis, embedding)
      storyId = best.id
      clustering = 'adjudicated_merge'
    } else {
      storyId = await createStory(db, fresh, analysis, embedding)
      clustering = 'adjudicated_new'
    }
  } else {
    storyId = await createStory(db, fresh, analysis, embedding)
    clustering = 'new'
  }

  await db.update(sources).set({ status: 'ready' }).where(eq(sources.id, row.id))
  logger.info({ sourceId, storyId, clustering, quality: ext.quality, prompts: PROMPT_VERSIONS }, 'source ready')
  return { sourceId, status: 'ready', storyId, clustering }
}
