import { z } from 'zod'
import { CATEGORIES } from '../config.js'

// Domain types + zod schemas. Every LLM output is validated against these.

export const ClaimSchema = z.object({
  text: z.string().min(1),
  type: z.enum(['fact', 'number', 'quote', 'interpretation']),
  evidence_quote: z.string(),
  confidence: z.number().min(0).max(1),
})
export type Claim = z.infer<typeof ClaimSchema>

/// A claim as a STORY holds it, which is not quite what the analyser returns:
/// the story stamps which source it came from.
///
/// The analyser never sees an id, so this cannot be part of ClaimSchema. It
/// exists because a story merges the claims of several sources into one array
/// and, without an origin, removing a source could not remove its evidence --
/// a sentence could air citing a source the reader had deleted. Optional
/// because rows written before this existed carry no origin and never will.
export const StoredClaimSchema = ClaimSchema.extend({ source_id: z.string().uuid().optional() })
export type StoredClaim = z.infer<typeof StoredClaimSchema>

export const SourceAnalysisSchema = z.object({
  summary: z.string().min(1),
  topics: z.array(z.string()),
  entities: z.array(z.string()),
  claims: z.array(ClaimSchema),
  importance: z.number().min(0).max(1),
  novelty: z.number().min(0).max(1),
  // Strict: the cache is keyed by prompt version, so no v1 analysis (without a
  // category) is ever read through this schema.
  category: z.enum(CATEGORIES),
})
export type SourceAnalysis = z.infer<typeof SourceAnalysisSchema>

export const AdjudicationSchema = z.object({
  same_story: z.boolean(),
  reason: z.string(),
})
export type Adjudication = z.infer<typeof AdjudicationSchema>

export const OutlineSchema = z.object({
  intro: z.string(),
  sections: z.array(
    z.object({
      story_id: z.string(),
      title: z.string(),
      airtime_sec: z.number().int().positive(),
      angle: z.string(),
      why_it_matters: z.string(),
      new_information: z.array(z.string()),
      transition_hint: z.string(),
    }),
  ),
  discarded: z.array(z.object({ story_id: z.string(), reason: z.string() })),
  outro: z.string(),
})
export type Outline = z.infer<typeof OutlineSchema>

export const ScriptSchema = z.object({
  chapters: z.array(
    z.object({
      story_id: z.string().nullable(),
      title: z.string(),
      text: z.string(),
      source_ids: z.array(z.string()),
    }),
  ),
})
export type Script = z.infer<typeof ScriptSchema>

export type SourceType = 'web' | 'email' | 'text'

export type SourceStatus =
  | 'received'
  | 'extracting'
  | 'analyzed'
  | 'ready'
  | 'extraction_failed'
  | 'low_quality'
  | 'unsupported'
  | 'duplicate'

export interface Extraction {
  clean_text: string
  title?: string | undefined
  author?: string | undefined
  publisher?: string | undefined
  published_at?: string | undefined
  lang?: string | undefined
  quality: number
  raw: unknown
}

export type ExtractResult =
  | { ok: true; extraction: Extraction }
  | { ok: false; status: 'extraction_failed' | 'low_quality' | 'unsupported'; error: string; raw?: unknown }
