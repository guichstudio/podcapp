import { z } from 'zod'

// Domain types + zod schemas. Every LLM output is validated against these.

export const ClaimSchema = z.object({
  text: z.string().min(1),
  type: z.enum(['fact', 'number', 'quote', 'interpretation']),
  evidence_quote: z.string(),
  confidence: z.number().min(0).max(1),
})
export type Claim = z.infer<typeof ClaimSchema>

export const SourceAnalysisSchema = z.object({
  summary: z.string().min(1),
  topics: z.array(z.string()),
  entities: z.array(z.string()),
  claims: z.array(ClaimSchema),
  importance: z.number().min(0).max(1),
  novelty: z.number().min(0).max(1),
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
